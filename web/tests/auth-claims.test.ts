import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { contacts, stickers } from "@/db/schema";
import type { OpenedDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { loginWithOtp, ownerFromSession, requestOtp, revokeSession, verifyOtp } from "@/server/services/auth";
import { issueBatch } from "@/server/services/batch";
import { claimSet } from "@/server/services/claims";
import { loginNewOwner, makeKit, nextPhone, openTestDb } from "./helpers";

let opened: OpenedDb;
beforeAll(async () => {
  opened = await openTestDb();
});
afterAll(async () => {
  await opened.close();
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (isAppError(err)) return err.code;
    throw err;
  }
}

describe("휴대폰 인증번호 로그인", () => {
  it("처음 번호면 주인 계정을 만들고, 같은 번호로 다시 로그인하면 같은 계정이다", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const phone = nextPhone();
    const first = await loginNewOwner(deps, phone);
    expect(first.isNewOwner).toBe(true);
    expect(notifier.outbox.at(-1)?.channel).toBe("sms");
    const again = await loginNewOwner(deps, phone);
    expect(again.isNewOwner).toBe(false);
    expect(again.ownerId).toBe(first.ownerId);
    expect(await ownerFromSession(deps, again.sessionToken)).toBe(first.ownerId);
  });

  it("틀린 번호는 시도 횟수를 올리고, 5번 틀리면 잠긴다", async () => {
    const { deps } = makeKit(opened.db);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "login", ip: "1.2.3.4" });
    const wrong = otp.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) expect(await codeOf(loginWithOtp(deps, otp.challengeId, wrong, "10.3.0.1"))).toBe("otp_mismatch");
    expect(await codeOf(loginWithOtp(deps, otp.challengeId, otp.devCode!, "10.3.0.1"))).toBe("otp_locked");
  });

  it("시간이 지나면 만료되고, 한 번 쓴 인증번호는 다시 못 쓴다", async () => {
    const kit = makeKit(opened.db);
    const otp = await requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip: "1.2.3.5" });
    kit.clock.advance(6 * 60_000);
    expect(await codeOf(loginWithOtp(kit.deps, otp.challengeId, otp.devCode!, "10.3.0.1"))).toBe("otp_expired");

    const otp2 = await requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip: "1.2.3.5" });
    await loginWithOtp(kit.deps, otp2.challengeId, otp2.devCode!, "10.3.0.1");
    expect(await codeOf(loginWithOtp(kit.deps, otp2.challengeId, otp2.devCode!, "10.3.0.1"))).toBe("otp_invalid");
  });

  it("동시에 여러 번 틀려도 시도 횟수 한도(5회)를 넘지 못한다", async () => {
    const { deps } = makeKit(opened.db);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "login", ip: "1.2.4.1" });
    const wrong = otp.devCode === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => codeOf(verifyOtp(deps, otp.challengeId, wrong, "login", `1.2.4.${10 + i}`))),
    );
    expect(results.filter((r) => r === "otp_mismatch")).toHaveLength(5);
    expect(results.filter((r) => r === "otp_locked")).toHaveLength(3);
    expect(await codeOf(verifyOtp(deps, otp.challengeId, otp.devCode!, "login", "1.2.4.99"))).toBe("otp_locked");
  });

  it("한 IP에서 1분에 10번 넘게 확인하면 막는다(인증번호를 새로 받아 돌려 써도)", async () => {
    const { deps } = makeKit(opened.db);
    const ip = "1.2.5.1";
    const a = await requestOtp(deps, { phone: nextPhone(), purpose: "login", ip });
    const b = await requestOtp(deps, { phone: nextPhone(), purpose: "login", ip });
    const wrong = (code?: string) => (code === "000000" ? "111111" : "000000");
    for (let i = 0; i < 5; i += 1) expect(await codeOf(verifyOtp(deps, a.challengeId, wrong(a.devCode), "login", ip))).toBe("otp_mismatch");
    for (let i = 0; i < 5; i += 1) expect(await codeOf(verifyOtp(deps, b.challengeId, wrong(b.devCode), "login", ip))).toBe("otp_mismatch");
    expect(await codeOf(verifyOtp(deps, b.challengeId, b.devCode!, "login", ip))).toBe("rate_limited");
  });

  it("같은 번호로 동시에 처음 로그인해도 계정은 하나만 생긴다", async () => {
    const { deps } = makeKit(opened.db);
    const phone = nextPhone();
    const a = await requestOtp(deps, { phone, purpose: "login", ip: "1.2.6.1" });
    const b = await requestOtp(deps, { phone, purpose: "login", ip: "1.2.6.2" });
    const [la, lb] = await Promise.all([
      loginWithOtp(deps, a.challengeId, a.devCode!, "1.2.6.1"),
      loginWithOtp(deps, b.challengeId, b.devCode!, "1.2.6.2"),
    ]);
    expect(la.ownerId).toBe(lb.ownerId);
    expect([la.isNewOwner, lb.isNewOwner].filter(Boolean)).toHaveLength(1);
    const logins = await deps.db.select().from(contacts).where(and(eq(contacts.ownerId, la.ownerId), eq(contacts.isLogin, true)));
    expect(logins).toHaveLength(1);
  });

  it("첫 로그인 경쟁에서 진 요청은 이긴 계정으로 로그인한다", async () => {
    const { deps } = makeKit(opened.db);
    const phone = nextPhone();
    const winner = await loginNewOwner(deps, phone);
    const otp = await requestOtp(deps, { phone, purpose: "login", ip: "1.2.7.1" });
    // 존재 확인이 경쟁 직전(아직 계정 없음)을 본 상황을 만든다. 이후 삽입은 고유 인덱스에 막힌다.
    let raced = false;
    const racing = new Proxy(deps.db, {
      get(target, prop, receiver) {
        if (prop === "select" && !raced) {
          raced = true;
          return () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const login = await loginWithOtp({ ...deps, db: racing }, otp.challengeId, otp.devCode!, "1.2.7.1");
    expect(raced).toBe(true);
    expect(login).toMatchObject({ ownerId: winner.ownerId, isNewOwner: false });
  });

  it("용도가 다른 인증번호나 잘못된 ID는 거절한다", async () => {
    const { deps } = makeKit(opened.db);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "1.2.3.6" });
    expect(await codeOf(verifyOtp(deps, otp.challengeId, otp.devCode!, "login", "10.3.0.1"))).toBe("otp_invalid");
    expect(await codeOf(verifyOtp(deps, "not-a-uuid", "123456", "login", "10.3.0.1"))).toBe("otp_invalid");
  });

  it("휴대폰 번호 형식과 요청 빈도를 검사한다", async () => {
    const { deps } = makeKit(opened.db);
    expect(await codeOf(requestOtp(deps, { phone: "02-123-4567", purpose: "login", ip: "9.9.9.9" }))).toBe("phone_invalid");
    for (let i = 0; i < 30; i += 1) await requestOtp(deps, { phone: nextPhone(), purpose: "login", ip: "9.9.9.8" });
    expect(await codeOf(requestOtp(deps, { phone: nextPhone(), purpose: "login", ip: "9.9.9.8" }))).toBe("rate_limited");
    // 같은 번호로는 1시간에 5번까지다(IP를 바꿔도).
    const phone = nextPhone();
    for (let i = 0; i < 5; i += 1) await requestOtp(deps, { phone, purpose: "login", ip: `9.9.8.${i}` });
    expect(await codeOf(requestOtp(deps, { phone, purpose: "login", ip: "9.9.8.9" }))).toBe("rate_limited");
  });

  it("세션은 만료되거나 로그아웃하면 쓸 수 없다", async () => {
    const kit = makeKit(opened.db);
    const login = await loginNewOwner(kit.deps);
    expect(await ownerFromSession(kit.deps, undefined)).toBeNull();
    kit.clock.advance(8 * 24 * 3_600_000);
    expect(await ownerFromSession(kit.deps, login.sessionToken)).toBeNull();

    const kit2 = makeKit(opened.db);
    const login2 = await loginNewOwner(kit2.deps);
    await revokeSession(kit2.deps, login2.sessionToken);
    expect(await ownerFromSession(kit2.deps, login2.sessionToken)).toBeNull();
  });
});

