import { cookies } from "next/headers";
import { SESSION_COOKIE, assertSameOrigin, route } from "@/server/http";
import { revokeSession } from "@/server/services/auth";

export const POST = route("auth.logout", async (req, deps) => {
  assertSameOrigin(req);
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(deps, token);
  store.delete(SESSION_COOKIE);
  return new Response(null, { status: 204 });
});
