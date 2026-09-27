// @AX:NOTE: 한국 표준시(UTC+9, 서머타임 없음) 고정. 해외 사용자 시간대는 아직 지원하지 않는다.
const KST_OFFSET_MIN = 9 * 60;
const DAY_MIN = 24 * 60;

function kstMinuteOfDay(now: Date): number {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + KST_OFFSET_MIN) % DAY_MIN;
}

/**
 * 방해금지 시간인지 판단한다. start·end는 KST 기준 0~1439분이고, 밤을 넘는 구간(23:00~07:00)도 된다.
 * 둘 중 하나라도 없거나 같으면 방해금지가 꺼진 것으로 본다.
 * 설계 제약: 방해금지는 알림을 "미룰" 뿐 다른 연락처로 돌리지 않는다(docs/01 §8).
 */
export function isQuietNow(now: Date, startMin: number | null, endMin: number | null): boolean {
  if (startMin == null || endMin == null || startMin === endMin) return false;
  const m = kstMinuteOfDay(now);
  return startMin < endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin;
}

/** 방해금지가 끝나는 시각. 방해금지 중이 아니면 now를 그대로 돌려준다. */
export function quietEndsAt(now: Date, startMin: number | null, endMin: number | null): Date {
  if (!isQuietNow(now, startMin, endMin) || endMin == null) return now;
  const m = kstMinuteOfDay(now);
  const wait = (endMin - m + DAY_MIN) % DAY_MIN;
  const end = new Date(now.getTime() + wait * 60_000);
  end.setUTCSeconds(0, 0);
  return end;
}

export function parseHhMm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function formatHhMm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
