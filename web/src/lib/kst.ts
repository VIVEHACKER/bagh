const KST_OFFSET_MS = 9 * 60 * 60_000;

/**
 * 서버 렌더링과 브라우저에서 똑같이 나오는 한국 시간 표기: "9월 24일 15:07".
 * toLocaleString은 Node와 브라우저의 ICU 데이터가 달라 하이드레이션 불일치를 만들 수 있다.
 */
export function formatKst(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms + KST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${hh}:${mm}`;
}

/** "2026-09" 같은 한국 시간 기준 달을 [시작, 다음 달 시작) UTC 시각 범위로 바꾼다. */
export function kstMonthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`월 형식은 YYYY-MM이어야 한다: ${month}`);
  const year = Number(m[1]);
  const index = Number(m[2]) - 1;
  return {
    from: new Date(Date.UTC(year, index, 1) - KST_OFFSET_MS),
    to: new Date(Date.UTC(year, index + 1, 1) - KST_OFFSET_MS),
  };
}
