import { and, count, eq, gte, isNotNull, lt, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { messages, notifications, otpChallenges, threads } from "@/db/schema";
import type { Db } from "@/db/client";
import type { NotifySkip } from "./notifications";

/** 건당 단가(원, VAT 별도). 기본값은 조사한 딜러사 단가 중 높은 쪽(SOLAPI)으로 보수적으로 잡는다. */
export interface UnitPrices {
  alimtalk: number;
  sms: number;
}

export const DEFAULT_PRICES: UnitPrices = { alimtalk: 13, sms: 18 };

export interface UsageReport {
  from: string;
  to: string;
  finderMessages: number;
  notifiedMessages: number;
  skipped: Partial<Record<NotifySkip, number>>;
  sent: { alimtalk: number; sms: number };
  failed: number;
  pending: number;
  /** 인증번호 요청 수(지금은 모두 문자로 나간다). */
  otpRequests: number;
  activeTags: number;
  maxNotifiedPerTag: number;
  prices: UnitPrices;
  estimatedCostKrw: number;
}

/**
 * 기간 동안의 발송 건수와 예상 비용. 알림 한도 숫자를 운영 데이터로 조정할 때 쓴다.
 * 기준 시각은 행이 만들어진 시각(created_at)이다.
 */
export async function usageReport(db: Db, range: { from: Date; to: Date }, prices: UnitPrices = DEFAULT_PRICES): Promise<UsageReport> {
  const within = (column: PgColumn): SQL => and(gte(column, range.from), lt(column, range.to)) as SQL;
  const finderInRange = and(eq(messages.sender, "finder"), within(messages.createdAt));

  const [msg] = await db.select({ total: count(), notified: count(messages.notifiedAt) }).from(messages).where(finderInRange);
  const skips = await db
    .select({ reason: messages.notifySkip, n: count() })
    .from(messages)
    .where(and(finderInRange, isNotNull(messages.notifySkip)))
    .groupBy(messages.notifySkip);
  const sends = await db
    .select({ status: notifications.status, channel: notifications.channel, n: count() })
    .from(notifications)
    .where(within(notifications.createdAt))
    .groupBy(notifications.status, notifications.channel);
  const [otp] = await db.select({ n: count() }).from(otpChallenges).where(within(otpChallenges.createdAt));
  const perTag = await db
    .select({ token: threads.token, notified: count(messages.notifiedAt) })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(finderInRange)
    .groupBy(threads.token);

  const sumOf = (pick: (row: (typeof sends)[number]) => boolean) => sends.filter(pick).reduce((total, row) => total + row.n, 0);
  const sent = {
    alimtalk: sumOf((row) => row.status === "sent" && row.channel === "alimtalk"),
    sms: sumOf((row) => row.status === "sent" && row.channel === "sms"),
  };
  const cost = sent.alimtalk * prices.alimtalk + (sent.sms + otp.n) * prices.sms;

  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    finderMessages: msg.total,
    notifiedMessages: msg.notified,
    skipped: Object.fromEntries(skips.map((row) => [row.reason, row.n])),
    sent,
    failed: sumOf((row) => row.status === "failed"),
    pending: sumOf((row) => row.status === "queued" || row.status === "deferred"),
    otpRequests: otp.n,
    activeTags: perTag.length,
    maxNotifiedPerTag: perTag.reduce((max, row) => Math.max(max, row.notified), 0),
    prices,
    estimatedCostKrw: Math.round(cost * 100) / 100,
  };
}
