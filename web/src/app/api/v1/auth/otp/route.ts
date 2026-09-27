import { z } from "zod";
import { forbidden } from "@/lib/errors";
import { assertSameOrigin, clientIp, currentOwner, isLocalRequest, readJson, route } from "@/server/http";
import { requestOtp } from "@/server/services/auth";

const Body = z.object({
  phone: z.string().min(9).max(20),
  purpose: z.enum(["login", "add_contact"]),
});

export const POST = route("auth.otp", async (req, deps) => {
  assertSameOrigin(req);
  const input = await readJson(req, Body);
  let ownerId: string | undefined;
  if (input.purpose === "add_contact") {
    ownerId = (await currentOwner(deps)) ?? undefined;
    if (!ownerId) throw forbidden("login_required", "로그인한 뒤에 번호를 추가할 수 있어요.");
  }
  const result = await requestOtp(deps, { phone: input.phone, purpose: input.purpose, ip: clientIp(req), ownerId });
  // 개발용 인증번호(EXPOSE_DEV_OTP=1)는 로컬 접속에만 돌려준다.
  return Response.json(isLocalRequest(req) ? result : { challengeId: result.challengeId }, { status: 201 });
});
