import { and, asc, count, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { contacts, messages, owners, stickerSets, stickers, threads } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { badRequest, conflict, forbidden, notFound } from "@/lib/errors";
import { log } from "@/lib/log";
import { maskPhone } from "@/lib/phone";
import type { Deps } from "../deps";
import { verifyOtp } from "./auth";
import { OWNER_WINDOW_MS, ownerAlertsUsed } from "./notifications";

export interface OwnerSticker {
  token: string;
  label: string | null;
  status: string;
  setId: string;
  position: number;
}

export async function listStickers(deps: Deps, ownerId: string): Promise<OwnerSticker[]> {
  return deps.db
    .select({ token: stickers.token, label: stickers.label, status: stickers.status, setId: stickers.setId, position: stickers.position })
    .from(stickers)
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(eq(stickerSets.ownerId, ownerId))
    .orderBy(asc(stickerSets.claimedAt), asc(stickers.position));
}

export async function updateSticker(
  deps: Deps,
  ownerId: string,
  token: string,
  patch: { label?: string | null; status?: "active" | "paused" },
): Promise<OwnerSticker> {
  const [row] = await deps.db
    .select({ ownerId: stickerSets.ownerId, status: stickers.status })
    .from(stickers)
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(eq(stickers.token, token))
    .limit(1);
  if (!row) throw notFound("sticker_not_found", "태그를 찾을 수 없어요.");
  if (row.ownerId !== ownerId) throw forbidden("not_owner", "내 태그가 아니에요.");
  if (row.status === "retired") throw conflict("sticker_retired", "사용을 끝낸 태그예요.");

  const set: { label?: string | null; status?: "active" | "paused" } = {};
  if (patch.label !== undefined) {
    const label = patch.label?.replace(/\s+/g, " ").trim().slice(0, 20) ?? "";
    set.label = label || null;
  }
  if (patch.status) set.status = patch.status;
  const [updated] = await deps.db
    .update(stickers)
    .set(set)
    .where(eq(stickers.token, token))
    .returning({ token: stickers.token, label: stickers.label, status: stickers.status, setId: stickers.setId, position: stickers.position });
  return updated;
}

export interface OwnerContact {
  id: string;
  masked: string;
  isLogin: boolean;
}

export async function listContacts(deps: Deps, ownerId: string): Promise<OwnerContact[]> {
  const rows = await deps.db
    .select({ id: contacts.id, phoneEnc: contacts.phoneEnc, isLogin: contacts.isLogin })
    .from(contacts)
    .where(eq(contacts.ownerId, ownerId))
    .orderBy(desc(contacts.isLogin), asc(contacts.createdAt));
  return rows.map((r) => ({ id: r.id, masked: maskPhone(decrypt(r.phoneEnc, deps.keys.enc)), isLogin: r.isLogin }));
}

/** 알림 받을 번호를 추가한다. 추가하는 번호마다 인증번호 확인이 필요하다(남의 번호 등록 방지). */
export async function addContact(deps: Deps, ownerId: string, challengeId: string, code: string, ip: string): Promise<OwnerContact[]> {
  const [{ n }] = await deps.db.select({ n: count() }).from(contacts).where(eq(contacts.ownerId, ownerId));
  if (n >= deps.config.maxContacts) throw conflict("contacts_full", `알림 받을 번호는 ${deps.config.maxContacts}개까지예요.`);
  const verified = await verifyOtp(deps, challengeId, code, "add_contact", ip);
  if (verified.ownerId !== ownerId) throw forbidden("otp_owner_mismatch", "인증을 다시 진행해 주세요.");
  const inserted = await deps.db
    .insert(contacts)
    .values({ ownerId, phoneEnc: verified.phoneEnc, phoneHmac: verified.phoneHmac, isLogin: false, verifiedAt: deps.now() })
    .onConflictDoNothing()
    .returning({ id: contacts.id });
  if (inserted.length === 0) throw conflict("contact_exists", "이미 등록된 번호예요.");
  return listContacts(deps, ownerId);
}

export async function removeContact(deps: Deps, ownerId: string, contactId: string): Promise<OwnerContact[]> {
  const [row] = await deps.db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId))).limit(1);
  if (!row) throw notFound("contact_not_found", "번호를 찾을 수 없어요.");
  if (row.isLogin) throw badRequest("contact_is_login", "로그인 번호는 지울 수 없어요.");
  await deps.db.delete(contacts).where(eq(contacts.id, contactId));
  return listContacts(deps, ownerId);
}

