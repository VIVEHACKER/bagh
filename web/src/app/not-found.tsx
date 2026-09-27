import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold">페이지를 찾을 수 없어요</h1>
      <Link href="/" className="mt-8 w-fit rounded-lg border border-line px-4 py-2.5 text-sm font-medium">
        처음으로
      </Link>
    </main>
  );
}
