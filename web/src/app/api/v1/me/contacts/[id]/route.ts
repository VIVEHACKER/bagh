import { badRequest } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { assertSameOrigin, requireOwner, route } from "@/server/http";
import { removeContact } from "@/server/services/owner";

export const DELETE = route("me.contact.remove", async (req, deps, ctx: RouteContext<"/api/v1/me/contacts/[id]">) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const { id } = await ctx.params;
  if (!isUuid(id)) throw badRequest("contact_id_invalid", "번호를 찾을 수 없어요.");
  const contacts = await removeContact(deps, ownerId, id);
  return Response.json({ contacts });
});