export async function getQuietHours(deps: Deps, ownerId: string): Promise<{ startMin: number | null; endMin: number | null }> {
  const [row] = await deps.db
    .select({ startMin: owners.quietStartMin, endMin: owners.quietEndMin })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .limit(1);
  return row ?? { startMin: null, endMin: null };
}

export async function setQuietHours(deps: Deps, ownerId: string, startMin: number | null, endMin: number | null): Promise<void> {
  const valid = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v < 1440);
  if (!valid(startMin) || !valid(endMin) || (startMin === null) !== (endMin === null))
    throw badRequest("quiet_hours_invalid", "시작과 끝 시간을 함께 정해 주세요.");
  if (startMin !== null && startMin === endMin) throw badRequest("quiet_hours_invalid", "시작과 끝 시간이 같아요.");
  await deps.db.update(owners).set({ quietStartMin: startMin, quietEndMin: endMin }).where(eq(owners.id, ownerId));
}

/** 등록 직후 알림이 실제로 오는지 확인하는 테스트 발송. 보낸 번호 수를 돌려준다. */
export async function sendTestNotification(deps: Deps, ownerId: string): Promise<number> {
  const rows = await deps.db.select({ id: contacts.id, phoneEnc: contacts.phoneEnc }).from(contacts).where(eq(contacts.ownerId, ownerId));
  let sent = 0;
  // 한 번호가 실패해도 나머지 번호에는 보낸다. 보낸 수를 그대로 알려 준다.
  for (const row of rows) {
    try {
      await deps.notifier.sendAlimtalk({ to: decrypt(row.phoneEnc, deps.keys.enc), template: "test", vars: { link: `${deps.config.publicBaseUrl}/my` } });
      sent += 1;
    } catch (err) {
      log.warn({ event: "notify.test_failed", contactId: row.id, err: (err as Error).message }, "test notification failed");
    }
  }
  return sent;
}

export interface OwnerThreadSummary {
  threadId: string;
  token: string;
  label: string | null;
  messageCount: number;
  createdAt: string;
  expiresAt: string;
}

export async function listThreads(deps: Deps, ownerId: string, limit = 20): Promise<OwnerThreadSummary[]> {
  const mine = await deps.db
    .select({ token: stickers.token })
    .from(stickers)
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(eq(stickerSets.ownerId, ownerId));
  if (mine.length === 0) return [];
  const rows = await deps.db
    .select({
      threadId: threads.id,
      token: threads.token,
      label: stickers.label,
      messageCount: threads.messageCount,
      createdAt: threads.createdAt,
      expiresAt: threads.expiresAt,
    })
    .from(threads)
    .innerJoin(stickers, eq(stickers.token, threads.token))
    .where(inArray(threads.token, mine.map((m) => m.token)))
    .orderBy(desc(threads.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

export interface AlertUsage {
  /** 최근 30일에 알린 메시지 수(차단한 대화 제외). */
  used: number;
  limit: number;
  /** 최근 30일에 알림 없이 저장된 습득자 메시지 수(한도 초과 등). */
  silenced: number;
}

/** 주인이 알림 한도에 걸려 놓친 연락이 있는지 /my에서 볼 수 있게 한다. */
export async function alertUsage(deps: Deps, ownerId: string): Promise<AlertUsage> {
  const since = new Date(deps.now().getTime() - OWNER_WINDOW_MS);
  const [silenced] = await deps.db
    .select({ n: count() })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .innerJoin(stickers, eq(stickers.token, threads.token))
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(and(eq(stickerSets.ownerId, ownerId), isNotNull(messages.notifySkip), gt(messages.createdAt, since)));
  return { used: await ownerAlertsUsed(deps.db, ownerId, since), limit: deps.config.notifyPerOwnerMonthly, silenced: silenced.n };
}
