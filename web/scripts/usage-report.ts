/**
 * 월별 발송 건수와 예상 비용(알림 한도 조정용).
 *
 *   npx tsx scripts/usage-report.ts                     # 이번 달(한국 시간)
 *   npx tsx scripts/usage-report.ts --month 2026-09 --alimtalk 6.5 --sms 8.4
 *
 * 단가는 원/건(VAT 별도). 기본값은 조사한 단가 중 높은 쪽(알림톡 13원, 문자 18원)이다.
 * 내장 DB(PGlite)는 한 프로세스만 열 수 있으므로 개발 서버를 끈 뒤 실행한다.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../src/db/client";
import { kstMonthRange } from "../src/lib/kst";
import { DEFAULT_PRICES, usageReport } from "../src/server/services/usage";

function currentKstMonth(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function price(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name}는 0 이상의 숫자여야 한다: ${value}`);
  return n;
}

async function main() {
  const { values } = parseArgs({
    options: {
      month: { type: "string" },
      alimtalk: { type: "string" },
      sms: { type: "string" },
    },
  });
  try {
    process.loadEnvFile?.(path.resolve(process.cwd(), ".env.local"));
  } catch (err) {
    // .env.local이 없으면 셸 환경변수만 쓴다. 권한 오류 같은 다른 문제는 그대로 알린다.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const month = values.month ?? currentKstMonth();
  const range = kstMonthRange(month);
  const prices = { alimtalk: price(values.alimtalk, DEFAULT_PRICES.alimtalk, "alimtalk"), sms: price(values.sms, DEFAULT_PRICES.sms, "sms") };

  const { db, close } = await openDb({
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDir: process.env.DATABASE_URL ? undefined : path.join(process.cwd(), ".data", "pglite"),
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  try {
    const report = await usageReport(db, range, prices);
    console.log(JSON.stringify({ event: "usage.report", month, ...report }, null, 2));
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ event: "usage.failed", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
