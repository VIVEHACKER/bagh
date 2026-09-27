import { and, eq, lt, sql } from "drizzle-orm";
import { messages, stickerSets, stickers, threads } from "@/db/schema";
import { verifyLink } from "@/lib/crypto";
import { badRequest, conflict, forbidden, gone, notFound, unauthorized } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import type { Deps } from "../deps";
import { loadThreadView, type ThreadView } from "./finder";
import { REPLY_CODES, type ReplyCode } from "./reasons";

/**
 * 알림톡 서명 링크와 로그인 세션 중 하나라도 맞으면 주인으로 본다.
 * 링크(15분)가 만료돼도 로그인 세션이 있으면 같은 화면에서 이어서 답장할 수 있다.
 */
export interface ReplyAuth {
  link?: { e: number; s: string };
  ownerId?: string | null;
}

async function threadOwner(deps: Deps, threadId: string): Promise<{ ownerId: string | null; label: string | null } | null> {
  if (!isUuid(threadId)) return null;
  const [row] = await deps.db
    .select({ ownerId: stickerSets.ownerId, label: stickers.label })
    .from(threads)
    .innerJoin(stickers, eq(stickers.token, threads.token))
    .innerJoin(stickerSets, eq(stickerSets.id, stickers.setId))
    .where(eq(threads.id, threadId))
    .limit(1);
  return row ?? null;
}

/** 링크 → 세션 순서로 주인 권한을 확인한다. 둘 다 안 맞으면 링크 상태에 맞는 오류를 돌려준다. */
async function authorize(deps: Deps, threadId: string, auth: ReplyAuth): Promise<{ label: string | null; via: "link" | "session" }> {
  const owner = await threadOwner(deps, threadId);
  if (!owner) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  const link = auth.link ? verifyLink(threadId, auth.link.e, auth.link.s, deps.keys.link, Math.floor(deps.now().getTime() / 1000)) : null;
  if (link === "valid") return { label: owner.label, via: "link" };
  if (auth.ownerId && owner.ownerId === auth.ownerId) return { label: owner.label, via: "session" };
  if (link === "expired") throw gone("link_expired", "링크 시간이 지났어요. 로그인해서 답장해 주세요.");
  if (link === "invalid") throw forbidden("link_invalid", "링크가 올바르지 않아요.");
  if (auth.ownerId) throw forbidden("not_owner", "이 대화에 답장할 권한이 없어요.");
  throw unauthorized("로그인해서 답장해 주세요.");
}

export async function openThreadForOwner(
  deps: Deps,
  threadId: string,
  auth: ReplyAuth,
): Promise<ThreadView & { label: string | null; via: "link" | "session" }> {
  const { label, via } = await authorize(deps, threadId, auth);
  const view = await loadThreadView(deps, threadId);
  if (!view) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  return { ...view, label, via };
}

export async function postOwnerReply(
  deps: Deps,
  input: { threadId: string; auth: ReplyAuth; replyCode?: string; body?: string },
): Promise<ThreadView> {
  await authorize(deps, input.threadId, input.auth);
  const replyCode = input.replyCode && (REPLY_CODES as readonly string[]).includes(input.replyCode) ? (input.replyCode as ReplyCode) : null;
  const body = (input.body ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  if (!replyCode && !body) throw badRequest("reply_empty", "답장 내용을 골라 주세요.");

  await deps.db.transaction(async (tx) => {
    const [thread] = await tx.select({ id: threads.id, expiresAt: threads.expiresAt }).from(threads).where(eq(threads.id, input.threadId)).limit(1);
    if (!thread) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
    if (thread.expiresAt.getTime() <= deps.now().getTime()) throw gone("thread_expired", `대화 기간(${deps.config.threadTtlHours}시간)이 끝났어요.`);
    // 한도 검사와 증가를 한 문장으로 한다(동시 답장이 한도를 넘지 못하게).
    const [bumped] = await tx
      .update(threads)
      .set({ messageCount: sql`${threads.messageCount} + 1` })
      .where(and(eq(threads.id, thread.id), lt(threads.messageCount, deps.config.maxThreadMessages)))
      .returning({ id: threads.id });
    if (!bumped) throw conflict("thread_full", "이 대화의 메시지 수를 모두 썼어요.");
    await tx.insert(messages).values({ threadId: thread.id, sender: "owner", replyCode, body });
  });
  const view = await loadThreadView(deps, input.threadId);
  if (!view) throw notFound("thread_not_found", "대화를 찾을 수 없어요.");
  return view;
}

/** 주인이 이 대화의 새 메시지를 더 받지 않게 한다. 호출자에게 경고를 보내지는 않는다. */
export async function blockThread(deps: Deps, threadId: string, auth: ReplyAuth): Promise<void> {
  await authorize(deps, threadId, auth);
  await deps.db.update(threads).set({ blocked: true }).where(eq(threads.id, threadId));
}
