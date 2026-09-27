import { unauthorized } from "@/lib/errors";
import { assertSameOrigin, currentOwner, route } from "@/server/http";
import { blockThread } from "@/server/services/replies";

/** 주인이 이 대화의 새 메시지를 받지 않게 한다. 로그인 세션이 필요하다. */
export const POST = route("replies.block", async (req, deps, ctx: RouteContext<"/api/v1/replies/[threadId]/block">) => {
  assertSameOrigin(req);
  const ownerId = await currentOwner(deps);
  if (!ownerId) throw unauthorized();
  const { threadId } = await ctx.params;
  await blockThread(deps, threadId, { ownerId });
  return new Response(null, { status: 204 });
});
