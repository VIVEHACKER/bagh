import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// 설계 제약(docs/01 §8): 위치·차량번호·습득자 연락처는 저장하지 않는다.

export const stickerStatus = pgEnum("sticker_status", ["unclaimed", "active", "paused", "retired"]);
export const messageSender = pgEnum("message_sender", ["finder", "owner"]);
export const otpPurpose = pgEnum("otp_purpose", ["login", "add_contact"]);
export const notificationChannel = pgEnum("notification_channel", ["alimtalk", "sms"]);
export const notificationStatus = pgEnum("notification_status", ["queued", "deferred", "sent", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull(),
  setCount: integer("set_count").notNull(),
  stickersPerSet: integer("stickers_per_set").notNull(),
  createdAt: createdAt(),
});

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
  quietStartMin: smallint("quiet_start_min"),
  quietEndMin: smallint("quiet_end_min"),
  createdAt: createdAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const stickerSets = pgTable(
  "sticker_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    claimCodeHash: text("claim_code_hash").notNull(),
    ownerId: uuid("owner_id").references(() => owners.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sticker_sets_claim_code_hash_uq").on(t.claimCodeHash), index("sticker_sets_owner_idx").on(t.ownerId)],
);

export const stickers = pgTable(
  "stickers",
  {
    token: text("token").primaryKey(),
    setId: uuid("set_id").notNull().references(() => stickerSets.id),
    position: smallint("position").notNull(),
    label: text("label"),
    status: stickerStatus("status").notNull().default("unclaimed"),
    createdAt: createdAt(),
  },
  (t) => [index("stickers_set_idx").on(t.setId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => owners.id),
    phoneEnc: text("phone_enc").notNull(),
    phoneHmac: text("phone_hmac").notNull(),
    isLogin: boolean("is_login").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contacts_owner_phone_uq").on(t.ownerId, t.phoneHmac),
    // 같은 번호로 주인 계정이 두 개 생기지 않게 한다(동시 첫 로그인 경쟁 방지).
    uniqueIndex("contacts_login_phone_uq").on(t.phoneHmac).where(sql`${t.isLogin} = true`),
    index("contacts_phone_hmac_idx").on(t.phoneHmac),
  ],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneHmac: text("phone_hmac").notNull(),
    phoneEnc: text("phone_enc").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: otpPurpose("purpose").notNull(),
    ownerId: uuid("owner_id").references(() => owners.id),
    attempts: smallint("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_idx").on(t.phoneHmac)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => owners.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash)],
);

export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().references(() => stickers.token),
    finderKeyHash: text("finder_key_hash").notNull(),
    messageCount: smallint("message_count").notNull().default(0),
    blocked: boolean("blocked").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("threads_token_idx").on(t.token), index("threads_finder_idx").on(t.finderKeyHash)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
    sender: messageSender("sender").notNull(),
    reasonCode: text("reason_code"),
    placeText: text("place_text"),
    body: text("body"),
    replyCode: text("reply_code"),
    /** 이 습득자 메시지로 주인에게 알림을 예약한 시각. 알림 한도는 이 값으로 센다. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** 알림을 보내지 않은 이유(tag_daily_cap·owner_monthly_cap·no_contacts). 보냈으면 null. */
    notifySkip: text("notify_skip"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_thread_idx").on(t.threadId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel"),
    status: notificationStatus("status").notNull().default("queued"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_due_idx").on(t.status, t.scheduledFor)],
);

// 대체 문자에 넣는 짧은 주소(/m/<코드>). 단문 90바이트 안에 들어가게 서명 답장 링크 대신 쓴다.
export const shortLinks = pgTable(
  "short_links",
  {
    code: text("code").primaryKey(),
    threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("short_links_thread_idx").on(t.threadId)],
);

export const schema = {
  batches,
  owners,
  stickerSets,
  stickers,
  contacts,
  otpChallenges,
  sessions,
  threads,
  messages,
  notifications,
  shortLinks,
};
