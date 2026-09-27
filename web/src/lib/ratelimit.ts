export interface RateResult {
  ok: boolean;
  retryAfterSec: number;
}

export interface RateRule {
  key: string;
  limit: number;
  windowMs: number;
}

/**
 * 호출자 기준 속도 제한. 설계 제약: 차주(주인)의 응답률로 호출을 막는 로직은 두지 않는다(docs/01 §3 H·I).
 * 운영에서는 인스턴스가 여러 개이므로 Redis 구현으로 바꾼다.
 */
export interface RateLimiter {
  /** 모든 규칙을 먼저 검사하고, 전부 통과할 때만 기록한다. 막힌 요청이 다른 버킷을 소모하지 않는다. */
  hitAll(rules: RateRule[], nowMs?: number): Promise<RateResult>;
  hit(key: string, limit: number, windowMs: number, nowMs?: number): Promise<RateResult>;
}

const PRUNE_EVERY = 1000;
// 가장 긴 창(인증번호 IP당 하루 한도)보다 길게 둔다. 짧으면 정리할 때 하루 창이 일찍 풀린다.
const MAX_WINDOW_MS = 25 * 3_600_000;

/** 슬라이딩 윈도우. 단일 프로세스(개발·테스트)용. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  async hitAll(rules: RateRule[], nowMs = Date.now()): Promise<RateResult> {
    let retryAfterSec = 0;
    const windows = rules.map((rule) => {
      const recent = (this.hits.get(rule.key) ?? []).filter((t) => t > nowMs - rule.windowMs);
      if (recent.length >= rule.limit) {
        retryAfterSec = Math.max(retryAfterSec, Math.max(1, Math.ceil((recent[0] + rule.windowMs - nowMs) / 1000)));
      }
      return { key: rule.key, recent };
    });
    for (const w of windows) this.hits.set(w.key, w.recent);
    if (retryAfterSec > 0) return { ok: false, retryAfterSec };
    for (const w of windows) w.recent.push(nowMs);
    if ((this.calls += 1) % PRUNE_EVERY === 0) this.prune(nowMs);
    return { ok: true, retryAfterSec: 0 };
  }

  hit(key: string, limit: number, windowMs: number, nowMs = Date.now()): Promise<RateResult> {
    return this.hitAll([{ key, limit, windowMs }], nowMs);
  }

  /** 오래된 키를 지워 메모리가 계속 늘지 않게 한다. */
  private prune(nowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] < nowMs - MAX_WINDOW_MS) this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
