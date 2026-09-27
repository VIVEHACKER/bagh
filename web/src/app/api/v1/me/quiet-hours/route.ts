import { z } from "zod";
import { parseHhMm } from "@/lib/quiet-hours";
import { assertSameOrigin, readJson, requireOwner, route } from "@/server/http";
import { setQuietHours } from "@/server/services/owner";

const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const Body = z.object({ start: HhMm, end: HhMm });

export const PUT = route("me.quiet_hours", async (req, deps) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const { start, end } = await readJson(req, Body);
  await setQuietHours(deps, ownerId, start ? parseHhMm(start) : null, end ? parseHhMm(end) : null);
  return Response.json({ start, end });
});
