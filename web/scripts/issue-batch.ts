/**
 * 인쇄용 태그 배치를 발급하고, 인쇄 생성기(design/golf-tag/build_tag.py)가 읽는 CSV를 만든다.
 *
 * 사용:
 *   npx tsx scripts/issue-batch.ts --sku golf-tag --sets 20 --per-set 1 --names names.csv --out ../design/golf-tag/batch.csv
 *
 * - names.csv(선택): name,club 헤더. 세트 순서대로 이름을 붙인다. 없으면 이름 칸을 비운다.
 * - 출력 CSV: name,club,token,claim_code (스티커 1장당 1줄. 같은 세트는 등록 코드가 같다)
 * - 개발용 내장 DB(PGlite)는 한 프로세스만 열 수 있다. 개발 서버를 끈 뒤 실행한다.
 * - 등록 코드 평문은 이 CSV에만 남는다. 인쇄가 끝나면 안전한 곳에 보관하거나 지운다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openDb } from "../src/db/client";
import { MemoryRateLimiter } from "../src/lib/ratelimit";
import { DEFAULT_CONFIG, buildKeys } from "../src/server/deps";
import { ConsoleNotifier } from "../src/server/notifier";
import { issueBatch } from "../src/server/services/batch";

function readNames(file: string | undefined): Array<{ name: string; club: string }> {
  if (!file) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const [header, ...rows] = lines;
  const cols = header.split(",").map((c) => c.trim());
  const nameIdx = cols.indexOf("name");
  const clubIdx = cols.indexOf("club");
  if (nameIdx < 0) throw new Error("names.csv에 name 열이 없다");
  return rows.map((r) => {
    const cells = r.split(",");
    return { name: cells[nameIdx]?.trim() ?? "", club: clubIdx >= 0 ? (cells[clubIdx]?.trim() ?? "") : "" };
  });
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sku: { type: "string", default: "golf-tag" },
      sets: { type: "string" },
      "per-set": { type: "string", default: "1" },
      names: { type: "string" },
      out: { type: "string" },
    },
  });
  try {
    process.loadEnvFile?.(path.resolve(process.cwd(), ".env.local"));
  } catch (err) {
    // .env.local이 없으면 셸 환경변수만 쓴다. 권한 오류 같은 다른 문제는 그대로 알린다.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error("APP_SECRET(32자 이상)이 필요하다. web/.env.local을 확인한다");

  const names = readNames(values.names);
  const setCount = Number(values.sets ?? names.length);
  if (!values.out) throw new Error("--out 경로가 필요하다");

  const { db, close } = await openDb({
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDir: process.env.DATABASE_URL ? undefined : path.join(process.cwd(), ".data", "pglite"),
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  try {
    const batch = await issueBatch(
      { db, notifier: new ConsoleNotifier(), limiter: new MemoryRateLimiter(), keys: buildKeys(secret), config: DEFAULT_CONFIG, now: () => new Date() },
      { sku: values.sku!, setCount, stickersPerSet: Number(values["per-set"]) },
    );
    const rows = ["name,club,token,claim_code"];
    batch.sets.forEach((set, i) => {
      const who = names[i] ?? { name: "", club: "" };
      for (const token of set.tokens) rows.push([who.name, who.club, token, set.claimCode].map(csvCell).join(","));
    });
    writeFileSync(values.out, `${rows.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ event: "batch.issued", batchId: batch.batchId, sets: batch.sets.length, out: values.out }));
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ event: "batch.failed", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
