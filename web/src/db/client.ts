import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { schema } from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface OpenDbOptions {
  /** 운영 Postgres. 없으면 PGlite(내장 Postgres)를 쓴다. */
  databaseUrl?: string;
  /** PGlite 저장 폴더. 없으면 메모리(테스트용). */
  pgliteDir?: string;
  migrationsFolder: string;
}

export interface OpenedDb {
  db: Db;
  close: () => Promise<void>;
}

export async function openDb(opts: OpenDbOptions): Promise<OpenedDb> {
  if (opts.databaseUrl) {
    const pool = new Pool({
      connectionString: opts.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 5_000,
      // 느린 쿼리·잠금 대기·열린 채 멈춘 트랜잭션이 연결을 붙잡지 않게 한다.
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 10_000,
    });
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder: opts.migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end() };
  }
  // PGlite는 저장 폴더만 mkdir하고 상위 폴더는 만들지 않는다(recursive 없음). 처음 실행에서 실패하지 않게 먼저 만든다.
  if (opts.pgliteDir) mkdirSync(path.dirname(opts.pgliteDir), { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: opts.migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
