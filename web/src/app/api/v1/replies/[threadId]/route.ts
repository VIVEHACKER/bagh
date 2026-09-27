import { z } from "zod";
import { assertSameOrigin, currentOwner, readJson, route } from "@/server/http";
import type { Deps } from "@/server/deps";
import { openThreadForOwner, postOwnerReply, type ReplyAuth } from "@/server/services/replies";
import { REPLY_CODES } from "@/server/services/reasons";
import { unauthorized } from "@/lib/errors";

/** 알림톡 링크(e·s)와 로그인 세션을 함께 넘긴다. 서비스가 링크 → 세션 순서로 확인한다. */
async function resolveAuth(deps: Deps, e: unknown, s: unknown): Promise<ReplyAuth> {
  const link =
    typeof s === "string" && s && (typeof e === "number" || typeof e === "string") && Number.isFinite(Number(e))
      ? { e: Number(e), s }
      : undefined;
  const ownerId = await currentOwner(deps);
  if (!link && !ownerId) throw unauthorized("로그인해서 답장해 주세요.");
  return { link, ownerId };
}

export const GET = route("replies.open", async (req, deps, ctx: RouteContext<"/api/v1/replies/[threadId]">) => {
  const { threadId } = await ctx.params;
  const url = new URL(req.url);
  const auth = await resolveAuth(deps, url.searchParams.get("e"), url.searchParams.get("s"));
  const view = await openThreadForOwner(deps, threadId, auth);
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
});

const Body = z.object({
  replyCode: z.enum(REPLY_CODES).optional(),
  body: z.string().max(600).optional(),
  e: z.union([z.number(), z.string()]).optional(),
  s: z.string().max(128).optional(),
});

export const POST = route("replies.post", async (req, deps, ctx: RouteContext<"/api/v1/replies/[threadId]">) => {
  assertSameOrigin(req);
  const { threadId } = await ctx.params;
  const input = await readJson(req, Body);
  const auth = await resolveAuth(deps, input.e, input.s);
  const view = await postOwnerReply(deps, { threadId, auth, replyCode: input.replyCode, body: input.body });
  return Response.json(view, { status: 201 });
});
