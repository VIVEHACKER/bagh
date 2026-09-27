import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isAppError } from "@/lib/errors";
import { MAX_BODY_BYTES, assertSameOrigin, clientIp, isLocalRequest, readJson } from "@/server/request";

async function errOf(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (isAppError(err)) return `${err.status}:${err.code}`;
    throw err;
  }
}

const Body = z.object({ name: z.string().max(5) });
const post = (body?: BodyInit, headers: Record<string, string> = {}) => new Request("http://app.test/api", { method: "POST", body, headers });
const withHeaders = (headers: Record<string, string>) => new Request("http://app.test/api", { headers });

describe("readJson", () => {
  it("스키마에 맞는 본문을 돌려준다", async () => {
    expect(await readJson(post(JSON.stringify({ name: "kim" })), Body)).toEqual({ name: "kim" });
  });

  it("JSON이 아니거나, 비었거나, 스키마가 틀리면 400", async () => {
    expect(await errOf(() => readJson(post("{"), Body))).toBe("400:body_invalid");
    expect(await errOf(() => readJson(post(), Body))).toBe("400:body_invalid");
    expect(await errOf(() => readJson(post(JSON.stringify({ name: "too-long" })), Body))).toBe("400:body_invalid");
  });

  it("상한을 넘는 본문은 413으로 거절한다", async () => {
    expect(await errOf(() => readJson(post(JSON.stringify({ name: "x".repeat(MAX_BODY_BYTES) })), Body))).toBe("413:body_too_large");
    // Content-Length로 큰 본문을 밝히면 읽지 않고 거절한다.
    expect(await errOf(() => readJson(post("{}", { "content-length": String(MAX_BODY_BYTES + 1) }), Body))).toBe("413:body_too_large");
  });

  it("길이를 밝히지 않은 조각 전송도 상한에서 읽기를 끊는다", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4096).fill(0x61));
        if (pulled > 100) controller.close();
      },
    });
    const req = new Request("http://app.test/api", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await errOf(() => readJson(req, Body))).toBe("413:body_too_large");
    expect(pulled).toBeLessThan(10);
  });
});

describe("assertSameOrigin", () => {
  it("같은 출처만 통과한다", async () => {
    expect(await errOf(() => assertSameOrigin(withHeaders({ origin: "https://bghm.kr", host: "bghm.kr" })))).toBe("ok");
    expect(await errOf(() => assertSameOrigin(withHeaders({ origin: "https://bghm.kr", "x-forwarded-host": "bghm.kr", host: "10.0.0.5:3000" })))).toBe("ok");
    expect(await errOf(() => assertSameOrigin(withHeaders({ origin: "https://evil.example", host: "bghm.kr" })))).toBe("403:origin_invalid");
    expect(await errOf(() => assertSameOrigin(withHeaders({ host: "bghm.kr" })))).toBe("403:origin_invalid");
    expect(await errOf(() => assertSameOrigin(withHeaders({ origin: "not a url", host: "bghm.kr" })))).toBe("403:origin_invalid");
  });
});

describe("clientIp", () => {
  const oneHop = { trustedHops: 1, onVercel: false };

  it("클라이언트가 앞에 끼워 넣은 값은 무시하고 신뢰 프록시가 붙인 값을 쓴다", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), oneHop)).toBe("203.0.113.7");
    expect(clientIp(withHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }), { trustedHops: 2, onVercel: false })).toBe("203.0.113.7");
    expect(clientIp(withHeaders({ "x-forwarded-for": "203.0.113.7" }), { trustedHops: 3, onVercel: false })).toBe("203.0.113.7");
  });

  it("Vercel에서 실행할 때만 플랫폼 헤더를 믿는다", () => {
    const headers = { "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 203.0.113.7" };
    expect(clientIp(withHeaders(headers), { trustedHops: 1, onVercel: true })).toBe("198.51.100.4");
    expect(clientIp(withHeaders(headers), oneHop)).toBe("203.0.113.7");
  });

  it("전달 헤더가 없으면 x-real-ip, 그것도 없으면 0.0.0.0", () => {
    expect(clientIp(withHeaders({ "x-real-ip": "192.0.2.1" }), oneHop)).toBe("192.0.2.1");
    expect(clientIp(withHeaders({}), oneHop)).toBe("0.0.0.0");
  });

  it("TRUSTED_PROXY_HOPS를 읽고, 잘못된 값이면 1로 둔다", () => {
    const prev = process.env.TRUSTED_PROXY_HOPS;
    const chain = withHeaders({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" });
    try {
      process.env.TRUSTED_PROXY_HOPS = "2";
      expect(clientIp(chain)).toBe("203.0.113.7");
      process.env.TRUSTED_PROXY_HOPS = "banana";
      expect(clientIp(chain)).toBe("10.0.0.2");
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = prev;
    }
  });
});

describe("isLocalRequest", () => {
  it("localhost·루프백 접속만 로컬로 본다", () => {
    for (const host of ["localhost:3000", "LOCALHOST", "127.0.0.1:3000", "[::1]:3000"]) expect(isLocalRequest(withHeaders({ host }))).toBe(true);
    for (const host of ["bghm.kr", "localhost.evil.example", "10.0.0.1:3000"]) expect(isLocalRequest(withHeaders({ host }))).toBe(false);
    expect(isLocalRequest(withHeaders({}))).toBe(false);
  });
});
