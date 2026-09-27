import { safeEqual } from "@/lib/crypto";
import { forbidden, notFound } from "@/lib/errors";
import { route } from "@/server/http";
import { dispatchDue } from "@/server/services/notifications";
import { purgeExpired } from "@/server/services/retention";

/**
 * 미룬 알림(방해금지)과 재시도 알림을 보내고, 보관 기간이 지난 데이터를 지운다.
 * 스케줄러가 Authorization: Bearer <CRON_SECRET> 헤더로 호출한다. 비밀값이 없으면 꺼져 있다.
 */
export const GET = route("cron.dispatch", async (req, deps) => {
  const secret = deps.config.cronSecret;
  if (!secret) throw notFound("cron_disabled", "없는 경로예요.");
  const given = req.headers.get("authorization") ?? "";
  if (!safeEqual(given, `Bearer ${secret}`)) throw forbidden("cron_forbidden", "허용되지 않은 요청이에요.");
  const dispatched = await dispatchDue(deps, 200);
  const purged = await purgeExpired(deps);
  return Response.json({ dispatched, purged });
});
