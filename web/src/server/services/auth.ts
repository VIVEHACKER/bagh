import { randomInt } from "node:crypto";
import { and, count, eq, gt, isNull, lt, notExists, sql } from "drizzle-orm";
import { contacts, otpChallenges, owners, sessions } from "@/db/schema";
import { encrypt, lookupHash, randomSecret, safeEqual, secretHash } from "@/lib/crypto";
import { badRequest, rateLimited, unavailable } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/log";
import { normalizeKrMobile } from "@/lib/phone";
import type { Deps } from "../deps";

export type OtpPurpose = "login" | "add_contact";

export interface RequestOtpInput {
  phone: string;
  purpose: OtpPurpose;
  ip: string;
  /** add_contact일 때 요청한 주인. 다른 주인이 이 인증을 쓰지 못하게 묶는다. */
  ownerId?: string;
}

export interface RequestOtpResult {
  challengeId: string;
  /** 개발 모드(콘솔 발송 + EXPOSE_DEV_OTP)에서만 채워진다. */
  devCode?: string;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function codeHash(deps: Deps, phoneHmac: string, code: string): string {
  return lookupHash(`${phoneHmac}:${code}`, deps.keys.lookup);
}

export async function requestOtp(deps: Deps, input: RequestOtpInput): Promise<RequestOtpResult> {
  const phone = normalizeKrMobile(input.phone);
  if (!phone) throw badRequest("phone_invalid", "휴대폰 번호를 확인해 주세요.");
  const phoneHmac = lookupHash(phone, deps.keys.lookup);
  const nowMs = deps.now().getTime();

  // 문자비 폭주 차단기: 처음 보는 번호(가입 전)로 보낸 최근 24시간 인증번호 수를 DB로 센다(인스턴스가 여러 개여도 같은 값).
  // 가입한 번호는 세지도 막지도 않는다: 공격자가 가짜 번호로 상한을 채워도 기존 주인은 계속 로그인한다.
  // 버킷을 쓰기 전에 검사해, 503을 받은 요청이 번호·IP 한도를 소모하지 않게 한다.
  // 검사와 기록 사이에 잠금이 없어 동시 요청 수만큼 조금 넘을 수 있다(차단기라 허용한다).
  const [known] = await deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phoneHmac, phoneHmac)).limit(1);
  if (!known) {
    const [{ n: sentToday }] = await deps.db
      .select({ n: count() })
      .from(otpChallenges)
      .where(
        and(
          gt(otpChallenges.createdAt, new Date(nowMs - DAY)),
          // 그 뒤 가입한 번호로 보낸 것은 빼고 센다(가입 전 번호만 차단기 예산을 쓴다).
          notExists(deps.db.select({ one: sql`1` }).from(contacts).where(eq(contacts.phoneHmac, otpChallenges.phoneHmac))),
        ),
      );
    if (sentToday >= deps.config.otpDailyCap) {
      log.error({ event: "otp.daily_cap_reached", cap: deps.config.otpDailyCap }, "otp daily cap reached; sending paused");
      throw unavailable("otp_unavailable", "지금은 인증번호를 보낼 수 없어요. 잠시 뒤에 다시 시도해 주세요.");
    }
  }

  // 남의 번호를 돌려 가며 요청하는 공격을 IP·번호 단위로 막는다. IP 한도는 동호회 공용 와이파이 단체 등록을 고려해 넉넉히 둔다.
  const rules = [
    { key: `otp:ip:h:${input.ip}`, limit: 30, windowMs: 60 * MINUTE },
    { key: `otp:ip:d:${input.ip}`, limit: 100, windowMs: DAY },
    { key: `otp:phone:${phoneHmac}`, limit: 5, windowMs: 60 * MINUTE },
  ];
  // 연락처 추가는 로그인한 주인만 한다. 한 계정으로 여러 번호에 문자를 돌리지 못하게 주인당 하루 5건.
  if (input.purpose === "add_contact" && input.ownerId) rules.push({ key: `otp:owner:${input.ownerId}`, limit: 5, windowMs: DAY });
  const r = await deps.limiter.hitAll(rules, nowMs);
  if (!r.ok) throw rateLimited(r.retryAfterSec);

  const code = String(randomInt(1_000_000)).padStart(6, "0");
  const [challenge] = await deps.db
    .insert(otpChallenges)
    .values({
      phoneHmac,
      phoneEnc: encrypt(phone, deps.keys.enc),
      codeHash: codeHash(deps, phoneHmac, code),
      purpose: input.purpose,
      ownerId: input.ownerId ?? null,
      expiresAt: new Date(nowMs + deps.config.otpTtlMin * MINUTE),
      // 하루 상한을 deps.now() 기준으로 세므로 생성 시각도 같은 시계로 남긴다.
      createdAt: new Date(nowMs),
    })
    .returning({ id: otpChallenges.id });

  await deps.notifier.sendSms({ to: phone, text: `[백홈] 인증번호 ${code} (${deps.config.otpTtlMin}분 안에 입력해 주세요)` });
  return { challengeId: challenge.id, devCode: deps.config.exposeDevOtp ? code : undefined };
}

export interface VerifiedPhone {
  phoneHmac: string;
  phoneEnc: string;
  ownerId: string | null;
}

/**
 * 인증번호를 확인하고 한 번만 쓸 수 있게 소모한다.
 * 비교하기 "전에" 시도 횟수를 조건부 UPDATE로 원자적으로 올린다. 동시에 여러 번 보내도 잠금(기본 5회)을 넘지 못한다.
 */
