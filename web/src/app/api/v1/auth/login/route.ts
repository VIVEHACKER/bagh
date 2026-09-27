import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, assertSameOrigin, clientIp, cookieOptions, readJson, route } from "@/server/http";
import { loginWithOtp } from "@/server/services/auth";

const Body = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const POST = route("auth.login", async (req, deps) => {
  assertSameOrigin(req);
  const input = await readJson(req, Body);
  const login = await loginWithOtp(deps, input.challengeId, input.code, clientIp(req));
  const store = await cookies();
  store.set(SESSION_COOKIE, login.sessionToken, cookieOptions(deps.config.sessionTtlDays * 24 * 3600));
  return Response.json({ isNewOwner: login.isNewOwner });
});
