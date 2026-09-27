import path from "node:path";
import { z } from "zod";
import { openDb, type Db } from "@/db/client";
import { deriveKey } from "@/lib/crypto";
import { MemoryRateLimiter, type RateLimiter } from "@/lib/ratelimit";
import { ConsoleNotifier, type Notifier } from "./notifier";

export interface Config {
  publicBaseUrl: string;
  replyLinkTtlMin: number;
  threadTtlHours: number;
  maxThreadMessages: number;
  otpTtlMin: number;
  otpMaxAttempts: number;
  sessionTtlDays: number;
  maxContacts: number;
  /** 개발 모드에서만 인증번호를 화면에 보여 준다(콘솔 발송일 때). 운영에서는 항상 false. */
  exposeDevOtp: boolean;
  /** 태그 하나가 최근 24시간에 주인에게 알릴 수 있는 대화(습득자) 수. 넘는 새 대화는 저장만 한다. */
  notifyPerTagDaily: number;
  /** 주인 한 명이 최근 30일에 받을 수 있는 알림 메시지 수(태그 전체 합). */
  notifyPerOwnerMonthly: number;
  /** 대화 하나에서 알림을 보내는 습득자 메시지 수. 넘는 후속 메시지는 저장만 한다. */
  notifyPerThread: number;
  /** 처음 보는 번호(가입 전)로 최근 24시간에 보낼 수 있는 인증번호 수(문자비 폭주 차단기). 가입한 번호는 막지 않는다. */
  otpDailyCap: number;
  cronSecret?: string;
}

export interface Keys {
  enc: Buffer;
  lookup: Buffer;
  link: Buffer;
}

export interface Deps {
  db: Db;
  notifier: Notifier;
  limiter: RateLimiter;
  keys: Keys;
  config: Config;
  now: () => Date;
}

export const DEFAULT_CONFIG: Config = {
  publicBaseUrl: "http://localhost:3000",
  replyLinkTtlMin: 15,
  threadTtlHours: 72,
  maxThreadMessages: 10,
  otpTtlMin: 5,
  otpMaxAttempts: 5,
  sessionTtlDays: 7,
  maxContacts: 3,
  exposeDevOtp: false,
  notifyPerTagDaily: 5,
  notifyPerOwnerMonthly: 30,
  notifyPerThread: 3,
  otpDailyCap: 300,
};

export function buildKeys(appSecret: string): Keys {
  return {
    enc: deriveKey(appSecret, "phone-enc"),
    lookup: deriveKey(appSecret, "lookup-hmac"),
    link: deriveKey(appSecret, "link-sign"),
  };
}

// 알림 비용 가드레일(docs/02 §13). 숫자는 운영 데이터를 보고 조정한다. 약관 화면도 같은 값을 보여 준다.
const LimitsSchema = z.object({
  NOTIFY_PER_TAG_DAILY: z.coerce.number().int().min(1).max(100).default(DEFAULT_CONFIG.notifyPerTagDaily),
  NOTIFY_PER_OWNER_MONTHLY: z.coerce.number().int().min(1).max(1000).default(DEFAULT_CONFIG.notifyPerOwnerMonthly),
  NOTIFY_PER_THREAD: z.coerce.number().int().min(1).max(10).default(DEFAULT_CONFIG.notifyPerThread),
  OTP_DAILY_CAP: z.coerce.number().int().min(1).max(100_000).default(DEFAULT_CONFIG.otpDailyCap),
});

export type Limits = Pick<Config, "notifyPerTagDaily" | "notifyPerOwnerMonthly" | "notifyPerThread" | "otpDailyCap">;

/** DB를 열지 않고 한도 설정만 읽는다(약관 화면용). */
export function readLimits(env: NodeJS.ProcessEnv = process.env): Limits {
  const l = LimitsSchema.parse(env);
  return {
    notifyPerTagDaily: l.NOTIFY_PER_TAG_DAILY,
    notifyPerOwnerMonthly: l.NOTIFY_PER_OWNER_MONTHLY,
    notifyPerThread: l.NOTIFY_PER_THREAD,
    otpDailyCap: l.OTP_DAILY_CAP,
  };
}

const EnvSchema = LimitsSchema.extend({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_SECRET: z.string().min(32, "APP_SECRET은 32자 이상이어야 한다"),
  DATABASE_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.string().url().default(DEFAULT_CONFIG.publicBaseUrl),
  REPLY_LINK_TTL_MIN: z.coerce.number().int().min(1).max(1440).default(DEFAULT_CONFIG.replyLinkTtlMin),
  NOTIFIER: z.enum(["console"]).default("console"),
  CRON_SECRET: z.string().min(16).optional(),
  // 개발 화면에 인증번호를 보여 줄지. 개발 모드 + 콘솔 발송 + 로컬 접속일 때만 효과가 있다.
  EXPOSE_DEV_OTP: z.enum(["0", "1"]).default("0"),
  // 메모리 속도 제한기는 인스턴스마다 따로 센다. 운영에서 단일 인스턴스일 때만 명시적으로 허용한다.
  ALLOW_MEMORY_RATE_LIMIT: z.enum(["0", "1"]).default("0"),
});

async function createDeps(): Promise<Deps> {
  const env = EnvSchema.parse(process.env);
  if (env.NODE_ENV === "production" && env.NOTIFIER === "console") {
    // 운영에서 콘솔 발송이면 알림이 실제로 나가지 않는다. 조용히 넘어가지 않고 막는다.
    throw new Error("NOTIFIER=console은 운영에서 쓸 수 없다. 알림톡 어댑터를 설정해야 한다.");
  }
  if (env.NODE_ENV === "production" && env.ALLOW_MEMORY_RATE_LIMIT !== "1") {
    // 인스턴스가 여러 개면 한도가 인스턴스 수만큼 늘어난다. 공유 저장소 제한기 없이 조용히 뜨지 않는다.
    throw new Error("운영에는 공유 저장소 속도 제한기가 필요하다. 단일 인스턴스라면 ALLOW_MEMORY_RATE_LIMIT=1로 명시한다.");
  }
  const { db } = await openDb({
    databaseUrl: env.DATABASE_URL,
    // 경로는 고정 하위 폴더로 둔다. 변수 경로면 번들러가 프로젝트 전체를 서버 출력에 넣는다.
    pgliteDir: env.DATABASE_URL ? undefined : path.join(process.cwd(), ".data", "pglite"),
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return {
    db,
    notifier: new ConsoleNotifier(),
    limiter: new MemoryRateLimiter(),
    keys: buildKeys(env.APP_SECRET),
    config: {
      ...DEFAULT_CONFIG,
      publicBaseUrl: env.PUBLIC_BASE_URL,
      replyLinkTtlMin: env.REPLY_LINK_TTL_MIN,
      exposeDevOtp: env.NODE_ENV !== "production" && env.NOTIFIER === "console" && env.EXPOSE_DEV_OTP === "1",
      cronSecret: env.CRON_SECRET,
      ...readLimits(process.env),
    },
    now: () => new Date(),
  };
}

// 개발 서버의 코드 교체(HMR) 때 PGlite를 두 번 열지 않도록 전역에 한 번만 만든다.
const holder = globalThis as unknown as { __baghomeDeps?: Promise<Deps> };

export function getDeps(): Promise<Deps> {
  holder.__baghomeDeps ??= createDeps().catch((err) => {
    holder.__baghomeDeps = undefined;
    throw err;
  });
  return holder.__baghomeDeps;
}
