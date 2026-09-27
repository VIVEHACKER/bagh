import { z } from "zod";
import { assertSameOrigin, readJson, requireOwner, route } from "@/server/http";
import { updateSticker } from "@/server/services/owner";

const Body = z
  .object({
    label: z.string().max(40).nullable().optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine((b) => b.label !== undefined || b.status !== undefined, { message: "바꿀 항목이 없어요." });

export const PATCH = route("me.sticker.update", async (req, deps, ctx: RouteContext<"/api/v1/me/stickers/[token]">) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const { token } = await ctx.params;
  const patch = await readJson(req, Body);
  const sticker = await updateSticker(deps, ownerId, token.toUpperCase(), patch);
  return Response.json({ sticker });
});
