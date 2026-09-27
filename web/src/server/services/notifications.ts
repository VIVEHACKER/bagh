import { and, asc, count, countDistinct, eq, gt, gte, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import { contacts, messages, notifications, owners, stickerSets, stickers, threads } from "@/db/schema";
import { decrypt, signLink } from "@/lib/crypto";
import { log, maskDigits } from "@/lib/log";
import { quietEndsAt } from "@/lib/quiet-hours";
import { SMS_MAX_BYTES, fallbackSmsText, smsBytes } from "@/lib/sms";
import type { Db } from "@/db/client";
import type { Deps } from "../deps";
import { REASON_LABEL_KO, type ReasonCode } from "./reasons";
import { createShortLink } from "./short-links";

const MAX_ATTEMPTS = 3;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type NotifySkip = "thread_cap" | "tag_daily_cap" | "owner_monthly_cap" | "no_contacts";

export interface EnqueueResult {
  /** 주인에게 알림을 예약했는지. false면 메시지는 저장만 했다. */
  notified: boolean;
  deferred: boolean;
}

const DAY_MS = 24 * 60 * 60_000;
/** 주인 알림 예산 창. retention.ts의 보관 기간(대화 만료 뒤 30일)이 이보다 짧아지면 한도가 조용히 풀린다. */
export const OWNER_WINDOW_MS = 30 * DAY_MS;

/**
 * 새 습득자 메시지의 알림을 주인의 모든 연락처에 "동시에" 예약한다.
 * 알림 한도를 넘으면 알리지 않고 저장만 한다(알림 비용 상한).
 * - 대화 하나당 notifyPerThread건(후속 메시지 도배 방지)
 * - 태그당 최근 24시간 notifyPerTagDaily개 대화(메시지가 아니라 대화를 센다: 한 사람이 태그를 막지 못하게)
 * - 주인당 최근 30일 notifyPerOwnerMonthly건(비용 상한). 주인이 차단한 대화는 세지 않는다.
 * 설계 제약: 한도는 고정 숫자다. 주인의 응답률로 막지 않는다. 확인하지 않았다고 다른 번호로 넘기지 않고
 * (에스컬레이션 없음), 방해금지 시간에는 미루기만 한다(시간대 라우팅 없음). docs/01 §8.
 */
export async function enqueueForMessage(
  tx: Tx,
  deps: Deps,
  input: { messageId: string; threadId: string; ownerId: string; token: string },
): Promise<EnqueueResult> {
  // 같은 주인의 예산을 두 요청이 동시에 세지 않게 트랜잭션이 끝날 때까지 주인 단위로 줄을 세운다.
  // 정확성은 READ COMMITTED(문장마다 새 스냅샷)에 기댄다: 잠금 뒤의 count가 먼저 끝난 요청의 기록을 본다.
  // 잠금 대기가 lock_timeout(pg, 5초)을 넘으면 메시지 저장까지 되돌리고 오류를 낸다(습득자가 다시 보낸다).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.ownerId}, 0))`);
  const now = deps.now();
  const capped = await budgetSkip(tx, deps, input, now);
  const targets = capped ? [] : await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.ownerId, input.ownerId));
  const skip: NotifySkip | null = capped ?? (targets.length === 0 ? "no_contacts" : null);
  if (skip) {
    await tx.update(messages).set({ notifySkip: skip }).where(eq(messages.id, input.messageId));
    log.info({ event: "notify.skipped", reason: skip, messageId: input.messageId }, "notification skipped");
    return { notified: false, deferred: false };
  }

  const [owner] = await tx
    .select({ quietStartMin: owners.quietStartMin, quietEndMin: owners.quietEndMin })
    .from(owners)
    .where(eq(owners.id, input.ownerId))
    .limit(1);
  const scheduledFor = quietEndsAt(now, owner?.quietStartMin ?? null, owner?.quietEndMin ?? null);
  const deferred = scheduledFor.getTime() > now.getTime();
  await tx.insert(notifications).values(
    targets.map((c) => ({ messageId: input.messageId, contactId: c.id, scheduledFor, status: deferred ? ("deferred" as const) : ("queued" as const) })),
  );
  await tx.update(messages).set({ notifiedAt: now }).where(eq(messages.id, input.messageId));
  return { notified: true, deferred };
}

