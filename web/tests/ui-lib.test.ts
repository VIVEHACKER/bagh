import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/db/client";
import { ApiError, api, errorText } from "@/lib/api-client";
import { FINDER_TEXT, LANGS, pickLang } from "@/lib/i18n";

describe("i18n", () => {
  it.each([
    ["ko-KR,ko;q=0.9,en;q=0.8", "ko"],
    ["en-US,en;q=0.9", "en"],
    ["ja,en;q=0.5", "ja"],
    ["zh-CN,zh;q=0.9", "zh"],
    ["fr-FR,de;q=0.8", "ko"],
    ["fr;q=0.9,en;q=0.8", "en"],
    ["", "ko"],
    [null, "ko"],
  ])("Accept-Language %s → %s", (header, expected) => {
    expect(pickLang(header)).toBe(expected);
  });

  it("4개 언어의 문구 키가 모두 같고 비어 있지 않다", () => {
    const keys = (o: object) => Object.keys(o).sort().join(",");
    for (const lang of LANGS) {
      const t = FINDER_TEXT[lang];
      expect(keys(t)).toBe(keys(FINDER_TEXT.ko));
      expect(keys(t.reasons)).toBe(keys(FINDER_TEXT.ko.reasons));
      expect(keys(t.replies)).toBe(keys(FINDER_TEXT.ko.replies));
      expect(keys(t.errors)).toBe(keys(FINDER_TEXT.ko.errors));
      expect(t.remaining(3)).toContain("3");
      expect(t.title.length).toBeGreaterThan(0);
    }
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("성공 응답은 JSON을, 204는 undefined를 돌려준다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api<{ ok: number }>("/x", { body: { a: 1 } })).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(await api("/y", { method: "DELETE" })).toBeUndefined();
  });

  it("실패 응답은 서버의 오류 코드·문구를 ApiError로 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "rate_limited", message: "잠시 뒤에" } }), { status: 429 })),
    );
    const err = await api("/z").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "rate_limited", status: 429 });
    expect(errorText(err)).toBe("잠시 뒤에");
    expect(errorText(new Error("boom"))).toBe("잠시 뒤에 다시 시도해 주세요.");
  });

  it("본문이 JSON이 아니어도 기본 오류로 바꾼다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(api("/z")).rejects.toMatchObject({ code: "internal", status: 500 });
  });
});

describe("db client", () => {
  it("파일 저장 PGlite는 상위 폴더가 없어도 열린다(회귀: PGlite가 상위 폴더를 만들지 않음)", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "baghome-db-"));
    try {
      const opened = await openDb({
        pgliteDir: path.join(base, "nested", "missing", "pglite"),
        migrationsFolder: path.resolve(import.meta.dirname, "../drizzle"),
      });
      await opened.close();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
