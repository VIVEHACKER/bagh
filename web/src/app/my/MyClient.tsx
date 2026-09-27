"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api-client";
import { formatKst } from "@/lib/kst";

interface Sticker {
  token: string;
  label: string | null;
  status: string;
}
interface Contact {
  id: string;
  masked: string;
  isLogin: boolean;
}
interface ThreadSummary {
  threadId: string;
  label: string | null;
  messageCount: number;
  createdAt: string;
  expiresAt: string;
}

const field = "w-full rounded-lg border border-line bg-field px-3.5 py-2.5 text-base placeholder:text-muted/70";
const secondary = "rounded-lg border border-line px-3.5 py-2 text-sm font-medium disabled:opacity-60";
const card = "rounded-lg border border-line p-4";

function toHhMm(min: number | null): string {
  return min == null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function group(token: string): string {
  return token.match(/.{1,4}/g)?.join("-") ?? token;
}

export default function MyClient(props: {
  stickers: Sticker[];
  contacts: Contact[];
  quietHours: { startMin: number | null; endMin: number | null };
  threads: ThreadSummary[];
  alerts: { used: number; limit: number; silenced: number };
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(props.stickers.map((s) => [s.token, s.label ?? ""])));
  const [quietStart, setQuietStart] = useState(toHhMm(props.quietHours.startMin));
  const [quietEnd, setQuietEnd] = useState(toHhMm(props.quietHours.endMin));
  const [newPhone, setNewPhone] = useState("");
  const [otp, setOtp] = useState<{ challengeId: string; devCode?: string } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [notice, setNotice] = useState("");

  async function run(fn: () => Promise<void>, done?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (done) setNotice(done);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-16 pt-6">
      <header className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
        <button
          className="text-xs text-muted underline underline-offset-4"
          onClick={() => run(async () => {
            await api("/api/v1/auth/logout", { body: {} });
            router.push("/");
          })}
        >
          로그아웃
        </button>
      </header>
      <h1 className="mt-8 text-2xl font-bold">내 태그</h1>

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={`mt-4 text-sm ${error ? "text-error" : "text-muted"}`}>
          {error || notice}
        </p>
      )}

      <section className="mt-6 space-y-3" aria-labelledby="tags">
        <h2 id="tags" className="text-xs font-semibold uppercase tracking-wider text-muted">
          태그
        </h2>
        {props.stickers.length === 0 && <p className="text-sm text-muted">아직 등록한 태그가 없어요.</p>}
        {props.stickers.map((s) => (
          <div key={s.token} className={card}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-muted">{group(s.token)}</span>
              <span className={`text-xs ${s.status === "active" ? "text-on-surface" : "text-muted"}`}>
                {s.status === "active" ? "알림 켜짐" : "알림 꺼짐"}
              </span>
            </div>
            <div className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor={`l-${s.token}`}>
                태그 이름
              </label>
              <input
                id={`l-${s.token}`}
                className={field}
                maxLength={20}
                value={labels[s.token] ?? ""}
                placeholder="예: 네이비 캐디백"
                onChange={(e) => setLabels((p) => ({ ...p, [s.token]: e.target.value }))}
              />
              <button
                className={secondary}
                disabled={busy}
                onClick={() => run(() => api(`/api/v1/me/stickers/${s.token}`, { method: "PATCH", body: { label: labels[s.token]?.trim() || null } }), "이름을 저장했어요.")}
              >
                저장
              </button>
            </div>
            <button
              className={`${secondary} mt-3`}
              disabled={busy}
              onClick={() =>
                run(
                  () => api(`/api/v1/me/stickers/${s.token}`, { method: "PATCH", body: { status: s.status === "active" ? "paused" : "active" } }),
                  s.status === "active" ? "알림을 잠시 껐어요." : "알림을 다시 켰어요.",
                )
              }
            >
              {s.status === "active" ? "알림 잠시 끄기" : "알림 다시 켜기"}
            </button>
          </div>
        ))}
        <Link href="/start" className={`${secondary} inline-block`}>
          태그 추가 등록
        </Link>
      </section>

      <section className="mt-10 space-y-3" aria-labelledby="threads">
        <h2 id="threads" className="text-xs font-semibold uppercase tracking-wider text-muted">
          최근 연락
        </h2>
        <p className="text-xs text-muted">
          최근 30일 알림 {props.alerts.used}/{props.alerts.limit}건
          {props.alerts.silenced > 0 && ` · 알림 없이 저장된 메시지 ${props.alerts.silenced}건(아래 대화에서 확인하세요)`}
        </p>
        {props.threads.length === 0 && <p className="text-sm text-muted">아직 받은 연락이 없어요.</p>}
        {props.threads.map((t) => (
          <Link key={t.threadId} href={`/r/${t.threadId}`} className={`${card} block`}>
            <p className="text-sm font-medium">{t.label ?? "이름 없는 태그"}</p>
            <p className="mt-1 text-xs text-muted">
              {formatKst(t.createdAt)} · 메시지 {t.messageCount}개
            </p>
          </Link>
        ))}
      </section>

      <section className="mt-10 space-y-3" aria-labelledby="contacts">
        <h2 id="contacts" className="text-xs font-semibold uppercase tracking-wider text-muted">
          알림 받을 번호 (최대 3개, 동시에 알림)
        </h2>
        {props.contacts.map((c) => (
          <div key={c.id} className={`${card} flex items-center justify-between`}>
            <span className="font-mono text-sm">{c.masked}</span>
            {c.isLogin ? (
              <span className="text-xs text-muted">로그인 번호</span>
            ) : (
              <button className={secondary} disabled={busy} onClick={() => run(() => api(`/api/v1/me/contacts/${c.id}`, { method: "DELETE" }), "번호를 지웠어요.")}>
                지우기
              </button>
            )}
          </div>
        ))}
        {props.contacts.length < 3 && !otp && (
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="new-phone">
              추가할 번호
            </label>
            <input id="new-phone" className={field} inputMode="tel" placeholder="010-0000-0000" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
            <button
              className={secondary}
              disabled={busy || !newPhone}
              onClick={() =>
                run(async () => {
                  setOtp(await api<{ challengeId: string; devCode?: string }>("/api/v1/auth/otp", { body: { phone: newPhone, purpose: "add_contact" } }));
                }, "인증번호를 보냈어요.")
              }
            >
              인증
            </button>
          </div>
        )}
        {otp && (
          <div className="space-y-2">
            {otp.devCode && <p className="font-mono text-xs text-muted">개발 모드 인증번호: {otp.devCode}</p>}
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="add-otp">
                인증번호
              </label>
              <input id="add-otp" className={`${field} font-mono`} inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))} />
              <button
                className={secondary}
                disabled={busy || otpCode.length !== 6}
                onClick={() =>
                  run(async () => {
                    await api("/api/v1/me/contacts", { body: { challengeId: otp.challengeId, code: otpCode } });
                    setOtp(null);
                    setOtpCode("");
                    setNewPhone("");
                  }, "번호를 추가했어요.")
                }
              >
                추가
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-10 space-y-3" aria-labelledby="quiet">
        <h2 id="quiet" className="text-xs font-semibold uppercase tracking-wider text-muted">
          방해금지 시간
        </h2>
        <p className="text-sm text-muted">이 시간에 온 연락은 끝나는 시각에 모아서 알려 드려요.</p>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="q-start">
            시작
          </label>
          <input id="q-start" type="time" className={field} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
          <span className="text-muted">~</span>
          <label className="sr-only" htmlFor="q-end">
            끝
          </label>
          <input id="q-end" type="time" className={field} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className={secondary} disabled={busy || !quietStart || !quietEnd} onClick={() => run(() => api("/api/v1/me/quiet-hours", { method: "PUT", body: { start: quietStart, end: quietEnd } }), "방해금지 시간을 저장했어요.")}>
            저장
          </button>
          <button
            className={secondary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/api/v1/me/quiet-hours", { method: "PUT", body: { start: null, end: null } });
                setQuietStart("");
                setQuietEnd("");
              }, "방해금지를 껐어요.")
            }
          >
            끄기
          </button>
        </div>
      </section>
    </main>
  );
}
