import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { schema } from "@/db/schema";

// 스키마의 외래키·인덱스 규칙을 고정한다. 마이그레이션(drizzle/)과 어긋나면 운영에서 500이 난다(연락처 삭제 사례).
function foreignKeys(table: PgTable) {
  const { name, foreignKeys: fks } = getTableConfig(table);
  return fks.map((fk) => {
    const ref = fk.reference();
    return {
      from: `${name}.${ref.columns.map((c) => c.name).join(",")}`,
      to: `${getTableConfig(ref.foreignTable).name}.${ref.foreignColumns.map((c) => c.name).join(",")}`,
      onDelete: fk.onDelete ?? "no action",
    };
  });
}

describe("DB 스키마 규칙", () => {
  const all = Object.values(schema).flatMap((t) => foreignKeys(t as PgTable));

  it("알림 기록은 연락처·메시지가 지워지면 함께 지운다", () => {
    expect(all).toContainEqual({ from: "notifications.contact_id", to: "contacts.id", onDelete: "cascade" });
    expect(all).toContainEqual({ from: "notifications.message_id", to: "messages.id", onDelete: "cascade" });
    expect(all).toContainEqual({ from: "messages.thread_id", to: "threads.id", onDelete: "cascade" });
    expect(all).toContainEqual({ from: "short_links.thread_id", to: "threads.id", onDelete: "cascade" });
  });

  it("주인 계정·스티커 소유 관계는 연쇄 삭제하지 않는다(실수로 계정 데이터가 사라지지 않게)", () => {
    for (const from of ["contacts.owner_id", "sessions.owner_id", "sticker_sets.owner_id", "otp_challenges.owner_id", "stickers.set_id", "threads.token"]) {
      expect(all.find((fk) => fk.from === from)?.onDelete).toBe("no action");
    }
    expect(all.find((fk) => fk.from === "sticker_sets.batch_id")?.to).toBe("batches.id");
  });

  it("같은 번호로 로그인 계정이 두 개 생기지 않게 부분 고유 인덱스를 둔다", () => {
    const { indexes } = getTableConfig(schema.contacts);
    const login = indexes.find((i) => i.config.name === "contacts_login_phone_uq");
    expect(login?.config.unique).toBe(true);
    expect(login?.config.where).toBeDefined();
  });
});
