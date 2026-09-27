import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq, gt, notInArray } from "drizzle-orm";
import { contacts, messages, notifications, otpChallenges, shortLinks } from "@/db/schema";
import type { OpenedDb } from "@/db/client";
import { verifyLink } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { SMS_MAX_BYTES, smsBytes } from "@/lib/sms";
import type { AlimtalkMessage, SmsMessage } from "@/server/notifier";
import { requestOtp } from "@/server/services/auth";
import { getThreadForFinder, postFinderMessage } from "@/server/services/finder";
import { alertUsage, setQuietHours, updateSticker } from "@/server/services/owner";
import { blockThread } from "@/server/services/replies";
import { purgeExpired } from "@/server/services/retention";
import { createShortLink, resolveShortLink } from "@/server/services/short-links";
import { issueAndClaim, loginNewOwner, makeKit, nextPhone, openTestDb } from "./helpers";

// 알림 비용 가드레일: 알림 한도, 문자용 짧은 링크, 인증번호 발송 제한.
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

let seq = 0;
const finder = (token: string, extra: Partial<Parameters<typeof postFinderMessage>[1]> = {}) => {
  seq += 1;
  return { token, deviceId: `cost-dev-${seq}`, ip: `172.30.${seq % 250}.1`, reason: "found", ...extra };
};
const alimtalks = (kit: ReturnType<typeof makeKit>) => kit.notifier.outbox.filter((o) => o.channel === "alimtalk").length;
const HOUR = 3_600_000;

describe("알림 한도", () => {
  it("태그당 하루 5개 대화까지 알리고, 6번째 새 대화는 저장만 한다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    for (let i = 0; i < 5; i += 1) expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(true);
    expect(alimtalks(kit)).toBe(5);

    const capped = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    expect(capped.notified).toBe(false);
    expect(alimtalks(kit)).toBe(5);
    const [row] = await kit.deps.db.select().from(messages).where(eq(messages.threadId, capped.threadId));
    expect(row).toMatchObject({ notifiedAt: null, notifySkip: "tag_daily_cap" });
    // 습득자 화면은 이 메시지가 알림 없이 저장됐다는 것을 안다.
    const view = await getThreadForFinder(kit.deps, set.tokens[0], capped.newFinderKey);
    expect(view.messages.at(-1)?.notified).toBe(false);

    kit.clock.advance(24 * HOUR + 60_000);
    expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(true);
  });

  it("같은 대화의 후속 메시지는 태그 한도를 쓰지 않고, 대화당 3건까지 알린다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const first = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const followUp = () => postFinderMessage(kit.deps, finder(set.tokens[0], { finderKey: first.newFinderKey }));
    expect((await followUp()).notified).toBe(true);
    expect((await followUp()).notified).toBe(true);
    const fourth = await followUp();
    expect(fourth.notified).toBe(false);
    const rows = await kit.deps.db.select({ skip: messages.notifySkip }).from(messages).where(eq(messages.threadId, first.threadId));
    expect(rows.filter((r) => r.skip === "thread_cap")).toHaveLength(1);
    // 한 사람이 여러 번 보내도 다른 습득자의 알림은 막히지 않는다(태그 한도는 대화 1개만 썼다).
    for (let i = 0; i < 4; i += 1) expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(true);
  });

  it("같은 IP에서는 한 태그에 새 대화를 하루 2개까지만 연다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId, 2);
    const [bag, pouch] = set.tokens;
    const ip = "172.31.0.9";
    const a = await postFinderMessage(kit.deps, finder(bag, { ip }));
    await postFinderMessage(kit.deps, finder(bag, { ip }));
    expect(await codeOf(postFinderMessage(kit.deps, finder(bag, { ip })))).toBe("rate_limited");
    // 이미 연 대화의 후속 메시지와 다른 태그는 막지 않는다.
    expect(await codeOf(postFinderMessage(kit.deps, finder(bag, { ip, finderKey: a.newFinderKey })))).toBe("ok");
    expect(await codeOf(postFinderMessage(kit.deps, finder(pouch, { ip })))).toBe("ok");
    kit.clock.advance(24 * HOUR + 60_000);
    expect(await codeOf(postFinderMessage(kit.deps, finder(bag, { ip })))).toBe("ok");
  });

  it("주인당 최근 30일 한도는 태그 여러 개를 합쳐 센다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.notifyPerOwnerMonthly = 3;
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId, 2);
    const [bag, pouch] = set.tokens;
    await postFinderMessage(kit.deps, finder(bag));
    await postFinderMessage(kit.deps, finder(bag));
    await postFinderMessage(kit.deps, finder(pouch));
    const capped = await postFinderMessage(kit.deps, finder(pouch));
    expect(capped.notified).toBe(false);
    const [row] = await kit.deps.db.select({ skip: messages.notifySkip }).from(messages).where(eq(messages.threadId, capped.threadId));
    expect(row.skip).toBe("owner_monthly_cap");

    kit.clock.advance(30 * 24 * HOUR + 60_000);
    expect((await postFinderMessage(kit.deps, finder(pouch))).notified).toBe(true);
  });

  it("주인이 차단한 대화는 30일 예산에서 빠진다(도배를 막으면 예산이 돌아온다)", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.notifyPerOwnerMonthly = 2;
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const spam = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    await postFinderMessage(kit.deps, finder(set.tokens[0]));
    expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(false);
    await blockThread(kit.deps, spam.threadId, { ownerId: owner.ownerId });
    expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(true);
  });

  it("주인은 최근 30일 알림 사용량과 알림 없이 저장된 메시지 수를 볼 수 있다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.notifyPerOwnerMonthly = 2;
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    for (let i = 0; i < 3; i += 1) await postFinderMessage(kit.deps, finder(set.tokens[0]));
    expect(await alertUsage(kit.deps, owner.ownerId)).toEqual({ used: 2, limit: 2, silenced: 1 });
  });

  it("방해금지로 미룬 알림도 한도에 들어간다", async () => {
    const kit = makeKit(opened.db, new Date(Date.UTC(2026, 8, 24, 14, 30))); // 23:30 KST
    kit.deps.config.notifyPerTagDaily = 1;
    const owner = await loginNewOwner(kit.deps);
    await setQuietHours(kit.deps, owner.ownerId, 23 * 60, 7 * 60);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const first = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    expect(first).toMatchObject({ notified: true, deferred: true });
    expect((await postFinderMessage(kit.deps, finder(set.tokens[0]))).notified).toBe(false);
  });

  it("알림 받을 번호가 하나도 없으면 no_contacts로 기록한다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    await kit.deps.db.delete(contacts).where(eq(contacts.ownerId, owner.ownerId));
    const res = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    expect(res.notified).toBe(false);
    const [row] = await kit.deps.db.select({ skip: messages.notifySkip }).from(messages).where(eq(messages.threadId, res.threadId));
    expect(row.skip).toBe("no_contacts");
  });
});

