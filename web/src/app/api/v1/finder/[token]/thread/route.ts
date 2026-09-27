import { cookies } from "next/headers";
import { normalizeCode } from "@/lib/codes";
import { finderCookieName, route } from "@/server/http";
import { getThreadForFinder } from "@/server/services/finder";

/** 습득자가 자기 대화(주인 답장 포함)를 확인한다. 스레드 비밀값은 쿠키로만 받는다. */
export const GET = route("finder.thread", async (_req, deps, ctx: RouteContext<"/api/v1/finder/[token]/thread">) => {
  const { token } = await ctx.params;
  const upper = normalizeCode(token);
  const store = await cookies();
  const view = await getThreadForFinder(deps, upper, store.get(finderCookieName(upper))?.value);
  return Response.json(view, { headers: { "Cache-Control": "no-store" } });
});
