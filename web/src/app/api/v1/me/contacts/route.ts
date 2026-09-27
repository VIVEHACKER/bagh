import { z } from "zod";
import { assertSameOrigin, clientIp, readJson, requireOwner, route } from "@/server/http";
import { addContact } from "@/server/services/owner";

const Body = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) });

export const POST = route("me.contact.add", async (req, deps) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const { challengeId, code } = await readJson(req, Body);
  const contacts = await addContact(deps, ownerId, challengeId, code, clientIp(req));
  return Response.json({ contacts }, { status: 201 });
});
