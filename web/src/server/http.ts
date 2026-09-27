import "server-only";
import { cookies } from "next/headers";
import { isAppError, unauthorized } from "@/lib/errors";
import { log } from "@/lib/log";
import { getDeps, type Deps } from "./deps";
import { ownerFromSession } from "./services/auth";

export { assertSameOrigin, clientIp, isLocalRequest, readJson } from "./request";

export const SESSION_COOKIE = "bh_session";
export const DEVICE_COOKIE = "bh_did";
export const finderCookieName = (token: string) => `bh_fk_${token}`;

/** 오류 응답 형식: { error: { code, message, details? } } */
export function errorResponse(err: unknown, op: string): Response {
  if (isAppError(err)) {
    const retry = err.details?.retryAfterSec;
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status, headers: typeof retry === "number" ? { "Retry-After": String(retry) } : undefined },
    );
  }
  log.error({ event: "http.unhandled", op, err: err instanceof Error ? err.message : String(err) }, "unhandled error");
  return Response.json({ error: { code: "internal", message: "잠시 뒤에 다시 시도해 주세요." } }, { status: 500 });
}

export function cookieOptions(maxAgeSec: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: maxAgeSec };
}

export async function currentOwner(deps: Deps): Promise<string | null> {
  const store = await cookies();
  return ownerFromSession(deps, store.get(SESSION_COOKIE)?.value);
}

export async function requireOwner(deps: Deps): Promise<string> {
  const ownerId = await currentOwner(deps);
  if (!ownerId) throw unauthorized();
  return ownerId;
}

/** 라우트 공통 래퍼: 의존성 주입, 오류 응답 변환, 결과 로그(작업·상태·코드·소요시간). */
export function route<C>(op: string, fn: (req: Request, deps: Deps, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const started = Date.now();
    try {
      const deps = await getDeps();
      const res = await fn(req, deps, ctx);
      log.info({ event: "http.ok", op, status: res.status, ms: Date.now() - started });
      return res;
    } catch (err) {
      const res = errorResponse(err, op);
      const level = res.status >= 500 ? "error" : "info";
      log[level]({ event: "http.fail", op, status: res.status, errorCode: isAppError(err) ? err.code : "internal", ms: Date.now() - started });
      return res;
    }
  };
}
