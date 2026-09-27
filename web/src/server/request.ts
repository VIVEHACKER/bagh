import type { ZodType } from "zod";
import { AppError, badRequest, forbidden } from "@/lib/errors";

// 요청 헤더·본문만 다루는 순수 함수. next/headers에 기대지 않아 단위 테스트로 검증한다.

/** API 요청 본문 상한. 가장 큰 입력(습득자 메시지 600자 + 장소 300자)도 4KB 안쪽이다. */
export const MAX_BODY_BYTES = 16 * 1024;

const tooLarge = () => new AppError("body_too_large", "요청이 너무 커요.", 413);

/** 본문을 상한까지만 읽는다. Content-Length를 속이거나 chunked로 보내도 상한을 넘는 순간 읽기를 끊는다. */
async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      // 정리 단계다. 취소 실패보다 "너무 크다"가 호출자에게 필요한 오류다.
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson<T>(req: Request, schema: ZodType<T>, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const text = await readBodyText(req, maxBytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badRequest("body_invalid", "요청 형식이 올바르지 않아요.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest("body_invalid", "입력값을 확인해 주세요.", {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

/** 상태를 바꾸는 요청은 같은 출처에서만 받는다(CSRF 방어). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw forbidden("origin_invalid", "허용되지 않은 요청이에요.");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("origin_invalid", "허용되지 않은 요청이에요.");
  }
  if (originHost !== host) throw forbidden("origin_invalid", "허용되지 않은 요청이에요.");
}

export interface ClientIpOptions {
  /** 앱 앞에서 X-Forwarded-For에 값을 덧붙이는 신뢰 프록시 수(TRUSTED_PROXY_HOPS). */
  trustedHops: number;
  /** Vercel에서 실행 중이면 플랫폼이 채우는 x-vercel-forwarded-for를 믿는다. 다른 곳에서는 클라이언트가 위조할 수 있다. */
  onVercel: boolean;
}

function envIpOptions(): ClientIpOptions {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  return { trustedHops: Number.isInteger(hops) && hops >= 1 && hops <= 5 ? hops : 1, onVercel: process.env.VERCEL === "1" };
}

/**
 * 속도 제한에 쓰는 호출자 IP.
 * 클라이언트는 X-Forwarded-For 앞쪽을 마음대로 채울 수 있으므로, 신뢰 프록시가 붙인 오른쪽에서 센 값만 쓴다.
 */
export function clientIp(req: Pick<Request, "headers">, opts: ClientIpOptions = envIpOptions()): string {
  if (opts.onVercel) {
    const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (vercel) return vercel.slice(0, 64);
  }
  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const picked = chain.length > 0 ? chain[Math.max(0, chain.length - opts.trustedHops)] : undefined;
  return (picked || req.headers.get("x-real-ip")?.trim() || "0.0.0.0").slice(0, 64);
}

/** 개발용 인증번호를 로컬 접속에만 돌려줄 때 쓴다. */
export function isLocalRequest(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
