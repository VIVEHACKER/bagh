import type { Metadata } from "next";
import { connection } from "next/server";
import { getDeps } from "@/server/deps";
import { currentOwner } from "@/server/http";
import StartClient from "./StartClient";

export const metadata: Metadata = { title: "태그 등록" };

function safeNext(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  // 열린 리다이렉트를 막기 위해 우리 경로(/my, /r/…)만 허용한다.
  return v && /^\/(my|r\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\?[\w=&%.-]*)?$/i.test(v) ? v : "/my";
}

export default async function StartPage({ searchParams }: PageProps<"/start">) {
  await connection();
  const deps = await getDeps();
  const ownerId = await currentOwner(deps);
  const next = safeNext((await searchParams).next);
  return <StartClient loggedIn={Boolean(ownerId)} next={next} />;
}
