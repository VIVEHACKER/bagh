import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { contacts, messages, notifications, threads } from "@/db/schema";
import type { OpenedDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import type { SmsMessage } from "@/server/notifier";
import { issueBatch } from "@/server/services/batch";
import { getFinderView, getThreadForFinder, postFinderMessage } from "@/server/services/finder";
import { dispatchDue } from "@/server/services/notifications";
import { addContact, listContacts, removeContact, setQuietHours, updateSticker } from "@/server/services/owner";
import { requestOtp } from "@/server/services/auth";
import { issueAndClaim, loginNewOwner, makeKit, nextPhone, openTestDb } from "./helpers";

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

let ipSeq = 0;
const finderReq = (token: string, extra: Partial<Parameters<typeof postFinderMessage>[1]> = {}) => {
  ipSeq += 1;
  return { token, deviceId: `dev-${ipSeq}`, ip: `172.16.0.${ipSeq % 250}`, reason: "found", place: "3층 안내데스크", body: "캐디백 보관 중이에요", ...extra };
};

describe("습득자 화면 상태", () => {
  it("스캔한 사람이 누구든 같은 상태를 보여 준다(주인 자동 판별 없음)", async () => {
    const { deps } = makeKit(opened.db);
    const batch = await issueBatch(deps, { sku: "golf-tag", setCount: 1, stickersPerSet: 1 });
    const token = batch.sets[0].tokens[0];
    expect((await getFinderView(deps, token)).state).toBe("unregistered");
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    expect((await getFinderView(deps, set.tokens[0].toLowerCase())).state).toBe("active");
    await updateSticker(deps, owner.ownerId, set.tokens[0], { status: "paused" });
    expect((await getFinderView(deps, set.tokens[0])).state).toBe("unavailable");
    expect((await getFinderView(deps, "NOPE")).state).toBe("not_found");
    expect((await getFinderView(deps, "ZZZZZZZZZZ")).state).toBe("not_found");
  });
});

describe("습득자 메시지와 알림", () => {
  it("메시지를 받으면 주인에게 알림톡을 보내고, 같은 습득자의 후속 메시지는 같은 스레드로 묶는다", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    const first = await postFinderMessage(deps, finderReq(set.tokens[0]));
    expect(first.newFinderKey).toBeTruthy();
    expect(first.deferred).toBe(false);
    const alimtalk = notifier.outbox.filter((o) => o.channel === "alimtalk");
    expect(alimtalk).toHaveLength(1);
    expect(JSON.stringify(alimtalk[0].payload)).toContain("/r/");

    const second = await postFinderMessage(deps, finderReq(set.tokens[0], { finderKey: first.newFinderKey, reason: "other", body: "경비실로 옮겼어요" }));
    expect(second.threadId).toBe(first.threadId);
    expect(second.newFinderKey).toBeUndefined();
    const view = await getThreadForFinder(deps, set.tokens[0], first.newFinderKey);
    expect(view.messages.map((m) => m.sender)).toEqual(["finder", "finder"]);
  });

  it("등록 전·일시정지 태그, 잘못된 사유는 받지 않는다", async () => {
    const { deps } = makeKit(opened.db);
    const batch = await issueBatch(deps, { sku: "golf-tag", setCount: 1, stickersPerSet: 1 });
    expect(await codeOf(postFinderMessage(deps, finderReq(batch.sets[0].tokens[0])))).toBe("sticker_not_active");
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { reason: "call_me" })))).toBe("reason_invalid");
    expect(await codeOf(postFinderMessage(deps, finderReq("BADTOKEN")))).toBe("sticker_not_found");
    expect(await codeOf(postFinderMessage(deps, finderReq("ZZZZZZZZZZ")))).toBe("sticker_not_found");
  });

  it("같은 사람(기기)이 한 태그에 10분 동안 3건을 넘으면 화면에서만 막고, 다른 습득자는 막지 않는다", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    const first = await postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "dev-spam", ip: "172.20.0.1" }));
    // 브라우저는 대화 쿠키를 보내므로 같은 사람의 후속 메시지는 같은 대화로 묶인다.
    const spammer = { deviceId: "dev-spam", ip: "172.20.0.1", finderKey: first.newFinderKey };
    for (let i = 0; i < 2; i += 1) await postFinderMessage(deps, finderReq(set.tokens[0], spammer));
    const before = notifier.outbox.length;
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], spammer)))).toBe("rate_limited");
    // 호출자에게 SMS 경고를 보내지 않는다(발송함이 그대로다).
    expect(notifier.outbox.length).toBe(before);
    // IP만 바꿔도 같은 기기면 막힌다.
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { ...spammer, ip: "172.20.0.9" })))).toBe("rate_limited");
    // 한 사람이 태그 전체를 침묵시키지 못한다.
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "dev-honest", ip: "172.20.0.2" })))).toBe("ok");
  });

  it("기기를 바꿔 가며 보내도 같은 IP는 한 태그에 새 대화 하루 2개, 메시지 10분 5건까지다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    const ip = "172.21.0.1";
    const a = await postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "rot-a", ip }));
    const b = await postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "rot-b", ip }));
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "rot-c", ip })))).toBe("rate_limited");
    for (const [i, key] of [a.newFinderKey, b.newFinderKey, a.newFinderKey].entries()) {
      await postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: `rot-f${i}`, ip, finderKey: key }));
    }
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "rot-g", ip, finderKey: a.newFinderKey })))).toBe("rate_limited");
  });

  it("태그 하나로 한 시간에 30건이 넘게 오면 주인을 위해 막는다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    for (let i = 0; i < 30; i += 1) {
      expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: `crowd-${i}`, ip: `172.22.${i}.1` })))).toBe("ok");
    }
    expect(await codeOf(postFinderMessage(deps, finderReq(set.tokens[0], { deviceId: "crowd-x", ip: "172.22.99.1" })))).toBe("rate_limited");
  });

  it("동시에 보내도 스레드 메시지 한도를 넘지 않는다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.maxThreadMessages = 3;
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const first = await postFinderMessage(kit.deps, finderReq(set.tokens[0]), { dispatchInline: false });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        codeOf(postFinderMessage(kit.deps, finderReq(set.tokens[0], { finderKey: first.newFinderKey }), { dispatchInline: false })),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect(results.filter((r) => r === "thread_full")).toHaveLength(3);
    const [thread] = await kit.deps.db.select().from(threads).where(eq(threads.id, first.threadId));
    expect(thread.messageCount).toBe(3);
    expect(await kit.deps.db.select().from(messages).where(eq(messages.threadId, first.threadId))).toHaveLength(3);
    // 이 테스트가 쌓은 알림을 비워 다음 테스트의 발송함에 섞이지 않게 한다.
    await dispatchDue(kit.deps);
  });

  it("스레드는 메시지 10개까지이고, 72시간이 지나면 새 스레드가 된다", async () => {
    const kit = makeKit(opened.db);
    kit.deps.config.maxThreadMessages = 2;
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const first = await postFinderMessage(kit.deps, finderReq(set.tokens[0]));
    await postFinderMessage(kit.deps, finderReq(set.tokens[0], { finderKey: first.newFinderKey }));
    kit.clock.advance(11 * 60_000);
    expect(await codeOf(postFinderMessage(kit.deps, finderReq(set.tokens[0], { finderKey: first.newFinderKey })))).toBe("thread_full");
    kit.clock.advance(73 * 3_600_000);
    expect(await codeOf(getThreadForFinder(kit.deps, set.tokens[0], first.newFinderKey))).toBe("thread_expired");
    const fresh = await postFinderMessage(kit.deps, finderReq(set.tokens[0], { finderKey: first.newFinderKey }));
    expect(fresh.threadId).not.toBe(first.threadId);
    expect(await codeOf(getThreadForFinder(kit.deps, set.tokens[0], undefined))).toBe("thread_not_found");
    expect(await codeOf(getThreadForFinder(kit.deps, set.tokens[0], "wrong-key"))).toBe("thread_not_found");
  });

  it("연락처가 여러 개면 동시에 모두 알린다(미확인 에스컬레이션 없음)", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "8.8.8.8", ownerId: owner.ownerId });
    await addContact(deps, owner.ownerId, otp.challengeId, otp.devCode!, "8.8.8.8");
    const set = await issueAndClaim(deps, owner.ownerId);
    await postFinderMessage(deps, finderReq(set.tokens[0]));
    const sent = notifier.outbox.filter((o) => o.channel === "alimtalk");
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((s) => s.to)).size).toBe(2);
  });

  it("방해금지 시간에는 미뤘다가 끝나면 보낸다(다른 번호로 돌리지 않음)", async () => {
    const kit = makeKit(opened.db, new Date(Date.UTC(2026, 8, 24, 14, 30))); // 23:30 KST
    const owner = await loginNewOwner(kit.deps);
    await setQuietHours(kit.deps, owner.ownerId, 23 * 60, 7 * 60);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const res = await postFinderMessage(kit.deps, finderReq(set.tokens[0]));
    expect(res.deferred).toBe(true);
    expect(kit.notifier.outbox.filter((o) => o.channel === "alimtalk")).toHaveLength(0);
    kit.clock.set(new Date(Date.UTC(2026, 8, 24, 22, 1))); // 07:01 KST
    const report = await dispatchDue(kit.deps);
    expect(report.sent).toBeGreaterThanOrEqual(1);
    expect(kit.notifier.outbox.filter((o) => o.channel === "alimtalk")).toHaveLength(1);
  });

  it("알림톡이 실패하면 SMS로 보내되 습득자 본문은 싣지 않는다", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, owner.ownerId);
    notifier.failAlimtalk = true;
    await postFinderMessage(deps, finderReq(set.tokens[0], { body: "비밀스러운 본문" }));
    const sms = notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage;
    expect(sms.text).toContain("/m/");
    expect(sms.text).toContain("등록한 태그로");
    expect(sms.text).not.toContain("비밀스러운 본문");

    await updateSticker(deps, owner.ownerId, set.tokens[0], { label: "네이비 캐디백" });
    await postFinderMessage(deps, finderReq(set.tokens[0], { reason: "other" }));
    const labeled = notifier.outbox.filter((o) => o.channel === "sms").at(-1)!.payload as SmsMessage;
    expect(labeled.text).toContain("'네이비 캐디백' 태그로");
  });

  it("둘 다 실패하면 재시도하다가 3번째에 실패로 끝낸다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    kit.notifier.failAlimtalk = true;
    kit.notifier.failSms = true;
    await postFinderMessage(kit.deps, finderReq(set.tokens[0]));
    const second = await dispatchDue(kit.deps);
    const third = await dispatchDue(kit.deps);
    expect(second.retried + third.failed).toBeGreaterThanOrEqual(1);
    const rows = await kit.deps.db.select().from(notifications).where(eq(notifications.status, "failed"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.attempts === 3)).toBe(true);
  });
});

