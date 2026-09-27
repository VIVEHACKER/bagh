import type { Metadata } from "next";
import { readLimits } from "@/server/deps";

export const metadata: Metadata = { title: "이용약관" };

// @AX:TODO: 사업자 정보, 환불·서비스 종료 절차의 법률 검토 후 확정한다.
export default function TermsPage() {
  const limits = readLimits();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold">이용약관(초안)</h1>
      <p className="mt-2 text-muted">시행 전 초안입니다.</p>

      <h2 className="mt-8 text-base font-semibold">1. 서비스</h2>
      <p className="mt-2">태그의 QR을 스캔한 분이 남긴 메시지를 태그 주인에게 알림으로 전달하고, 주인의 답장을 스캔한 분의 화면에 보여 줍니다. 전화 연결은 제공하지 않습니다.</p>
      <p className="mt-2">
        알림은 태그당 하루 {limits.notifyPerTagDaily}개 대화(대화 하나에 {limits.notifyPerThread}건), 주인 한 명당 30일에{" "}
        {limits.notifyPerOwnerMonthly}건까지 보냅니다. 이를 넘는 메시지는 알림 없이 저장되며, 주인은 사이트에서 확인할 수 있습니다.
      </p>

      <h2 className="mt-6 text-base font-semibold">2. 제공 기간</h2>
      <p className="mt-2">QR 알림 서비스는 구매일로부터 최소 3년간 추가 요금 없이 제공합니다. 서비스를 끝내야 할 때는 3개월 전에 알리고, 등록 정보를 내려받을 수 있게 합니다.</p>

      <h2 className="mt-6 text-base font-semibold">3. 이용자의 책임</h2>
      <p className="mt-2">본인이 쓸 권한이 있는 휴대폰 번호만 등록해야 합니다. 태그를 이용해 다른 사람을 괴롭히거나 속이는 메시지를 보내면 이용을 제한할 수 있습니다.</p>

      <h2 className="mt-6 text-base font-semibold">4. 보장 범위</h2>
      <p className="mt-2">서비스는 연락을 돕는 도구이며, 분실물의 반환을 보장하지 않습니다.</p>
    </main>
  );
}
