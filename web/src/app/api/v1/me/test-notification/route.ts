import { rateLimited } from "@/lib/errors";
import { assertSameOrigin, requireOwner, route } from "@/server/http";
import { sendTestNotification } from "@/server/services/owner";

/** 등록 직후 "알림이 정말 오는지" 확인용. 주인당 1시간에 3번까지. */
export const POST = route("me.test_notification", async (req, deps) => {
  assertSameOrigin(req);
  const ownerId = await requireOwner(deps);
  const r = await deps.limiter.hit(`test-notify:${ownerId}`, 3, 3_600_000, deps.now().getTime());
  if (!r.ok) throw rateLimited(r.retryAfterSec);
  const sent = await sendTestNotification(deps, ownerId);
  return Response.json({ sent });
});