describe("알림 발송 복원력", () => {
  async function ownerWithTwoContacts(kit: ReturnType<typeof makeKit>, ip: string) {
    const owner = await loginNewOwner(kit.deps);
    const otp = await requestOtp(kit.deps, { phone: nextPhone(), purpose: "add_contact", ip, ownerId: owner.ownerId });
    await addContact(kit.deps, owner.ownerId, otp.challengeId, otp.devCode!, ip);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    return { owner, set };
  }

  async function statusesOf(kit: ReturnType<typeof makeKit>, ownerId: string) {
    const rows = await kit.deps.db
      .select({ status: notifications.status })
      .from(notifications)
      .innerJoin(contacts, eq(contacts.id, notifications.contactId))
      .where(eq(contacts.ownerId, ownerId));
    return rows.map((r) => r.status).sort();
  }

  it("한 연락처의 발송 준비가 실패해도 다른 연락처에는 보낸다", async () => {
    const kit = makeKit(opened.db);
    const { owner, set } = await ownerWithTwoContacts(kit, "8.8.4.1");
    // 로그인 번호의 암호문을 망가뜨린다(키 교체 실수 같은 상황).
    await kit.deps.db
      .update(contacts)
      .set({ phoneEnc: "v1.broken.broken.broken" })
      .where(and(eq(contacts.ownerId, owner.ownerId), eq(contacts.isLogin, true)));
    await postFinderMessage(kit.deps, finderReq(set.tokens[0]));
    expect(await statusesOf(kit, owner.ownerId)).toEqual(["queued", "sent"]);
  });

  it("한 건의 기록 오류가 발송 루프 전체를 멈추지 않는다", async () => {
    const kit = makeKit(opened.db);
    const { owner, set } = await ownerWithTwoContacts(kit, "8.8.4.2");
    await postFinderMessage(kit.deps, finderReq(set.tokens[0]), { dispatchInline: false });
    const db = kit.deps.db;
    let updates = 0;
    const flaky = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "update") return Reflect.get(target, prop, receiver);
        return (table: Parameters<typeof db.update>[0]) => {
          updates += 1;
          // 1번째는 멈춘 행 정리, 2번째는 첫 건 선점이다. 선점에서 DB가 한 번 끊긴 상황.
          if (updates === 2) throw new Error("db blip");
          return target.update(table);
        };
      },
    });
    const report = await dispatchDue({ ...kit.deps, db: flaky });
    expect(updates).toBeGreaterThan(2);
    expect(report.sent).toBeGreaterThanOrEqual(1);
    await dispatchDue(kit.deps);
    expect(await statusesOf(kit, owner.ownerId)).toEqual(["sent", "sent"]);
  });

  it("발송 중 멈춘 워커가 남긴 알림은 10분 뒤 실패로 정리한다", async () => {
    const kit = makeKit(opened.db);
    const owner = await loginNewOwner(kit.deps);
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    await postFinderMessage(kit.deps, finderReq(set.tokens[0]), { dispatchInline: false });
    const [row] = await kit.deps.db
      .select({ id: notifications.id })
      .from(notifications)
      .innerJoin(contacts, eq(contacts.id, notifications.contactId))
      .where(eq(contacts.ownerId, owner.ownerId));
    // 마지막 시도를 선점한 뒤 워커가 멈춘 상태를 흉내 낸다.
    await kit.deps.db.update(notifications).set({ attempts: 3 }).where(eq(notifications.id, row.id));
    kit.clock.advance(5 * 60_000);
    await dispatchDue(kit.deps);
    expect(await statusesOf(kit, owner.ownerId)).toEqual(["queued"]);
    kit.clock.advance(6 * 60_000);
    const report = await dispatchDue(kit.deps);
    expect(report.failed).toBeGreaterThanOrEqual(1);
    const [after] = await kit.deps.db.select().from(notifications).where(eq(notifications.id, row.id));
    expect(after).toMatchObject({ status: "failed", lastError: "worker_stopped" });
  });

  it("알림 기록이 있는 번호도 지울 수 있다(그 번호의 알림 기록도 함께 지운다)", async () => {
    const kit = makeKit(opened.db);
    const { owner, set } = await ownerWithTwoContacts(kit, "8.8.4.3");
    await postFinderMessage(kit.deps, finderReq(set.tokens[0]));
    const extra = (await listContacts(kit.deps, owner.ownerId)).find((c) => !c.isLogin)!;
    expect(await removeContact(kit.deps, owner.ownerId, extra.id)).toHaveLength(1);
    expect(await kit.deps.db.select().from(notifications).where(eq(notifications.contactId, extra.id))).toHaveLength(0);
  });
});