describe("배치 발급과 등록 코드", () => {
  it("세트마다 등록 코드 1개와 고유 토큰 N개를 만든다", async () => {
    const { deps } = makeKit(opened.db);
    const batch = await issueBatch(deps, { sku: "travel-set", setCount: 3, stickersPerSet: 8 });
    expect(batch.sets).toHaveLength(3);
    const tokens = batch.sets.flatMap((s) => s.tokens);
    expect(new Set(tokens).size).toBe(24);
    expect(new Set(batch.sets.map((s) => s.claimCode)).size).toBe(3);
  });

  it("잘못된 발급 요청은 거절한다", async () => {
    const { deps } = makeKit(opened.db);
    expect(await codeOf(issueBatch(deps, { sku: "Golf Tag", setCount: 1, stickersPerSet: 1 }))).toBe("sku_invalid");
    expect(await codeOf(issueBatch(deps, { sku: "golf", setCount: 0, stickersPerSet: 1 }))).toBe("set_count_invalid");
    expect(await codeOf(issueBatch(deps, { sku: "golf", setCount: 1, stickersPerSet: 99 }))).toBe("stickers_per_set_invalid");
  });

  it("코드를 등록하면 스티커가 켜지고, 같은 주인이 다시 넣어도 괜찮다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const batch = await issueBatch(deps, { sku: "golf-tag", setCount: 1, stickersPerSet: 2 });
    const typed = batch.sets[0].claimCode.toLowerCase().replace(/(.{4})/, "$1-");
    const claimed = await claimSet(deps, { ownerId: owner.ownerId, claimCode: typed, ip: "3.3.3.3" });
    expect(claimed.map((s) => s.status)).toEqual(["active", "active"]);
    const again = await claimSet(deps, { ownerId: owner.ownerId, claimCode: batch.sets[0].claimCode, ip: "3.3.3.3" });
    expect(again).toHaveLength(2);
  });

  it("다른 계정이 쓴 코드, 없는 코드, 형식이 틀린 코드는 거절한다", async () => {
    const { deps } = makeKit(opened.db);
    const a = await loginNewOwner(deps);
    const b = await loginNewOwner(deps);
    const batch = await issueBatch(deps, { sku: "golf-tag", setCount: 1, stickersPerSet: 1 });
    await claimSet(deps, { ownerId: a.ownerId, claimCode: batch.sets[0].claimCode, ip: "4.4.4.4" });
    expect(await codeOf(claimSet(deps, { ownerId: b.ownerId, claimCode: batch.sets[0].claimCode, ip: "4.4.4.4" }))).toBe("claim_code_used");
    expect(await codeOf(claimSet(deps, { ownerId: b.ownerId, claimCode: "ZZZZZZZZ", ip: "4.4.4.4" }))).toBe("claim_code_invalid");
    expect(await codeOf(claimSet(deps, { ownerId: b.ownerId, claimCode: "12", ip: "4.4.4.4" }))).toBe("claim_code_invalid");
    const [row] = await deps.db.select().from(stickers).where(eq(stickers.token, batch.sets[0].tokens[0]));
    expect(row.status).toBe("active");
  });

  it("등록 코드 대입 시도는 주인·IP 기준으로 막는다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    for (let i = 0; i < 10; i += 1) await codeOf(claimSet(deps, { ownerId: owner.ownerId, claimCode: "ZZZZZZZZ", ip: "5.5.5.5" }));
    expect(await codeOf(claimSet(deps, { ownerId: owner.ownerId, claimCode: "ZZZZZZZZ", ip: "5.5.5.5" }))).toBe("rate_limited");
  });
});
