import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TOKEN_LENGTH, isValidCode, normalizeCode } from "@/lib/codes";

export const metadata: Metadata = { title: "태그 코드 입력" };

export default async function FindPage({ searchParams }: PageProps<"/find">) {
  const raw = (await searchParams).code;
  const code = normalizeCode(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""));
  if (isValidCode(code, TOKEN_LENGTH)) redirect(`/q/${code}`);
  const tried = code.length > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold">태그 코드를 입력해 주세요</h1>
      <p className="mt-2 text-sm text-muted">QR 아래에 적힌 10자리 코드예요(0·1·I·O는 쓰지 않아요).</p>
      <form action="/find" method="get" className="mt-6 space-y-3">
        <label htmlFor="code" className="sr-only">
          태그 코드
        </label>
        <input
          id="code"
          name="code"
          defaultValue={tried ? code : ""}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="예: GSXP-PQQP-M6"
          aria-invalid={tried}
          aria-describedby={tried ? "code-error" : undefined}
          className="w-full rounded-lg border border-line bg-field px-3.5 py-3 font-mono text-base tracking-wider placeholder:text-muted/70"
          required
        />
        {tried && (
          <p id="code-error" role="alert" className="text-sm text-error">
            코드 형식이 맞지 않아요. 다시 확인해 주세요.
          </p>
        )}
        <button className="w-full rounded-lg bg-primary px-4 py-3.5 text-base font-semibold text-white">다음</button>
      </form>
    </main>
  );
}
