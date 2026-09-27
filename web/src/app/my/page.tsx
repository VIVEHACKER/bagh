import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDeps } from "@/server/deps";
import { currentOwner } from "@/server/http";
import { alertUsage, getQuietHours, listContacts, listStickers, listThreads } from "@/server/services/owner";
import MyClient from "./MyClient";

export const metadata: Metadata = { title: "내 태그" };

export default async function MyPage() {
  await connection();
  const deps = await getDeps();
  const ownerId = await currentOwner(deps);
  if (!ownerId) redirect("/start");
  const [stickers, contacts, quietHours, threads, alerts] = await Promise.all([
    listStickers(deps, ownerId),
    listContacts(deps, ownerId),
    getQuietHours(deps, ownerId),
    listThreads(deps, ownerId),
    alertUsage(deps, ownerId),
  ]);
  return <MyClient stickers={stickers} contacts={contacts} quietHours={quietHours} threads={threads} alerts={alerts} />;
}
