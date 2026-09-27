import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { messages, stickerSets, stickers, threads } from "@/db/schema";
import { TOKEN_LENGTH, isValidCode, normalizeCode } from "@/lib/codes";
import { randomSecret, safeEqual, secretHash } from "@/lib/crypto";
import { badRequest, conflict, forbidden, gone, notFound, rateLimited } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { log, maskDigits } from "@/lib/log";
import type { Db } from "@/db/client";
import type { Deps } from "../deps";
import { dispatchDue, enqueueForMessage } from "./notifications";
import { REASON_CODES, type ReasonCode } from "./reasons";

export type FinderViewState = "active" | "unregistered" | "unavailable" | "not_found";

/**
 * 스캔한 사람에게 보여 줄 상태. 누가 스캔했는지(주인인지)는 판단하지 않는다.
 * 설계 제약: 스캔으로 주인·습득자를 자동 판별하지 않는다(docs/01 §5-3).
 * 주인이 정한 라벨도 습득자에게는 보여 주지 않는다(개인정보 최소화).
 */
export async function getFinderView(deps: Deps, rawToken: string): Promise<{ state: FinderViewState; token: string }> {
  const token = normalizeCode(rawToken);
  if (!isValidCode(token, TOKEN_LENGTH)) return { state: "not_found", token };
  const [row] = await deps.db.select({ status: stickers.status }).from(stickers).where(eq(stickers.token, token)).limit(1);
  if (!row) return { state: "not_found", token };
  if (row.status === "unclaimed") return { state: "unregistered", token };
  if (row.status !== "active") return { state: "unavailable", token };
  return { state: "active", token };
}

export interface FinderMessageInput {
  token: string;
  /** 같은 습득자의 후속 메시지를 한 스레드로 묶는 비밀값(쿠키). 처음이면 없다. */
  finderKey?: string;
  deviceId: string;
  ip: string;
  reason: string;
  place?: string;
  body?: string;
}

export interface FinderMessageResult {
  threadId: string;
  /** 새 스레드를 만들었을 때만 돌려준다. 클라이언트는 쿠키로 보관한다. */
  newFinderKey?: string;
  /** 주인에게 알림을 예약했는지. 알림 한도를 넘었으면 false이고 메시지는 저장만 했다. */
  notified: boolean;
  deferred: boolean;
  remaining: number;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function clean(text: string | undefined, max: number): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/**
 * 습득자 메시지를 받는다. 속도 제한은 호출자(토큰·IP·기기) 기준으로만 건다.
 * 설계 제약: 호출자에게 SMS 경고를 보내지 않고, 주인의 응답률로 막지 않는다(docs/01 §8).
 */
export async function postFinderMessage(
  deps: Deps,
  input: FinderMessageInput,
  options: { dispatchInline?: boolean } = {},
): Promise<FinderMessageResult> {
  const token = normalizeCode(input.token);
  if (!isValidCode(token, TOKEN_LENGTH)) throw notFound("sticker_not_found", "태그를 찾을 수 없어요.");
  if (!(REASON_CODES as readonly string[]).includes(input.reason)) throw badRequest("reason_invalid", "사유를 골라 주세요.");
  const place = clean(input.place, 100);
  const body = clean(input.body, 200);

  const nowMs = deps.now().getTime();
  const existing = input.finderKey ? await findOpenThread(deps.db, token, input.finderKey, deps.now()) : undefined;
  // 한 사람이 태그 전체를 침묵시키지 못하게 태그 한도는 (태그, 기기)·(태그, IP) 단위로 두고,
  // 태그 전체에는 주인을 폭주에서 지키는 느슨한 상한만 둔다. 모든 규칙을 통과할 때만 기록한다.
  const rules = [
    { key: `fm:ip:${input.ip}`, limit: 20, windowMs: 60 * MIN },
    { key: `fm:dev:${input.deviceId}`, limit: 10, windowMs: 60 * MIN },
    { key: `fm:tok-dev:${token}:${input.deviceId}`, limit: 3, windowMs: 10 * MIN },
    { key: `fm:tok-ip:${token}:${input.ip}`, limit: 5, windowMs: 10 * MIN },
    { key: `fm:tok:${token}`, limit: 30, windowMs: 60 * MIN },
  ];
  // 쿠키를 지워 가며 새 대화를 여는 도배로 태그의 하루 알림 한도(대화 수)를 다 쓰지 못하게 한다.
  if (!existing) rules.push({ key: `fm:tok-ip-new:${token}:${input.ip}`, limit: 2, windowMs: DAY });
  const r = await deps.limiter.hitAll(rules, nowMs);
  if (!r.ok) throw rateLimited(r.retryAfterSec);

  const [sticker] = await deps.db
    .select({ status: stickers.status, ownerId: stickerSets.ownerId })
    .from(stickers)
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(eq(stickers.token, token))
    .limit(1);
  if (!sticker) throw notFound("sticker_not_found", "태그를 찾을 수 없어요.");
  if (sticker.status !== "active" || !sticker.ownerId) throw conflict("sticker_not_active", "지금은 연락을 받지 않는 태그예요.");
  const ownerId = sticker.ownerId;

  const result = await deps.db.transaction(async (tx) => {
    let newFinderKey: string | undefined;
    let thread = input.finderKey ? await findOpenThread(tx, token, input.finderKey, deps.now()) : undefined;
    if (!thread) {
      newFinderKey = randomSecret(24);
      [thread] = await tx
        .insert(threads)
        .values({ token, finderKeyHash: secretHash(newFinderKey), expiresAt: new Date(nowMs + deps.config.threadTtlHours * 60 * MIN) })
        .returning();
    }
    if (thread.blocked) throw forbidden("thread_blocked", "주인이 이 대화를 받지 않기로 했어요.");
    // 한도 검사와 증가를 한 문장으로 한다(동시 요청이 10개 한도를 넘지 못하게).
    const [bumped] = await tx
      .update(threads)
      .set({ messageCount: sql`${threads.messageCount} + 1` })
      .where(and(eq(threads.id, thread.id), lt(threads.messageCount, deps.config.maxThreadMessages)))
      .returning({ messageCount: threads.messageCount });
    if (!bumped) throw conflict("thread_full", "이 대화의 메시지 수를 모두 썼어요.");

    const [message] = await tx
      .insert(messages)
      .values({ threadId: thread.id, sender: "finder", reasonCode: input.reason as ReasonCode, placeText: place, body })
      .returning({ id: messages.id });
    const { notified, deferred } = await enqueueForMessage(tx, deps, { messageId: message.id, threadId: thread.id, ownerId, token });
    return { threadId: thread.id, newFinderKey, notified, deferred, remaining: deps.config.maxThreadMessages - bumped.messageCount };
  });

  // 웹 요청에서는 라우트가 응답 뒤(after)에 발송한다. 테스트·스크립트에서는 바로 발송한다.
  if (options.dispatchInline ?? true) await dispatchSafely(deps);
  return result;
}

/** 습득자 쿠키(대화 비밀값)로 아직 열려 있는 대화를 찾는다. */
async function findOpenThread(db: Db | Tx, token: string, finderKey: string, now: Date) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.token, token), eq(threads.finderKeyHash, secretHash(finderKey)), gt(threads.expiresAt, now)))
    .limit(1);
  return thread;
}

