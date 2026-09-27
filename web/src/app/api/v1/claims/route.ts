import { z } from "zod";
import { assertSameOrigin, clientIp, readJson, requireOwner, route } from "@/server/http";
import { claimSet } from "@/server/services/claims";

const Body = z.object({ claimCode: z.string().min(4).max(20) });

export const POST = route("claims.create", async (req, deps) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const { claimCode } = await readJson(req, Body);
  const stickers = await claimSet(deps, { ownerId, claimCode, ip: clientIp(req) });
  return Response.json({ stickers }, { status: 201 });
});
