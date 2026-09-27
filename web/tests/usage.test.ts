import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenedDb } from "@/db/client";
import { kstMonthRange } from "@/lib/kst";
import { postFinderMessage } from "@/server/services/finder";
import { usageReport } from "@/server/services/usage";
import { issueAndClaim, loginNewOwner, makeKit, openTestDb } from "./helpers";

// 월별 발송 집계. 다른 테스트와 섞이지 않게 DB를 따로 열고, 시계는 실제 시각에 맞춘다(DB 기본 시각과 비교하므로).
let opened: OpenedDb;
beforeAll(async () => {
  opened = await openTestDb();
});
afterAll(async () => {
  await opened.close();
});

describe("월별 발송 집계", () => {
  it("알림·문자·인증번호 건수와 한도에 걸린 메시지를 세고 예상 비용을 낸다", async () => {
    const kit = makeKit(opened.db, new Date());
    kit.deps.config.notifyPerTagDaily = 2;
    const owner = await loginNewOwner(kit.deps); // 인증번호 1건
    const set = await issueAndClaim(kit.deps, owner.ownerId);
    const send = (i: number) => postFinderMessage(kit.deps, { token: set.tokens[0], deviceId: `u-${i}`, ip: `10.60.0.${i}`, reason: "found" });
    await send(1); // 알림톡
    kit.notifier.failAlimtalk = true;
    await send(2); // 문자 대체
    await send(3); // 한도 초과로 저장만

    const now = Date.now();
    const report = await usageReport(opened.db, { from: new Date(now - 3_600_000), to: new Date(now + 3_600_000) }, { alimtalk: 10, sms: 20 });
    expect(report).toMatchObject({
      finderMessages: 3,
      notifiedMessages: 2,
      skipped: { tag_daily_cap: 1 },
      sent: { alimtalk: 1, sms: 1 },
      failed: 0,
      otpRequests: 1,
      activeTags: 1,
      maxNotifiedPerTag: 2,
      estimatedCostKrw: 1 * 10 + (1 + 1) * 20,
    });
  });

  it("KST 기준 한 달 범위를 만든다", () => {
    const { from, to } = kstMonthRange("2026-09");
    expect(from.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(kstMonthRange("2026-12").to.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(() => kstMonthRange("2026-13")).toThrow();
    expect(() => kstMonthRange("26-9")).toThrow();
  });
});
