"use client";

import { useCallback, useEffect, useState } from "react";
import { FINDER_TEXT, LANGS, LANG_NAMES, type Lang } from "@/lib/i18n";

type Reason = "found" | "left_behind" | "other";
type ReplyKey = keyof (typeof FINDER_TEXT)["ko"]["replies"];
type ErrorKey = keyof (typeof FINDER_TEXT)["ko"]["errors"];

interface ThreadMessage {
  sender: "finder" | "owner";
  reasonCode: Reason | null;
  placeText: string | null;
  body: string | null;
  replyCode: ReplyKey | null;
  notified: boolean;
  createdAt: string;
}

interface ThreadView {
  threadId: string;
  remaining: number;
  expired: boolean;
  messages: ThreadMessage[];
}

const POLL_MS = 8000;

export default function FinderClient({ token, initialLang }: { token: string; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = FINDER_TEXT[lang];
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [reason, setReason] = useState<Reason>("found");
  const [place, setPlace] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [deferred, setDeferred] = useState(false);

  const loadThread = useCallback(async () => {
    const res = await fetch(`/api/v1/finder/${token}/thread`, { cache: "no-store" });
    if (res.ok) setThread((await res.json()) as ThreadView);
    // 대화 기간이 끝나면 서버가 410을 준다. 끝난 것으로 표시해 주기 조회를 멈춘다.
    else if (res.status === 410) setThread((prev) => (prev ? { ...prev, expired: true } : prev));
    return res.status;
  }, [token]);

  // 다시 스캔한 습득자는 이어서 대화를 본다(쿠키에 스레드 비밀값이 있을 때).
  // 조회가 실패하면 "기존 대화 없음"과 같게 보고 새 메시지 폼을 보여 준다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/finder/${token}/thread`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ThreadView>) : null))
      .catch(() => null)
      .then((data) => {
        if (!cancelled && data) setThread(data);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 조회 결과마다 타이머를 다시 만들지 않게 "조회할지"만 의존한다.
  const polling = thread !== null && !thread.expired;
  useEffect(() => {
    if (!polling) return;
    const id = window.setInterval(() => {
      // 네트워크 오류는 다음 주기에 다시 시도한다.
      if (document.visibilityState === "visible") loadThread().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [polling, loadThread]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/finder/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, place: place || undefined, body: body || undefined }),
      });
      if (!res.ok) {
        const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
        setError(code && code in t.errors ? (code as ErrorKey) : "default");
        return;
      }
      const data = (await res.json()) as { deferred: boolean };
      setDeferred(data.deferred);
      setPlace("");
      setBody("");
      await loadThread();
    } catch {
      setError("default");
    } finally {
      setSending(false);
    }
  }

  const canSend = !thread || (thread.remaining > 0 && !thread.expired);
  // 마지막 메시지가 알림 한도를 넘어 저장만 됐으면 "알렸어요" 대신 "남겼어요"로 솔직하게 보여 준다.
  const saved = thread?.messages.filter((m) => m.sender === "finder").at(-1)?.notified === false;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-12 pt-6">
      <header className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
        <label className="text-xs text-muted">
          <span className="sr-only">Language</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-lg border border-line bg-field px-2 py-1 text-xs text-on-surface"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      </header>

      <h1 className="mt-8 text-2xl font-bold leading-snug">{thread ? (saved ? t.savedTitle : t.sentTitle) : t.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{thread ? (saved ? t.savedHint : deferred ? t.deferredHint : t.sentHint) : t.subtitle}</p>

      {thread && (
        <section aria-live="polite" className="mt-6 space-y-3">
          {thread.messages.map((m, i) =>
            m.sender === "owner" ? (
              <article key={i} className="rounded-lg border border-primary p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t.ownerReply}</p>
                <p className="mt-2 text-base font-medium">{m.replyCode ? t.replies[m.replyCode] : null}</p>
                {m.body && <p className="mt-1 text-sm">{m.body}</p>}
              </article>
            ) : (
              <article key={i} className="rounded-lg border border-line p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t.yourMessage}</p>
                <p className="mt-2 text-sm">
                  {m.reasonCode ? t.reasons[m.reasonCode] : null}
                  {m.placeText ? ` · ${m.placeText}` : ""}
                </p>
                {m.body && <p className="mt-1 text-sm text-muted">{m.body}</p>}
              </article>
            ),
          )}
        </section>
      )}

      {canSend && (
        <form onSubmit={submit} className="mt-8 space-y-6">
          {thread && <h2 className="text-sm font-semibold">{t.followUp}</h2>}
          <fieldset>
            <legend className="text-sm font-medium">{t.reasonLegend}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(t.reasons) as Reason[]).map((r) => (
                <label
                  key={r}
                  className={`cursor-pointer rounded-lg border px-3.5 py-2 text-sm ${reason === r ? "border-on-surface" : "border-line text-muted"}`}
                >
                  <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                  {t.reasons[r]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="place" className="text-sm font-medium">
              {t.placeLabel}
            </label>
            <input
              id="place"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              maxLength={100}
              placeholder={t.placeHint}
              className="mt-2 w-full rounded-lg border border-line bg-field px-3.5 py-3 text-base placeholder:text-muted/70"
            />
          </div>

          <div>
            <label htmlFor="body" className="text-sm font-medium">
              {t.bodyLabel}
            </label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder={t.bodyHint}
              className="mt-2 w-full resize-none rounded-lg border border-line bg-field px-3.5 py-3 text-base placeholder:text-muted/70"
            />
            <p className="mt-1.5 text-xs text-muted">{t.contactWarning}</p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-error">
              {t.errors[error]}
            </p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="w-full rounded-lg bg-primary px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60"
          >
            {sending ? t.sending : t.send}
          </button>
          <p className="text-center text-xs text-muted">
            {thread ? t.remaining(thread.remaining) : t.noApp}
          </p>
        </form>
      )}
    </main>
  );
}
