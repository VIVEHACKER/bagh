import Link from "next/link";
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-12 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-10 text-3xl font-bold leading-tight">
        주우면 연락되는
        <br />
        네임태그
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        태그의 QR을 찍으면 주인에게 알림이 가요. 주인과 주운 분 모두 전화번호가 공개되지 않고, 앱 설치도 필요 없어요.
      </p>

      <section className="mt-10 rounded-lg border border-line p-5" aria-labelledby="found">
        <h2 id="found" className="text-base font-semibold">
          물건을 주우셨나요?
        </h2>
        <p className="mt-1.5 text-sm text-muted">QR이 안 찍히면 태그에 적힌 코드 10자리를 입력해 주세요.</p>
        <form action="/find" method="get" className="mt-4 space-y-3">
          <label htmlFor="code" className="sr-only">
            태그 코드
          </label>
          <input
            id="code"
            name="code"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="예: GSXP-PQQP-M6"
            className="w-full rounded-lg border border-line bg-field px-3.5 py-3 font-mono text-base tracking-wider placeholder:text-muted/70"
            required
          />
          <button className="w-full rounded-lg bg-primary px-4 py-3.5 text-base font-semibold text-white">주인에게 알리러 가기</button>
        </form>
      </section>

      <section className="mt-4 rounded-lg border border-line p-5" aria-labelledby="owner">
        <h2 id="owner" className="text-base font-semibold">
          태그를 받으셨나요?
        </h2>
        <p className="mt-1.5 text-sm text-muted">카드 안쪽의 등록 코드로 한 번만 등록하면 돼요.</p>
        <Link href="/start" className="mt-4 block rounded-lg border border-line px-4 py-3 text-center text-sm font-medium">
          태그 등록하기
        </Link>
      </section>

      <footer className="mt-auto flex gap-4 pt-12 text-xs text-muted">
        <Link href="/privacy" className="underline underline-offset-4">
          개인정보처리방침
        </Link>
        <Link href="/terms" className="underline underline-offset-4">
          이용약관
        </Link>
      </footer>
    </main>
  );
}
