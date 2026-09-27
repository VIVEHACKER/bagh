import { eq } from "drizzle-orm";
import { shortLinks } from "@/db/schema";
import { isValidCode, normalizeCode, randomCode } from "@/lib/codes";
import { signLink } from "@/lib/crypto";
import { rateLimited } from "@/lib/errors";
import type { Deps } from "../deps";

/** 32자 알파벳 10자리(약 50비트). 추측 공격은 IP당 조회 제한으로 막는다. */
export const SHORT_CODE_LENGTH = 10;

const MIN = 60_000;

/**
 * 대체 문자에 넣을 짧은 주소(/m/<코드>)를 만든다.
 * 답장 링크와 같은 시간(REPLY_LINK_TTL_MIN) 동안 서명 답장 링크로 이어지고, 그 뒤에는 로그인 답장 화면으로 이어진다.
 */
export async function createShortLink(deps: Deps, threadId: string): Promise<string> {
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + deps.config.replyLinkTtlMin * MIN);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = randomCode(SHORT_CODE_LENGTH);
    const inserted = await deps.db
      .insert(shortLinks)
      .values({ code, threadId, expiresAt, createdAt: now })
      .onConflictDoNothing()
      .returning({ code: shortLinks.code });
    if (inserted.length > 0) return `${deps.config.publicBaseUrl}/m/${code}`;
  }
  throw new Error("short link code collided 3 times");
}

/**
 * 짧은 주소가 가리킬 경로. 유효 시간 안이면 새로 서명한 답장 링크, 지났으면 로그인해서 답장하는 대화 화면.
 * 없는 코드는 null. 코드를 무작위로 두드리지 못하게 IP당 10분에 30번까지 조회한다.
 */
export async function resolveShortLink(deps: Deps, rawCode: string, ip: string): Promise<string | null> {
  const r = await deps.limiter.hit(`short:ip:${ip}`, 30, 10 * MIN, deps.now().getTime());
  if (!r.ok) throw rateLimited(r.retryAfterSec);
  const code = normalizeCode(rawCode);
  if (!isValidCode(code, SHORT_CODE_LENGTH)) return null;
  const [row] = await deps.db.select().from(shortLinks).where(eq(shortLinks.code, code)).limit(1);
  if (!row) return null;
  const exp = Math.floor(row.expiresAt.getTime() / 1000);
  if (exp <= Math.floor(deps.now().getTime() / 1000)) return `/r/${row.threadId}`;
  return `/r/${row.threadId}?e=${exp}&s=${signLink(row.threadId, exp, deps.keys.link)}`;
}
