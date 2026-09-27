import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isAppError } from "@/lib/errors";
import { getDeps } from "@/server/deps";
import { currentOwner } from "@/server/http";
import { openThreadForOwner, type ReplyAuth } from "@/server/services/replies";
import ReplyClient from "./ReplyClient";

export const metadata: Metadata = { title: "답장하기", robots: { index: false, follow: false } };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ReplyPage({ params, searchParams }: PageProps<"/r/[threadId]">) {
  await connection();
  const { threadId } = await params;
  const sp = await searchParams;
  const e = first(sp.e);
  const s = first(sp.s);
  const deps = await getDeps();
  const ownerId = await currentOwner(deps);
  const loginUrl = `/start?next=${encodeURIComponent(`/r/${threadId}`)}`;

  const auth: ReplyAuth = { link: e && s && Number.isFinite(Number(e)) ? { e: Number(e), s } : undefined, ownerId };
  if (!auth.link && !ownerId) redirect(loginUrl);

  // 링크 → 세션 순서는 서비스가 정한다. 조회만 try 안에서 하고, 화면은 밖에서 그린다.
  let view: Awaited<ReturnType<typeof openThreadForOwner>> | null = null;
  let errorCode = "";
  try {
    view = await openThreadForOwner(deps, threadId, auth);
  } catch (err) {
    if (!isAppError(err)) throw err;
    errorCode = err.code;
  }
  if (view) {
    // 링크로 열었을 때만 링크를 넘긴다. 링크가 만료되면 서버가 로그인 세션으로 이어 받는다.
    return <ReplyClient threadId={threadId} initial={view} link={view.via === "link" ? (auth.link ?? null) : null} loggedIn={Boolean(ownerId)} />;
  }

  const expired = errorCode === "link_expired";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold leading-snug">{expired ? "링크 시간이 지났어요" : "대화를 열 수 없어요"}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {expired ? `보안을 위해 알림 링크는 ${deps.config.replyLinkTtlMin}분 동안만 열려요. 로그인하면 이어서 답장할 수 있어요.` : "링크가 올바르지 않거나 내 태그의 대화가 아니에요."}
      </p>
      <Link href={loginUrl} className="mt-8 w-full rounded-lg bg-primary px-4 py-3.5 text-center text-base font-semibold text-white">
        로그인하고 답장하기
      </Link>
    </main>
  );
}
