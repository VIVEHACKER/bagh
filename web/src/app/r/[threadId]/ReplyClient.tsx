"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/api-client";
import { FINDER_TEXT } from "@/lib/i18n";
import { formatKst } from "@/lib/kst";

type ReplyKey = keyof (typeof FINDER_TEXT)["ko"]["replies"];
type ReasonKey = keyof (typeof FINDER_TEXT)["ko"]["reasons"];

interface Message {
  sender: "finder" | "owner";
  reasonCode: string | null;
  placeText: string | null;
  body: string | null;
  replyCode: string | null;
  notified?: boolean;
  createdAt: string;
}

interface View {
  label?: string | null;
  expired: boolean;
  remaining: number;
  messages: Message[];
}

const ko = FINDER_TEXT.ko;
const REPLY_KEYS = Object.keys(ko.replies) as ReplyKey[];

export default function ReplyClient(props: { threadId: string; initial: View; link: { e: number; s: string } | null; loggedIn: boolean }) {
  const [view, setView] = useState<View>(props.initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);

  async function send(replyCode?: ReplyKey) {
    setBusy(true);
    setError("");
    try {
      const next = await api<View>(`/api/v1/replies/${props.threadId}`, {
        body: { replyCode, body: replyCode ? undefined : text, ...(props.link ?? {}) },
      });
      setView((prev) => ({ ...next, label: prev.label }));
      setText("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/replies/${props.threadId}/block`, { body: {} });
      setBlocked(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const canReply = !view.expired && view.remaining > 0 && !blocked;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-16 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>
      <h1 className="mt-8 text-2xl font-bold leading-snug">
        {/* 라벨 끝 글자의 받침에 따라 조사가 바뀌므로 항상 "태그로"로 끝낸다. */}
        {view.label ? `'${view.label}' 태그로` : "내 태그로"} 연락이 왔어요
      </h1>
      <p className="mt-2 text-sm text-muted">답장은 스캔한 분의 화면에 표시돼요. 서로 번호는 공개되지 않아요.</p>

      <section className="mt-6 space-y-3" aria-live="polite">
        {view.messages.map((m, i) => (
          <article key={i} className={`rounded-lg border p-4 ${m.sender === "owner" ? "border-line text-muted" : "border-on-surface"}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {m.sender === "owner" ? "내 답장" : "스캔한 분"} · {formatKst(m.createdAt)}
            </p>
            {m.sender === "finder" ? (
              <>
                <p className="mt-2 text-base font-medium">{m.reasonCode ? ko.reasons[m.reasonCode as ReasonKey] : ""}</p>
                {m.placeText && <p className="mt-1 text-sm">지금 있는 곳: {m.placeText}</p>}
                {m.body && <p className="mt-1 text-sm">{m.body}</p>}
                {m.notified === false && <p className="mt-2 text-xs text-muted">알림 한도를 넘어 알림 없이 저장된 메시지예요.</p>}
              </>
            ) : (
              <p className="mt-2 text-sm">{m.replyCode ? ko.replies[m.replyCode as ReplyKey] : m.body}</p>
            )}
          </article>
        ))}
      </section>

      {canReply ? (
        <section className="mt-8 space-y-3" aria-labelledby="quick">
          <h2 id="quick" className="text-xs font-semibold uppercase tracking-wider text-muted">
            빠른 답장
          </h2>
          {REPLY_KEYS.map((key, i) => (
            <button
              key={key}
              disabled={busy}
              onClick={() => send(key)}
              className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium disabled:opacity-60 ${i === 0 ? "bg-primary text-white" : "border border-line"}`}
            >
              {ko.replies[key]}
            </button>
          ))}
          <div className="flex gap-2 pt-2">
            <label htmlFor="reply" className="sr-only">
              직접 답장
            </label>
            <input
              id="reply"
              value={text}
              maxLength={200}
              onChange={(e) => setText(e.target.value)}
              placeholder="직접 적기"
              className="w-full rounded-lg border border-line bg-field px-3.5 py-2.5 text-base placeholder:text-muted/70"
            />
            <button disabled={busy || !text.trim()} onClick={() => send()} className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium disabled:opacity-60">
              보내기
            </button>
          </div>
          <p className="text-xs text-muted">남은 메시지 {view.remaining}개</p>
        </section>
      ) : (
        <p className="mt-8 text-sm text-muted">{blocked ? "이 대화를 더 받지 않기로 했어요." : "이 대화는 끝났어요."}</p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-error">
          {error}
        </p>
      )}

      {props.loggedIn && !blocked && (
        <button onClick={block} disabled={busy} className="mt-10 text-left text-xs text-muted underline underline-offset-4">
          이 대화 그만 받기
        </button>
      )}
    </main>
  );
}
