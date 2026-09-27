import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenedDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import type { AlimtalkMessage } from "@/server/notifier";
import { requestOtp } from "@/server/services/auth";
import { dispatchSafely, getThreadForFinder, postFinderMessage } from "@/server/services/finder";
import {
  addContact,
  getQuietHours,
  listContacts,
  listStickers,
  listThreads,
  removeContact,
  sendTestNotification,
  setQuietHours,
  updateSticker,
} from "@/server/services/owner";
import { blockThread, openThreadForOwner, postOwnerReply } from "@/server/services/replies";
import { purgeExpired } from "@/server/services/retention";
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

function linkParts(message: AlimtalkMessage) {
  const url = new URL(message.vars.link);
  return { threadId: url.pathname.split("/").at(-1)!, e: Number(url.searchParams.get("e")), s: url.searchParams.get("s")! };
}

async function scenario() {
  const kit = makeKit(opened.db);
  const owner = await loginNewOwner(kit.deps);
  const set = await issueAndClaim(kit.deps, owner.ownerId);
  const finder = await postFinderMessage(kit.deps, {
    token: set.tokens[0],
    deviceId: `d-${Math.random()}`,
    ip: "192.168.0.10",
    reason: "found",
    place: "클럽하우스 로비",
  });
  const alimtalk = kit.notifier.outbox.find((o) => o.channel === "alimtalk")!.payload as AlimtalkMessage;
  return { kit, owner, set, finder, link: linkParts(alimtalk) };
}

describe("주인 답장", () => {
  it("알림톡 링크로 답장하면 습득자 화면에 보인다", async () => {
    const { kit, set, finder, link } = await scenario();
    const opened = await openThreadForOwner(kit.deps, link.threadId, { link: { e: link.e, s: link.s } });
    expect(opened.messages[0].placeText).toBe("클럽하우스 로비");
    await postOwnerReply(kit.deps, { threadId: link.threadId, auth: { link: { e: link.e, s: link.s } }, replyCode: "coming" });
    const view = await getThreadForFinder(kit.deps, set.tokens[0], finder.newFinderKey);
    expect(view.messages.at(-1)).toMatchObject({ sender: "owner", replyCode: "coming" });
  });

  it("만료·변조된 링크와 남의 세션은 거절한다", async () => {
    const { kit, link } = await scenario();
    const other = await loginNewOwner(kit.deps);
    expect(await codeOf(openThreadForOwner(kit.deps, link.threadId, { link: { e: link.e, s: `${link.s}x` } }))).toBe("link_invalid");
    expect(await codeOf(openThreadForOwner(kit.deps, link.threadId, { ownerId: other.ownerId }))).toBe("not_owner");
    expect(await codeOf(openThreadForOwner(kit.deps, "not-a-thread", { ownerId: other.ownerId }))).toBe("thread_not_found");
    kit.clock.advance(16 * 60_000);
    expect(await codeOf(postOwnerReply(kit.deps, { threadId: link.threadId, auth: { link: { e: link.e, s: link.s } }, replyCode: "seen" }))).toBe("link_expired");
  });

  it("링크가 만료돼도 로그인한 주인은 같은 화면에서 이어서 답장한다", async () => {
    const { kit, owner, link } = await scenario();
    kit.clock.advance(16 * 60_000);
    const auth = { link: { e: link.e, s: link.s }, ownerId: owner.ownerId };
    const view = await openThreadForOwner(kit.deps, link.threadId, auth);
    expect(view.via).toBe("session");
    await postOwnerReply(kit.deps, { threadId: link.threadId, auth, replyCode: "seen" });
    const other = await loginNewOwner(kit.deps);
    expect(await codeOf(postOwnerReply(kit.deps, { threadId: link.threadId, auth: { link: auth.link, ownerId: other.ownerId }, replyCode: "seen" }))).toBe(
      "link_expired",
    );
    expect(await codeOf(openThreadForOwner(kit.deps, link.threadId, {}))).toBe("unauthorized");
  });

  it("동시에 답장해도 메시지 한도를 넘지 않는다", async () => {
    const { kit, owner, link } = await scenario();
    kit.deps.config.maxThreadMessages = 3; // 습득자 1 + 답장 2
    const auth = { ownerId: owner.ownerId };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => codeOf(postOwnerReply(kit.deps, { threadId: link.threadId, auth, replyCode: "seen" }))),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(2);
    expect(results.filter((r) => r === "thread_full")).toHaveLength(2);
  });

  it("빈 답장, 기간이 끝난 대화에는 답장할 수 없다", async () => {
    const { kit, owner, link } = await scenario();
    const auth = { ownerId: owner.ownerId };
    expect(await codeOf(postOwnerReply(kit.deps, { threadId: link.threadId, auth, replyCode: "unknown" }))).toBe("reply_empty");
    await postOwnerReply(kit.deps, { threadId: link.threadId, auth, body: "  바로 갈게요  " });
    kit.clock.advance(73 * 3_600_000);
    expect(await codeOf(postOwnerReply(kit.deps, { threadId: link.threadId, auth, replyCode: "seen" }))).toBe("thread_expired");
  });

  it("주인이 대화를 막으면 습득자는 더 보낼 수 없다", async () => {
    const { kit, owner, set, finder, link } = await scenario();
    await blockThread(kit.deps, link.threadId, { ownerId: owner.ownerId });
    expect(
      await codeOf(
        postFinderMessage(kit.deps, { token: set.tokens[0], finderKey: finder.newFinderKey, deviceId: "d-block", ip: "192.168.0.11", reason: "other" }),
      ),
    ).toBe("thread_blocked");
  });
});