export async function verifyOtp(deps: Deps, challengeId: string, code: string, purpose: OtpPurpose, ip: string): Promise<VerifiedPhone> {
  if (!isUuid(challengeId)) throw badRequest("otp_invalid", "인증번호를 다시 받아 주세요.");
  const now = deps.now();
  const r = await deps.limiter.hitAll(
    [
      { key: `otp-verify:ip:${ip}`, limit: 10, windowMs: MINUTE },
      { key: `otp-verify:ch:${challengeId}`, limit: 10, windowMs: 5 * MINUTE },
    ],
    now.getTime(),
  );
  if (!r.ok) throw rateLimited(r.retryAfterSec);

  const [c] = await deps.db
    .update(otpChallenges)
    .set({ attempts: sql`${otpChallenges.attempts} + 1` })
    .where(
      and(
        eq(otpChallenges.id, challengeId),
        eq(otpChallenges.purpose, purpose),
        isNull(otpChallenges.consumedAt),
        gt(otpChallenges.expiresAt, now),
        lt(otpChallenges.attempts, deps.config.otpMaxAttempts),
      ),
    )
    .returning();
  if (!c) {
    const [row] = await deps.db.select().from(otpChallenges).where(eq(otpChallenges.id, challengeId)).limit(1);
    if (!row || row.consumedAt || row.purpose !== purpose) throw badRequest("otp_invalid", "인증번호를 다시 받아 주세요.");
    if (row.expiresAt.getTime() <= now.getTime()) throw badRequest("otp_expired", "인증번호 시간이 지났어요. 다시 받아 주세요.");
    throw badRequest("otp_locked", "시도 횟수를 넘었어요. 인증번호를 다시 받아 주세요.");
  }

  if (!/^\d{6}$/.test(code) || !safeEqual(codeHash(deps, c.phoneHmac, code), c.codeHash)) {
    throw badRequest("otp_mismatch", "인증번호가 맞지 않아요.");
  }
  const consumed = await deps.db
    .update(otpChallenges)
    .set({ consumedAt: now })
    .where(and(eq(otpChallenges.id, c.id), isNull(otpChallenges.consumedAt)))
    .returning({ id: otpChallenges.id });
  if (consumed.length === 0) throw badRequest("otp_invalid", "인증번호를 다시 받아 주세요.");
  return { phoneHmac: c.phoneHmac, phoneEnc: c.phoneEnc, ownerId: c.ownerId };
}

export interface LoginResult {
  ownerId: string;
  sessionToken: string;
  sessionExpiresAt: Date;
  isNewOwner: boolean;
}

/** 로그인용 번호가 처음이면 주인 계정을 만든다. 로그인 번호는 알림 받을 번호로도 쓰인다. */
export async function loginWithOtp(deps: Deps, challengeId: string, code: string, ip: string): Promise<LoginResult> {
  const verified = await verifyOtp(deps, challengeId, code, "login", ip);
  const [existing] = await deps.db
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(and(eq(contacts.phoneHmac, verified.phoneHmac), eq(contacts.isLogin, true)))
    .limit(1);

  let ownerId = existing?.ownerId;
  let isNewOwner = false;
  if (!ownerId) {
    try {
      ownerId = await deps.db.transaction(async (tx) => {
        const [owner] = await tx.insert(owners).values({}).returning({ id: owners.id });
        const inserted = await tx
          .insert(contacts)
          .values({ ownerId: owner.id, phoneEnc: verified.phoneEnc, phoneHmac: verified.phoneHmac, isLogin: true, verifiedAt: deps.now() })
          .onConflictDoNothing()
          .returning({ id: contacts.id });
        // 같은 번호의 동시 첫 로그인에서 졌다(contacts_login_phone_uq). 만든 계정을 되돌린다.
        if (inserted.length === 0) throw new LoginRaceLost();
        return owner.id;
      });
      isNewOwner = true;
    } catch (err) {
      if (!(err instanceof LoginRaceLost)) throw err;
      const [winner] = await deps.db
        .select({ ownerId: contacts.ownerId })
        .from(contacts)
        .where(and(eq(contacts.phoneHmac, verified.phoneHmac), eq(contacts.isLogin, true)))
        .limit(1);
      if (!winner) throw err;
      ownerId = winner.ownerId;
    }
  }
  const session = await createSession(deps, ownerId);
  return { ownerId, ...session, isNewOwner };
}

class LoginRaceLost extends Error {
  constructor() {
    super("login race lost: another session created this owner first");
  }
}

export async function createSession(deps: Deps, ownerId: string): Promise<{ sessionToken: string; sessionExpiresAt: Date }> {
  const sessionToken = randomSecret(32);
  const sessionExpiresAt = new Date(deps.now().getTime() + deps.config.sessionTtlDays * 24 * 60 * MINUTE);
  await deps.db.insert(sessions).values({ ownerId, tokenHash: secretHash(sessionToken), expiresAt: sessionExpiresAt });
  return { sessionToken, sessionExpiresAt };
}

export async function ownerFromSession(deps: Deps, sessionToken: string | undefined): Promise<string | null> {
  if (!sessionToken || sessionToken.length > 128) return null;
  const [row] = await deps.db
    .select({ ownerId: sessions.ownerId })
    .from(sessions)
    .innerJoin(owners, eq(owners.id, sessions.ownerId))
    .where(and(eq(sessions.tokenHash, secretHash(sessionToken)), gt(sessions.expiresAt, deps.now()), isNull(owners.deletedAt)))
    .limit(1);
  return row?.ownerId ?? null;
}

export async function revokeSession(deps: Deps, sessionToken: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.tokenHash, secretHash(sessionToken)));
}