/** 알림 한도를 넘었으면 이유를 돌려준다. 방해금지로 미룬 알림도 예약한 시점에 한도에 넣는다. */
async function budgetSkip(
  tx: Tx,
  deps: Deps,
  input: { threadId: string; ownerId: string; token: string },
  now: Date,
): Promise<NotifySkip | null> {
  const [thread] = await tx
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.threadId, input.threadId), isNotNull(messages.notifiedAt)));
  if (thread.n >= deps.config.notifyPerThread) return "thread_cap";

  // 이미 알린 대화의 후속 메시지는 태그 한도를 새로 쓰지 않는다.
  if (thread.n === 0) {
    const [tag] = await tx
      .select({ n: countDistinct(messages.threadId) })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(and(eq(threads.token, input.token), eq(threads.blocked, false), gt(messages.notifiedAt, new Date(now.getTime() - DAY_MS))));
    if (tag.n >= deps.config.notifyPerTagDaily) return "tag_daily_cap";
  }

  if ((await ownerAlertsUsed(tx, input.ownerId, new Date(now.getTime() - OWNER_WINDOW_MS))) >= deps.config.notifyPerOwnerMonthly) {
    return "owner_monthly_cap";
  }
  return null;
}

/** 주인의 모든 태그에서 since 뒤에 알린 습득자 메시지 수. 주인이 차단한 대화는 빼 준다(도배 예산 환급). */
export async function ownerAlertsUsed(db: Tx | Db, ownerId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .innerJoin(stickers, eq(stickers.token, threads.token))
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(and(eq(stickerSets.ownerId, ownerId), eq(threads.blocked, false), gt(messages.notifiedAt, since)));
  return row.n;
}

export function replyLink(deps: Deps, threadId: string): string {
  const exp = Math.floor(deps.now().getTime() / 1000) + deps.config.replyLinkTtlMin * 60;
  const sig = signLink(threadId, exp, deps.keys.link);
  return `${deps.config.publicBaseUrl}/r/${threadId}?e=${exp}&s=${sig}`;
}

export interface DispatchReport {
  sent: number;
  failed: number;
  retried: number;
}

/** 이 시간이 지나도 대기 상태로 남은 "시도 횟수 소진" 행은 발송 중 멈춘 워커가 남긴 것으로 본다. */
const STUCK_AFTER_MS = 10 * 60_000;

type DueNotification = {
  id: string;
  attempts: number;
  phoneEnc: string;
  threadId: string;
  reasonCode: string | null;
  placeText: string | null;
  body: string | null;
  label: string | null;
};

/**
 * 발송 시각이 된 알림을 보낸다. 알림톡이 실패하면 SMS로 대체한다.
 * SMS에는 습득자가 쓴 본문을 싣지 않는다(문자 중계 사업 규제 여지, docs/02 §4-5).
 * 한 건이 예상 밖 오류로 실패해도 나머지 건은 계속 보낸다.
 */
