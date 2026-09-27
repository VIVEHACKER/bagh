import { lt } from "drizzle-orm";
import { otpChallenges, sessions, shortLinks, threads } from "@/db/schema";
import type { Deps } from "../deps";

const DAY = 86_400_000;

/**
 * 보관 기간이 지난 데이터를 지운다(docs/02 §4-3).
 * - 대화: 만료 후 30일이 지나면 스레드째 삭제(메시지·알림·짧은 링크는 cascade)
 * - 짧은 링크: 대화 답장 기간(threadTtlHours)이 지나면 삭제
 * - 인증번호: 만료 후 1일, 세션: 만료 즉시
 * 주의: 알림 한도(주인 30일, 태그 24시간)와 인증번호 하루 상한은 이 데이터로 센다. 보관 기간을 한도 창보다 짧게 줄이지 않는다.
 */
export async function purgeExpired(deps: Deps): Promise<{ threads: number; otps: number; sessions: number; shortLinks: number }> {
  const now = deps.now().getTime();
  const t = await deps.db.delete(threads).where(lt(threads.expiresAt, new Date(now - 30 * DAY))).returning({ id: threads.id });
  const o = await deps.db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, new Date(now - DAY))).returning({ id: otpChallenges.id });
  const s = await deps.db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).returning({ id: sessions.id });
  const l = await deps.db
    .delete(shortLinks)
    .where(lt(shortLinks.expiresAt, new Date(now - deps.config.threadTtlHours * 3_600_000)))
    .returning({ code: shortLinks.code });
  return { threads: t.length, otps: o.length, sessions: s.length, shortLinks: l.length };
}
