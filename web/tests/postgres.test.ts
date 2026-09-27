import { randomInt } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { openDb, type OpenedDb } from "@/db/client";
import { contacts, messages, threads } from "@/db/schema";
import { isAppError } from "@/lib/errors";
import { loginWithOtp, requestOtp, verifyOtp } from "@/server/services/auth";
import { postFinderMessage } from "@/server/services/finder";
import { postOwnerReply } from "@/server/services/replies";
import { issueAndClaim, loginNewOwner, makeKit } from "./helpers";

// 실제 Postgres(연결 여러 개)에서 동시 요청 경쟁을 검증한다.
// PGlite는 연결이 하나라 트랜잭션이 줄을 서므로 이 경쟁이 재현되지 않는다.
// 실행: TEST_DATABASE_URL=postgres://… npx vitest run tests/postgres.test.ts
// DB를 지우지 않는다. 같은 DB로 다시 돌려도 겹치지 않게 번호를 실행마다 새로 만든다.
const url = process.env.TEST_DATABASE_URL;
const freshPhone = () => `010-${randomInt(2000, 10000)}-${randomInt(1000, 10000)}`;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (isAppError(err)) return err.code;
    throw err;
  }
}

describe.skipIf(!url)("Postgres 동시성", () => {
  let opened: OpenedDb;
  beforeAll(async () => {
    opened = await openDb({ databaseUrl: url, migrationsFolder: path.resolve(__dirname, "../drizzle") });
  });
  afterAll(async () => {
    await opened?.close();
  });

  it("습득자 메시지가 동시에 몰려도 스레드 한도를 넘지 않는다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.maxThreadMessages = 3;
    const owner = await loginNewOwner(kit.deps, freshPhone());
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const req = (i: number) => ({ token: set.tokens[0], deviceId: `pg-dev-${i}`, ip: `10.50.0.${i}`, reason: "found" });
    const first = await postFinderMessage(kit.deps, req(0), { dispatchInline: false });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => codeOf(postFinderMessage(kit.deps, { ...req(i + 1), finderKey: first.newFinderKey }, { dispatchInline: false }))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect(results.filter((r) => r === "thread_full")).toHaveLength(6);
    const [thread] = await opened.db.select().from(threads).where(eq(threads.id, first.threadId));
    expect(thread.messageCount).toBe(3);
    expect(await opened.db.select().from(messages).where(eq(messages.threadId, first.threadId))).toHaveLength(3);
  });

  it("습득자 메시지가 동시에 몰려도 태그 알림 한도를 넘지 않는다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.notifyPerTagDaily = 3;
    const owner = await loginNewOwner(kit.deps, freshPhone());
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        postFinderMessage(kit.deps, { token: set.tokens[0], deviceId: `pg-cap-${i}`, ip: `10.54.0.${i}`, reason: "found" }, { dispatchInline: false }),
      ),
    );
    expect(results.filter((r) => r.notified)).toHaveLength(3);
    const rows = await opened.db
      .select({ notifiedAt: messages.notifiedAt, skip: messages.notifySkip })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(eq(threads.token, set.tokens[0]));
    expect(rows.filter((r) => r.notifiedAt !== null)).toHaveLength(3);
    expect(rows.filter((r) => r.skip === "tag_daily_cap")).toHaveLength(5);
  });

  it("주인 답장이 동시에 몰려도 스레드 한도를 넘지 않는다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.maxThreadMessages = 3;
    const owner = await loginNewOwner(kit.deps, freshPhone());
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const finder = await postFinderMessage(kit.deps, { token: set.tokens[0], deviceId: "pg-reply", ip: "10.51.0.1", reason: "found" }, { dispatchInline: false });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => codeOf(postOwnerReply(kit.deps, { threadId: finder.threadId, auth: { ownerId: owner.ownerId }, replyCode: "seen" }))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect(results.filter((r) => r === "thread_full")).toHaveLength(4);
  });

  it("틀린 인증번호가 동시에 몰려도 시도 한도(5회)를 넘지 않는다", async () => {
    const { deps } = makeKit(opened.db);
    const otp = await requestOtp(deps, { phone: freshPhone(), purpose: "login", ip: "10.52.0.1" });
    const wrong = otp.devCode === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => codeOf(verifyOtp(deps, otp.challengeId, wrong, "login", `10.52.1.${i}`))),
    );
    expect(results.filter((r) => r === "otp_mismatch")).toHaveLength(5);
    expect(results.filter((r) => r === "otp_locked")).toHaveLength(5);
  });

  it("같은 번호의 첫 로그인이 동시에 와도 계정은 하나다", async () => {
    const { deps } = makeKit(opened.db);
    const phone = freshPhone();
    const otps = [];
    for (let i = 0; i < 4; i += 1) otps.push(await requestOtp(deps, { phone, purpose: "login", ip: `10.53.0.${i}` }));
    const logins = await Promise.all(otps.map((o, i) => loginWithOtp(deps, o.challengeId, o.devCode!, `10.53.0.${i}`)));
    expect(new Set(logins.map((l) => l.ownerId)).size).toBe(1);
    expect(logins.filter((l) => l.isNewOwner)).toHaveLength(1);
    const rows = await opened.db.select().from(contacts).where(and(eq(contacts.ownerId, logins[0].ownerId), eq(contacts.isLogin, true)));
    expect(rows).toHaveLength(1);
  });
});