export async function dispatchDue(deps: Deps, limit = 50): Promise<DispatchReport> {
  const now = deps.now();
  const report: DispatchReport = { sent: 0, failed: 0, retried: 0 };

  // 선점(attempts+1) 뒤 워커가 멈추면 마지막 시도를 쓴 행이 대기 상태로 영원히 남는다. 실패로 정리한다.
  const swept = await deps.db
    .update(notifications)
    .set({ status: "failed", lastError: "worker_stopped" })
    .where(
      and(
        inArray(notifications.status, ["queued", "deferred"]),
        gte(notifications.attempts, MAX_ATTEMPTS),
        lt(notifications.scheduledFor, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    )
    .returning({ id: notifications.id });
  if (swept.length > 0) log.warn({ event: "notify.swept_stuck", count: swept.length }, "stuck notifications marked failed");
  report.failed += swept.length;

  const due: DueNotification[] = await deps.db
    .select({
      id: notifications.id,
      attempts: notifications.attempts,
      phoneEnc: contacts.phoneEnc,
      threadId: messages.threadId,
      reasonCode: messages.reasonCode,
      placeText: messages.placeText,
      body: messages.body,
      label: stickers.label,
    })
    .from(notifications)
    .innerJoin(contacts, eq(contacts.id, notifications.contactId))
    .innerJoin(messages, eq(messages.id, notifications.messageId))
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .innerJoin(stickers, eq(stickers.token, threads.token))
    .where(
      and(
        inArray(notifications.status, ["queued", "deferred"]),
        lte(notifications.scheduledFor, now),
        lt(notifications.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(notifications.scheduledFor))
    .limit(limit);

  for (const n of due) {
    try {
      const outcome = await dispatchOne(deps, n);
      if (outcome !== "skipped") report[outcome] += 1;
    } catch (err) {
      // DB 오류처럼 결과를 기록하지도 못한 경우. 이 건은 다음 실행에서 다시 집는다.
      log.error({ event: "notify.item_error", notificationId: n.id, err: maskDigits((err as Error).message) }, "dispatch item error");
    }
  }
  return report;
}

async function dispatchOne(deps: Deps, n: DueNotification): Promise<"sent" | "failed" | "retried" | "skipped"> {
  // 다른 워커가 먼저 가져갔으면 건너뛴다(낙관적 잠금: attempts 값으로 선점).
  const claimed = await deps.db
    .update(notifications)
    .set({ attempts: n.attempts + 1 })
    .where(and(eq(notifications.id, n.id), eq(notifications.attempts, n.attempts), inArray(notifications.status, ["queued", "deferred"])))
    .returning({ id: notifications.id });
  if (claimed.length === 0) return "skipped";

  try {
    const channel = await deliver(deps, n);
    await markSent(deps, n.id, channel);
    return "sent";
  } catch (err) {
    const final = n.attempts + 1 >= MAX_ATTEMPTS;
    // 업체 오류 문구에 수신 번호가 섞일 수 있어 가린 뒤에 DB·로그에 남긴다.
    const reason = maskDigits((err as Error).message).slice(0, 200);
    await deps.db.update(notifications).set({ status: final ? "failed" : "queued", lastError: reason }).where(eq(notifications.id, n.id));
    log.error({ event: "notify.failed", notificationId: n.id, final, err: reason }, "notification failed");
    return final ? "failed" : "retried";
  }
}

/** 알림톡을 먼저 보내고, 실패하면 본문 없는 SMS로 대체한다. 둘 다 실패하면 던진다. */
async function deliver(deps: Deps, n: DueNotification): Promise<"alimtalk" | "sms"> {
  const to = decrypt(n.phoneEnc, deps.keys.enc);
  const label = n.label ?? "등록한 태그";
  const link = replyLink(deps, n.threadId);
  const reason = n.reasonCode ? REASON_LABEL_KO[n.reasonCode as ReasonCode] ?? "" : "";
  try {
    await deps.notifier.sendAlimtalk({
      to,
      template: "finder_message",
      vars: { label, reason, place: n.placeText ?? "", body: (n.body ?? "").slice(0, 60), link },
    });
    return "alimtalk";
  } catch (err) {
    log.warn({ event: "notify.alimtalk_failed", notificationId: n.id, err: maskDigits((err as Error).message) }, "alimtalk failed, fallback to sms");
  }
  // 문자는 짧은 주소로 단문(90바이트) 요금에 맞춘다. 긴 서명 링크를 넣으면 장문 요금(약 3배)이 붙는다.
  const text = fallbackSmsText(n.label, await createShortLink(deps, n.threadId));
  if (smsBytes(text) > SMS_MAX_BYTES) {
    log.warn({ event: "notify.sms_over_limit", bytes: smsBytes(text) }, "fallback sms exceeds single-sms size");
  }
  await deps.notifier.sendSms({ to, text });
  return "sms";
}

async function markSent(deps: Deps, id: string, channel: "alimtalk" | "sms"): Promise<void> {
  await deps.db.update(notifications).set({ status: "sent", channel, sentAt: deps.now(), lastError: null }).where(eq(notifications.id, id));
}