describe("문자용 짧은 링크", () => {
  it("알림톡이 실패하면 짧은 링크를 넣은 단문(90바이트 이하)으로 보낸다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    kit.notifier.failAlimtalk = true;
    await postFinderMessage(kit.deps, finder(set.tokens[0], { body: "비밀스러운 본문" }));
    const plain = kit.notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage;
    expect(plain.text).toMatch(/\/m\/[2-9A-HJ-NP-Z]{10}$/);
    expect(plain.text).not.toContain("비밀스러운 본문");
    expect(smsBytes(plain.text)).toBeLessThanOrEqual(SMS_MAX_BYTES);

    // 라벨이 단문에 들어가면 넣고, 길면 뺀다.
    await updateSticker(kit.deps, owner.ownerId, set.tokens[0], { label: "네이비 캐디백" });
    await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const labeled = (kit.notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage).text;
    expect(labeled).toContain("'네이비 캐디백' 태그로");
    await updateSticker(kit.deps, owner.ownerId, set.tokens[0], { label: "아주아주긴이름의골프백과파우치세트용태그" });
    await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const long = (kit.notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage).text;
    expect(long).toContain("등록한 태그로");
    expect(smsBytes(long)).toBeLessThanOrEqual(SMS_MAX_BYTES);
  });

  it("사이트 주소가 너무 길어 단문을 넘어도 문자는 보낸다(비용 경고만 남긴다)", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.publicBaseUrl = "https://baghome-web-git-main-preview-deployment-example.vercel.app";
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    kit.notifier.failAlimtalk = true;
    await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const text = (kit.notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage).text;
    expect(text).toContain("등록한 태그로");
    expect(smsBytes(text)).toBeGreaterThan(SMS_MAX_BYTES);
  });

  it("짧은 링크는 15분 동안 서명된 답장 링크로, 지나면 로그인 답장 화면으로 이어진다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const res = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const url = await createShortLink(kit.deps, res.threadId);
    const code = url.split("/m/")[1];

    const target = await resolveShortLink(kit.deps, code.toLowerCase(), "10.9.9.1");
    const parsed = new URL(target!, "http://x");
    expect(parsed.pathname).toBe(`/r/${res.threadId}`);
    const e = Number(parsed.searchParams.get("e"));
    const s = parsed.searchParams.get("s")!;
    expect(verifyLink(res.threadId, e, s, kit.deps.keys.link, Math.floor(kit.deps.now().getTime() / 1000))).toBe("valid");

    kit.clock.advance(16 * 60_000);
    expect(await resolveShortLink(kit.deps, code, "10.9.9.1")).toBe(`/r/${res.threadId}`);
    expect(await resolveShortLink(kit.deps, "ZZZZZZZZZZ", "10.9.9.1")).toBeNull();
    expect(await resolveShortLink(kit.deps, "not-a-code", "10.9.9.1")).toBeNull();
    const [row] = await kit.deps.db.select().from(shortLinks).where(eq(shortLinks.code, code));
    expect(row.threadId).toBe(res.threadId);
  });

  it("답장 기간이 끝난 대화의 짧은 링크는 정리한다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const res = await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const code = (await createShortLink(kit.deps, res.threadId)).split("/m/")[1];
    kit.clock.advance(73 * HOUR);
    const purged = await purgeExpired(kit.deps);
    expect(purged.shortLinks).toBeGreaterThanOrEqual(1);
    expect(await resolveShortLink(kit.deps, code, "10.9.9.3")).toBeNull();
  });

  it("짧은 링크를 무작위로 두드리면 IP 단위로 막는다", async () => {
    const kit = makeKit(opened.db);
    for (let i = 0; i < 30; i += 1) await resolveShortLink(kit.deps, "ZZZZZZZZZZ", "10.9.9.2");
    expect(await codeOf(resolveShortLink(kit.deps, "ZZZZZZZZZZ", "10.9.9.2"))).toBe("rate_limited");
  });

  it("딜러사 오류 문구에 섞인 전화번호는 가리고 기록한다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const failing = {
      sendAlimtalk: async () => {
        throw new Error("invalid recipient 010-1234-5678");
      },
      sendSms: async () => {
        throw new Error("blocked number 01012345678 by carrier");
      },
    };
    const res = await postFinderMessage({ ...kit.deps, notifier: failing }, finder(set.tokens[0]));
    const [row] = await kit.deps.db
      .select({ lastError: notifications.lastError })
      .from(notifications)
      .innerJoin(messages, eq(messages.id, notifications.messageId))
      .where(eq(messages.threadId, res.threadId));
    expect(row.lastError).toContain("blocked number");
    expect(row.lastError).not.toMatch(/\d{3,}-?\d{3,4}-?\d{4}/);
  });

  it("알림톡에는 짧은 링크가 아니라 전체 답장 링크가 간다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    await postFinderMessage(kit.deps, finder(set.tokens[0]));
    const alimtalk = kit.notifier.outbox.find((o) => o.channel === "alimtalk")!.payload as AlimtalkMessage;
    expect(alimtalk.vars.link).toContain("/r/");
  });
});

