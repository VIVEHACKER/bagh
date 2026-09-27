"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api-client";

type Step = "phone" | "code" | "claim" | "label" | "done";

interface ClaimedSticker {
  token: string;
  position: number;
  label: string | null;
}

const field = "mt-2 w-full rounded-lg border border-line bg-field px-3.5 py-3 text-base placeholder:text-muted/70";
const primary = "w-full rounded-lg bg-primary px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60";
const secondary = "w-full rounded-lg border border-line px-4 py-3 text-sm font-medium";

export default function StartClient({ loggedIn, next }: { loggedIn: boolean; next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(loggedIn ? "claim" : "phone");
  const [phone, setPhone] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [code, setCode] = useState("");
  const [claimCode, setClaimCode] = useState("");
  const [stickers, setStickers] = useState<ClaimedSticker[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ challengeId: string; devCode?: string }>("/api/v1/auth/otp", { body: { phone, purpose: "login" } });
      setChallengeId(res.challengeId);
      setDevCode(res.devCode);
      setStep("code");
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/auth/login", { body: { challengeId, code } });
      if (next !== "/my") {
        router.replace(next);
        return;
      }
      setStep("claim");
    });
  };

  const claim = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ stickers: ClaimedSticker[] }>("/api/v1/claims", { body: { claimCode } });
      setStickers(res.stickers);
      setLabels(Object.fromEntries(res.stickers.map((s) => [s.token, s.label ?? ""])));
      setStep("label");
    });
  };

  const saveLabels = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      for (const s of stickers) {
        const label = labels[s.token]?.trim() ?? "";
        if (label !== (s.label ?? "")) await api(`/api/v1/me/stickers/${s.token}`, { method: "PATCH", body: { label: label || null } });
      }
      setStep("done");
    });
  };

  const testNotify = () =>
    run(async () => {
      const res = await api<{ sent: number }>("/api/v1/me/test-notification", { body: {} });
      setNotice(`${res.sent}개 번호로 테스트 알림을 보냈어요.`);
    });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-12 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">BAGHOME 백홈</p>

      {step === "phone" && (
        <form onSubmit={sendCode} className="mt-8 space-y-6">
          <h1 className="text-2xl font-bold leading-snug">태그 등록하기</h1>
          <p className="text-sm leading-relaxed text-muted">
            알림을 받을 휴대폰 번호로 인증해 주세요. 번호는 암호화해 보관하고, 태그를 주운 사람에게는 보이지 않아요.
          </p>
          <div>
            <label htmlFor="phone" className="text-sm font-medium">
              휴대폰 번호
            </label>
            <input id="phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" className={field} required />
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button className={primary} disabled={busy}>
            인증번호 받기
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verify} className="mt-8 space-y-6">
          <h1 className="text-2xl font-bold leading-snug">인증번호를 입력해 주세요</h1>
          <p className="text-sm text-muted">문자로 받은 6자리 숫자를 5분 안에 입력해 주세요.</p>
          {devCode && (
            <p className="rounded-lg border border-line px-3.5 py-2.5 font-mono text-sm text-muted">개발 모드 인증번호: {devCode}</p>
          )}
          <div>
            <label htmlFor="otp" className="text-sm font-medium">
              인증번호
            </label>
            <input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} font-mono tracking-[0.3em]`} required />
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button className={primary} disabled={busy || code.length !== 6}>
            확인
          </button>
          <button type="button" className={secondary} onClick={() => setStep("phone")}>
            번호 다시 입력
          </button>
        </form>
      )}

      {step === "claim" && (
        <form onSubmit={claim} className="mt-8 space-y-6">
          <h1 className="text-2xl font-bold leading-snug">등록 코드를 입력해 주세요</h1>
          <p className="text-sm leading-relaxed text-muted">태그 카드 뒷면(안쪽)에 있는 8자리 코드예요. 한 번 등록하면 다른 계정에서는 쓸 수 없어요.</p>
          <div>
            <label htmlFor="claim" className="text-sm font-medium">
              등록 코드
            </label>
            <input id="claim" autoCapitalize="characters" autoComplete="off" value={claimCode} onChange={(e) => setClaimCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" className={`${field} font-mono tracking-[0.2em]`} required />
          </div>
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button className={primary} disabled={busy}>
            등록하기
          </button>
          {loggedIn && (
            <Link href="/my" className="block text-center text-sm text-muted underline underline-offset-4">
              내 태그로 가기
            </Link>
          )}
        </form>
      )}

      {step === "label" && (
        <form onSubmit={saveLabels} className="mt-8 space-y-6">
          <h1 className="text-2xl font-bold leading-snug">어디에 붙였는지 이름을 붙여 주세요</h1>
          <p className="text-sm text-muted">알림에 이 이름이 나와서 어떤 물건인지 바로 알 수 있어요. 주운 사람에게는 보이지 않아요.</p>
          {stickers.map((s, i) => (
            <div key={s.token}>
              <label htmlFor={`label-${s.token}`} className="text-sm font-medium">
                태그 {i + 1} <span className="font-mono text-xs text-muted">{s.token}</span>
              </label>
              <input
                id={`label-${s.token}`}
                maxLength={20}
                value={labels[s.token] ?? ""}
                onChange={(e) => setLabels((prev) => ({ ...prev, [s.token]: e.target.value }))}
                placeholder="예: 네이비 캐디백"
                className={field}
              />
            </div>
          ))}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <button className={primary} disabled={busy}>
            저장
          </button>
        </form>
      )}

      {step === "done" && (
        <section className="mt-8 space-y-6">
          <h1 className="text-2xl font-bold leading-snug">등록을 마쳤어요</h1>
          <p className="text-sm leading-relaxed text-muted">
            이제 누군가 태그를 스캔하면 알림톡으로 알려 드려요. 카드는 태그 창에 끼워 주세요.
          </p>
          <button className={primary} onClick={testNotify} disabled={busy}>
            테스트 알림 받아 보기
          </button>
          {notice && <p aria-live="polite" className="text-sm text-muted">{notice}</p>}
          {error && <p role="alert" className="text-sm text-error">{error}</p>}
          <Link href="/my" className={`${secondary} block text-center`}>
            내 태그 관리
          </Link>
        </section>
      )}
    </main>
  );
}
