import { requireOwner, route } from "@/server/http";
import { alertUsage, getQuietHours, listContacts, listStickers, listThreads } from "@/server/services/owner";

export const GET = route("me.get", async (_req, deps) => {
  const ownerId = await requireOwner(deps);
  const [stickers, contacts, quietHours, threads, alerts] = await Promise.all([
    listStickers(deps, ownerId),
    listContacts(deps, ownerId),
    getQuietHours(deps, ownerId),
    listThreads(deps, ownerId),
    alertUsage(deps, ownerId),
  ]);
  return Response.json({ stickers, contacts, quietHours, threads, alerts }, { headers: { "Cache-Control": "no-store" } });
});
