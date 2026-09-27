import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { normalizeCode } from "@/lib/codes";
import { after } from "next/server";
import { z } from "zod";
import { DEVICE_COOKIE, assertSameOrigin, clientIp, cookieOptions, finderCookieName, readJson, route } from "@/server/http";
import { dispatchSafely, postFinderMessage } from "@/server/services/finder";
import { REASON_CODES } from "@/server/services/reasons";

const Body = z.object({
  reason: z.enum(REASON_CODES),
  place: z.string().max(300).optional(),
  body: z.string().max(600).optional(),
});

export const POST = route("finder.message", async (req, deps, ctx: RouteContext<"/api/v1/finder/[token]/messages">) => {
  assertSameOrigin(req);
  const { token } = await ctx.params;
  const input = await readJson(req, Body);
  const store = await cookies();
  const upper = normalizeCode(token);
  let deviceId = store.get(DEVICE_COOKIE)?.value;
  if (!deviceId || deviceId.length > 64) {
    deviceId = randomUUID();
    store.set(DEVICE_COOKIE, deviceId, cookieOptions(365 * 24 * 3600));
  }
  const result = await postFinderMessage(
    deps,
    { token: upper, finderKey: store.get(finderCookieName(upper))?.value, deviceId, ip: clientIp(req), ...input },
    { dispatchInline: false },
  );
  if (result.newFinderKey) {
    store.set(finderCookieName(upper), result.newFinderKey, cookieOptions(deps.config.threadTtlHours * 3600));
  }
  // 알림 발송은 응답을 보낸 뒤에 한다(습득자 화면이 알림톡 API를 기다리지 않게).
  after(() => dispatchSafely(deps));
  return Response.json(
    { threadId: result.threadId, notified: result.notified, deferred: result.deferred, remaining: result.remaining },
    { status: 201 },
  );
});
