import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { FINDER_TEXT, pickLang } from "@/lib/i18n";
import { getDeps } from "@/server/deps";
import { getFinderView } from "@/server/services/finder";
import FinderClient from "./FinderClient";

export const metadata: Metadata = { title: "주인에게 알리기", robots: { index: false, follow: false } };

export default async function FinderPage({ params }: PageProps<"/q/[token]">) {
  await connection();
  const { token } = await params;
  const deps = await getDeps();
  const view = await getFinderView(deps, token);
  if (view.state !== "not_found" && view.token !== token) redirect(`/q/${view.token}`);
  const lang = pickLang((await headers()).get("accept-language"));

  if (view.state === "active") {
    return <FinderClient token={view.token} initialLang={lang} />;
  }

  const t = FINDER_TEXT[lang];
  const copy =
    view.state === "unregistered"
      ? { title: t.unregisteredTitle, body: t.unregisteredBody }
      : view.state === "unavailable"
        ? { title: t.unavailableTitle, body: t.unavailableBody }
        : { title: t.notFoundTitle, body: t.notFoundBody };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-6 text-2xl font-bold leading-snug">{copy.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{copy.body}</p>
      {view.state === "unregistered" && (
        <Link href="/start" className="mt-8 inline-flex w-fit rounded-lg border border-line px-4 py-2.5 text-sm font-medium">
          주인 등록 페이지로
        </Link>
      )}
    </main>
  );
}
