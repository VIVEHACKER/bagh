import type { Metadata } from "next";

export const metadata: Metadata = { title: "개인정보처리방침" };

// @AX:TODO: 사업자등록 후 처리자 정보(상호·대표·연락처), 위탁사(알림톡 딜러사), 국외 이전(호스팅 리전)을 확정해 채운다.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-relaxed">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold">개인정보처리방침(초안)</h1>
      <p className="mt-2 text-muted">시행 전 초안입니다. 사업자 정보와 위탁사가 정해지면 갱신합니다.</p>

      <h2 className="mt-8 text-base font-semibold">1. 처리하는 개인정보</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>태그 주인: 휴대폰 번호(로그인·알림 수신용). 번호는 암호화해 보관합니다.</li>
        <li>태그를 스캔한 분: 연락처를 받지 않습니다. 직접 적은 메시지와 장소 설명만 주인에게 전달합니다.</li>
        <li>자동 수집: 남용 방지를 위한 접속 정보(IP, 브라우저 식별 쿠키). 위치 정보는 수집하지 않습니다.</li>
      </ul>

      <h2 className="mt-6 text-base font-semibold">2. 이용 목적</h2>
      <p className="mt-2">본인 확인, 태그로 온 연락의 알림 전송, 서비스 남용 방지.</p>

      <h2 className="mt-6 text-base font-semibold">3. 보관 기간</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>대화: 대화 종료(72시간) 후 30일이 지나면 삭제</li>
        <li>인증번호 기록: 만료 후 1일 이내 삭제</li>
        <li>휴대폰 번호: 회원 탈퇴 시 삭제</li>
      </ul>

      <h2 className="mt-6 text-base font-semibold">4. 처리 위탁과 국외 이전</h2>
      <p className="mt-2">알림톡·문자 발송 대행사와 서버 호스팅사는 확정 후 이 문서에 공개합니다.</p>

      <h2 className="mt-6 text-base font-semibold">5. 이용자의 권리</h2>
      <p className="mt-2">열람·정정·삭제·처리정지를 요청할 수 있습니다. 문의처는 확정 후 공개합니다.</p>

      <h2 className="mt-6 text-base font-semibold">6. 만 14세 미만</h2>
      <p className="mt-2">만 14세 미만은 가입할 수 없습니다.</p>
    </main>
  );
}