describe("주인 설정", () => {
  it("스티커 이름·상태를 바꾸고, 남의 태그는 못 바꾼다", async () => {
    const { deps } = makeKit(opened.db);
    const a = await loginNewOwner(deps);
    const b = await loginNewOwner(deps);
    const set = await issueAndClaim(deps, a.ownerId, 2);
    const updated = await updateSticker(deps, a.ownerId, set.tokens[0], { label: "  캐디백   네이비 ", status: "paused" });
    expect(updated).toMatchObject({ label: "캐디백 네이비", status: "paused" });
    expect((await listStickers(deps, a.ownerId)).map((s) => s.token)).toEqual(set.tokens);
    expect(await codeOf(updateSticker(deps, b.ownerId, set.tokens[0], { label: "x" }))).toBe("not_owner");
    expect(await codeOf(updateSticker(deps, a.ownerId, "ZZZZZZZZZZ", { label: "x" }))).toBe("sticker_not_found");
    expect((await updateSticker(deps, a.ownerId, set.tokens[0], { label: "" })).label).toBeNull();
  });

  it("연락처는 인증한 번호만 3개까지, 로그인 번호는 지울 수 없다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const stranger = await loginNewOwner(deps);
    const otpForOther = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "7.7.7.1", ownerId: stranger.ownerId });
    expect(await codeOf(addContact(deps, owner.ownerId, otpForOther.challengeId, otpForOther.devCode!, "7.7.9.1"))).toBe("otp_owner_mismatch");

    for (let i = 0; i < 2; i += 1) {
      const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: `7.7.7.${i + 2}`, ownerId: owner.ownerId });
      await addContact(deps, owner.ownerId, otp.challengeId, otp.devCode!, "7.7.9.1");
    }
    const list = await listContacts(deps, owner.ownerId);
    expect(list).toHaveLength(3);
    expect(list[0].isLogin).toBe(true);
    expect(list[0].masked).toMatch(/^010-\*{4}-\d{4}$/);
    const otp4 = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "7.7.7.9", ownerId: owner.ownerId });
    expect(await codeOf(addContact(deps, owner.ownerId, otp4.challengeId, otp4.devCode!, "7.7.9.1"))).toBe("contacts_full");
    expect(await codeOf(removeContact(deps, owner.ownerId, list[0].id))).toBe("contact_is_login");
    expect(await removeContact(deps, owner.ownerId, list[2].id)).toHaveLength(2);
    expect(await codeOf(removeContact(deps, owner.ownerId, list[2].id))).toBe("contact_not_found");
  });

  it("방해금지 시간은 시작·끝을 함께 정하거나 함께 끈다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    await setQuietHours(deps, owner.ownerId, 22 * 60, 7 * 60);
    expect(await getQuietHours(deps, owner.ownerId)).toEqual({ startMin: 1320, endMin: 420 });
    expect(await codeOf(setQuietHours(deps, owner.ownerId, 22 * 60, null))).toBe("quiet_hours_invalid");
    expect(await codeOf(setQuietHours(deps, owner.ownerId, 1440, 10))).toBe("quiet_hours_invalid");
    expect(await codeOf(setQuietHours(deps, owner.ownerId, 600, 600))).toBe("quiet_hours_invalid");
    await setQuietHours(deps, owner.ownerId, null, null);
    expect(await getQuietHours(deps, owner.ownerId)).toEqual({ startMin: null, endMin: null });
  });

  it("테스트 알림은 등록된 모든 번호로 한 번씩 간다", async () => {
    const { deps, notifier } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "7.7.8.1", ownerId: owner.ownerId });
    await addContact(deps, owner.ownerId, otp.challengeId, otp.devCode!, "7.7.9.1");
    const sent = await sendTestNotification(deps, owner.ownerId);
    expect(sent).toBe(2);
    const tests = notifier.outbox.filter((o) => o.channel === "alimtalk" && (o.payload as AlimtalkMessage).template === "test");
    expect(tests).toHaveLength(2);
  });

  it("테스트 알림은 한 번호가 실패해도 나머지 번호로 보내고 보낸 수를 알려 준다", async () => {
    const { deps } = makeKit(opened.db);
    const owner = await loginNewOwner(deps);
    const otp = await requestOtp(deps, { phone: nextPhone(), purpose: "add_contact", ip: "7.7.8.2", ownerId: owner.ownerId });
    await addContact(deps, owner.ownerId, otp.challengeId, otp.devCode!, "7.7.8.2");
    let calls = 0;
    const flaky = {
      sendAlimtalk: async () => {
        calls += 1;
        if (calls === 1) throw new Error("provider timeout");
      },
      sendSms: async () => undefined,
    };
    expect(await sendTestNotification({ ...deps, notifier: flaky }, owner.ownerId)).toBe(1);
    expect(calls).toBe(2);
  });

  it("발송 단계가 통째로 실패해도 습득자 요청은 실패하지 않는다", async () => {
    const { deps } = makeKit(opened.db);
    const broken = { ...deps, db: { select: () => { throw new Error("db down"); } } } as unknown as typeof deps;
    await expect(dispatchSafely(broken)).resolves.toBeUndefined();
  });

  it("최근 대화 목록과 보관 기간 정리", async () => {
    const { kit, owner } = await scenario();
    expect((await listThreads(kit.deps, owner.ownerId)).length).toBe(1);
    const nobody = await loginNewOwner(kit.deps);
    expect(await listThreads(kit.deps, nobody.ownerId)).toEqual([]);
    kit.clock.advance((72 + 24 * 31) * 3_600_000);
    const purged = await purgeExpired(kit.deps);
    expect(purged.threads).toBeGreaterThanOrEqual(1);
    expect(await listThreads(kit.deps, owner.ownerId)).toEqual([]);
  });
});
