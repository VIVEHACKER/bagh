import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAppError } from "@/lib/errors";
import { getDeps } from "@/server/deps";
import { clientIp } from "@/server/http";
import { resolveShortLink } from "@/server/services/short-links";

export const metadata: Metadata = { title: "답장하기", robots: { index: false, follow: false } };

/** 대체 문자에 넣은 짧은 주소. 답장 화면으로 넘긴다(유효 시간이 지나면 로그인해서 답장하는 화면). */
export default async function ShortLinkPage({ params }: PageProps<"/m/[code]">) {
  const { code } = await params;
  const deps = await getDeps();
  // 조회만 try 안에서 하고, redirect·notFound는 밖에서 부른다(Next가 예외로 처리한다).
  let target: string | null;
  try {
    target = await resolveShortLink(deps, code, clientIp({ headers: await headers() }));
  } catch (err) {
    if (!isAppError(err) || err.code !== "rate_limited") throw err;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
        <h1 className="mt-6 text-2xl font-bold leading-snug">잠시 뒤에 다시 열어 주세요</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">짧은 시간에 너무 많이 열었어요.</p>
      </main>
    );
  }
  if (!target) notFound();
  redirect(target);
}
