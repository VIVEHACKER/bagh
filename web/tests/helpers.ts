import path from "node:path";
import { openDb, type OpenedDb } from "@/db/client";
import { MemoryRateLimiter } from "@/lib/ratelimit";
import { DEFAULT_CONFIG, buildKeys, type Deps } from "@/server/deps";
import { ConsoleNotifier } from "@/server/notifier";
import { loginWithOtp, requestOtp } from "@/server/services/auth";
import { issueBatch } from "@/server/services/batch";
import { claimSet } from "@/server/services/claims";

export function openTestDb(): Promise<OpenedDb> {
  return openDb({ migrationsFolder: path.resolve(__dirname, "../drizzle") });
}

export interface TestKit {
  deps: Deps;
  notifier: ConsoleNotifier;
  clock: { set(d: Date): void; advance(ms: number): void; now(): Date };
}

/** 2026-09-24 12:00 KST(03:00 UTC)에서 시작하는 고정 시계와 콘솔 발송기를 붙인다. */
export function makeKit(db: OpenedDb["db"], start = new Date("2026-09-24T03:00:00Z")): TestKit {
  let now = start;
  const clock = {
    set: (d: Date) => {
      now = d;
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
  const notifier = new ConsoleNotifier();
  const deps: Deps = {
    db,
    notifier,
    limiter: new MemoryRateLimiter(),
    keys: buildKeys("test-app-secret-0123456789-abcdefghijklmnop"),
    config: { ...DEFAULT_CONFIG, exposeDevOtp: true },
    now: clock.now,
  };
  return { deps, notifier, clock };
}

let phoneSeq = 0;
/** 테스트마다 겹치지 않는 휴대폰 번호. */
export function nextPhone(): string {
  phoneSeq += 1;
  return `010-7${String(phoneSeq).padStart(3, "0")}-${String(1000 + phoneSeq).slice(-4)}`;
}

export async function loginNewOwner(deps: Deps, phone = nextPhone()) {
  const ip = `10.0.0.${phoneSeq % 250}`;
  const otp = await requestOtp(deps, { phone, purpose: "login", ip });
  const login = await loginWithOtp(deps, otp.challengeId, otp.devCode!, ip);
  return { ...login, phone };
}

export async function issueAndClaim(deps: Deps, ownerId: string, stickersPerSet = 1) {
  const batch = await issueBatch(deps, { sku: "golf-tag", setCount: 1, stickersPerSet });
  const set = batch.sets[0];
  await claimSet(deps, { ownerId, claimCode: set.claimCode, ip: "10.1.1.1" });
  return set;
}