describe("인증번호 발송 제한", () => {
  it("IP당 1시간 30건, 하루 100건까지 보낸다(동호회 공용 와이파이 단체 등록 고려)", async () => {
    const kit = makeKit(opened.db);
    const ip = "10.40.0.1";
    const burst = async (n: number) => {
      for (let i = 0; i < n; i += 1) await requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip });
    };
    await burst(30);
    expect(await codeOf(requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip }))).toBe("rate_limited");
    for (const n of [30, 30, 10]) {
      kit.clock.advance(HOUR + 60_000);
      await burst(n);
    }
    kit.clock.advance(HOUR + 60_000);
    expect(await codeOf(requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip }))).toBe("rate_limited");
  });

  it("서비스 전체 하루 상한은 처음 보는 번호에만 건다(이미 가입한 주인은 계속 로그인한다)", async () => {
    const kit = makeKit(opened.db);
    const member = await loginNewOwner(kit.deps);
    const base = await unknownOtpCount(kit);
    kit.deps.config.otpDailyCap = base + 2;
    await requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip: "10.41.0.1" });
    await requestOtp(kit.deps, { phone: nextPhone(), purpose: "login", ip: "10.41.0.2" });
    const sent = kit.notifier.outbox.length;
    const stranger = nextPhone();
    let status = 0;
    try {
      await requestOtp(kit.deps, { phone: stranger, purpose: "login", ip: "10.41.0.3" });
    } catch (err) {
      if (!isAppError(err)) throw err;
      expect(err.code).toBe("otp_unavailable");
      status = err.status;
    }
    expect(status).toBe(503);
    expect(kit.notifier.outbox.length).toBe(sent);
    expect(await unknownOtpCount(kit)).toBe(base + 2);

    // 가입한 주인의 번호는 상한과 무관하게 보낸다.
    expect(await codeOf(requestOtp(kit.deps, { phone: member.phone, purpose: "login", ip: "10.41.0.4" }))).toBe("ok");
    // 503을 받은 요청은 번호·IP 한도를 쓰지 않는다: 상한이 풀리면 같은 번호로 바로 5번 받을 수 있다.
    kit.deps.config.otpDailyCap = 100_000;
    for (let i = 0; i < 5; i += 1) expect(await codeOf(requestOtp(kit.deps, { phone: stranger, purpose: "login", ip: `10.41.1.${i}` }))).toBe("ok");
  });

  it("연락처 추가용 인증번호는 주인당 하루 5건까지다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const add = (i: number) => requestOtp(kit.deps, { phone: nextPhone(), purpose: "add_contact", ip: `10.42.0.${i}`, ownerId: owner.ownerId });
    for (let i = 0; i < 5; i += 1) await add(i);
    expect(await codeOf(add(9))).toBe("rate_limited");
  });
});

async function unknownOtpCount(kit: ReturnType<typeof makeKit>): Promise<number> {
  const since = new Date(kit.deps.now().getTime() - 24 * HOUR);
  const known = kit.deps.db.select({ h: contacts.phoneHmac }).from(contacts);
  const [{ n }] = await kit.deps.db
    .select({ n: count() })
    .from(otpChallenges)
    .where(and(gt(otpChallenges.createdAt, since), notInArray(otpChallenges.phoneHmac, known)));
  return n;
}