/** 발송 실패가 습득자 요청을 실패시키지 않게 한다. 남은 알림은 크론이 다시 보낸다. */
export async function dispatchSafely(deps: Deps): Promise<void> {
  try {
    await dispatchDue(deps);
  } catch (err) {
    log.error({ event: "finder.dispatch_failed", err: maskDigits((err as Error).message) }, "dispatch after finder message failed");
  }
}

export interface ThreadMessageView {
  sender: "finder" | "owner";
  reasonCode: string | null;
  placeText: string | null;
  body: string | null;
  replyCode: string | null;
  /** 습득자 메시지가 주인에게 알려졌는지(알림 한도를 넘으면 false). 주인 답장은 항상 false. */
  notified: boolean;
  createdAt: string;
}

export interface ThreadView {
  threadId: string;
  expiresAt: string;
  expired: boolean;
  remaining: number;
  messages: ThreadMessageView[];
}

export async function loadThreadView(deps: Deps, threadId: string): Promise<ThreadView | null> {
  if (!isUuid(threadId)) return null;
  const [thread] = await deps.db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  if (!thread) return null;
  const rows = await deps.db
    .select({
      sender: messages.sender,
      reasonCode: messages.reasonCode,
      placeText: messages.placeText,
      body: messages.body,
      replyCode: messages.replyCode,
      notifiedAt: messages.notifiedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));
  return {
    threadId,
    expiresAt: thread.expiresAt.toISOString(),
    expired: thread.expiresAt.getTime() <= deps.now().getTime(),
    remaining: Math.max(0, deps.config.maxThreadMessages - thread.messageCount),
    messages: rows.map(({ notifiedAt, ...r }) => ({ ...r, notified: notifiedAt !== null, createdAt: r.createdAt.toISOString() })),
  };
}

/** 습득자가 자기 스레드의 답장을 확인한다. 스레드 비밀값(쿠키)이 맞아야 한다. */
export async function getThreadForFinder(deps: Deps, token: string, finderKey: string | undefined): Promise<ThreadView> {
  if (!finderKey) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  const t = normalizeCode(token);
  const [thread] = await deps.db
    .select({ id: threads.id, finderKeyHash: threads.finderKeyHash })
    .from(threads)
    .where(and(eq(threads.token, t), eq(threads.finderKeyHash, secretHash(finderKey))))
    .limit(1);
  if (!thread || !safeEqual(thread.finderKeyHash, secretHash(finderKey))) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  const view = await loadThreadView(deps, thread.id);
  if (!view) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  if (view.expired) throw gone("thread_expired", `대화 기간(${deps.config.threadTtlHours}시간)이 끝났어요.`);
  return view;
}
