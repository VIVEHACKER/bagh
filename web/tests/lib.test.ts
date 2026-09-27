import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_CODE_LENGTH, CODE_ALPHABET, TOKEN_LENGTH, groupCode, isValidCode, normalizeCode, randomCode } from "@/lib/codes";
import { decrypt, deriveKey, encrypt, lookupHash, safeEqual, secretHash, signLink, verifyLink } from "@/lib/crypto";
import { maskPhone, normalizeKrMobile } from "@/lib/phone";
import { formatHhMm, isQuietNow, parseHhMm, quietEndsAt } from "@/lib/quiet-hours";
import { MemoryRateLimiter } from "@/lib/ratelimit";
import { maskDigits } from "@/lib/log";
import { buildCsp } from "@/lib/csp";
import { isUuid } from "@/lib/ids";
import { formatKst } from "@/lib/kst";
import { SMS_MAX_BYTES, fallbackSmsText, smsBytes } from "@/lib/sms";

describe("codes", () => {
  it("만든 코드는 혼동 문자(0·1·I·O)를 쓰지 않고 길이가 맞다", () => {
    for (let i = 0; i < 200; i += 1) {
      const t = randomCode(TOKEN_LENGTH);
      expect(isValidCode(t, TOKEN_LENGTH)).toBe(true);
      expect(t).not.toMatch(/[01IO]/);
    }
    expect(CODE_ALPHABET).toHaveLength(32);
  });

  it("사람이 입력한 코드를 정규화하고 4자씩 끊어 보여 준다", () => {
    expect(normalizeCode(" gsxp-pqqp-m6 ")).toBe("GSXPPQQPM6");
    expect(groupCode("GSXPPQQPM6")).toBe("GSXP-PQQP-M6");
    expect(isValidCode("GSXPPQQPM6", CLAIM_CODE_LENGTH)).toBe(false);
    expect(isValidCode("GSXP0QQP", CLAIM_CODE_LENGTH)).toBe(false);
  });
});

describe("crypto", () => {
  const secret = "unit-test-secret-0123456789-abcdefghijkl";
  const enc = deriveKey(secret, "phone-enc");
  const link = deriveKey(secret, "link-sign");

  it("용도가 다르면 키가 다르다", () => {
    expect(enc.equals(deriveKey(secret, "lookup-hmac"))).toBe(false);
  });

  it("암호화한 전화번호를 되돌릴 수 있고, 변조하면 실패한다", () => {
    const c = encrypt("+821012345678", enc);
    expect(decrypt(c, enc)).toBe("+821012345678");
    expect(c).not.toContain("1012345678");
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), enc)).toThrow();
    expect(() => decrypt("v0.x.y.z", enc)).toThrow(/unknown format/);
  });

  it("조회 해시는 결정적이고 비밀 해시는 입력마다 다르다", () => {
    expect(lookupHash("a", enc)).toBe(lookupHash("a", enc));
    expect(secretHash("a")).not.toBe(secretHash("b"));
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("서명 링크: 유효·만료·변조를 구분한다", () => {
    const sig = signLink("thread-1", 1000, link);
    expect(verifyLink("thread-1", 1000, sig, link, 999)).toBe("valid");
    expect(verifyLink("thread-1", 1000, sig, link, 1001)).toBe("expired");
    expect(verifyLink("thread-2", 1000, sig, link, 999)).toBe("invalid");
    expect(verifyLink("thread-1", 2000, sig, link, 999)).toBe("invalid");
    expect(verifyLink("thread-1", 1000, "short", link, 999)).toBe("invalid");
  });
});

describe("phone", () => {
  it.each([
    ["010-1234-5678", "+821012345678"],
    ["01012345678", "+821012345678"],
    ["+82 10 1234 5678", "+821012345678"],
    ["821012345678", "+821012345678"],
    ["011-123-4567", "+82111234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeKrMobile(input)).toBe(expected);
  });

  it.each(["02-123-4567", "1234", "010-12-34", ""])("휴대폰이 아니면 null: %s", (input) => {
    expect(normalizeKrMobile(input)).toBeNull();
  });

  it("가림 표시", () => {
    expect(maskPhone("+821012345678")).toBe("010-****-5678");
  });
});

describe("quiet hours (KST)", () => {
  const kst = (hh: number, mm = 0) => new Date(Date.UTC(2026, 8, 24, hh - 9, mm));

  it("같은 날 구간과 밤을 넘는 구간을 판단한다", () => {
    expect(isQuietNow(kst(13), 12 * 60, 14 * 60)).toBe(true);
    expect(isQuietNow(kst(14), 12 * 60, 14 * 60)).toBe(false);
    expect(isQuietNow(kst(23, 30), 23 * 60, 7 * 60)).toBe(true);
    expect(isQuietNow(kst(6, 59), 23 * 60, 7 * 60)).toBe(true);
    expect(isQuietNow(kst(7), 23 * 60, 7 * 60)).toBe(false);
    expect(isQuietNow(kst(13), null, 14 * 60)).toBe(false);
    expect(isQuietNow(kst(13), 600, 600)).toBe(false);
  });

  it("방해금지가 끝나는 시각을 돌려준다", () => {
    const end = quietEndsAt(kst(23, 30), 23 * 60, 7 * 60);
    expect(end.toISOString()).toBe(new Date(Date.UTC(2026, 8, 24, 22, 0)).toISOString());
    const now = kst(15);
    expect(quietEndsAt(now, 23 * 60, 7 * 60)).toBe(now);
  });

  it("HH:MM 변환", () => {
    expect(parseHhMm("07:30")).toBe(450);
    expect(parseHhMm("24:00")).toBeNull();
    expect(formatHhMm(450)).toBe("07:30");
  });
});

describe("rate limiter", () => {
  it("창 안에서 한도를 넘으면 막고, 창이 지나면 다시 허용한다", async () => {
    const rl = new MemoryRateLimiter();
    expect((await rl.hit("k", 2, 1000, 0)).ok).toBe(true);
    expect((await rl.hit("k", 2, 1000, 100)).ok).toBe(true);
    const blocked = await rl.hit("k", 2, 1000, 200);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect((await rl.hit("k", 2, 1000, 1101)).ok).toBe(true);
  });
});

describe("rate limiter: 여러 규칙 묶음", () => {
  it("하나라도 막히면 어느 버킷도 소모하지 않는다", async () => {
    const rl = new MemoryRateLimiter();
    const rules = [
      { key: "a", limit: 1, windowMs: 1000 },
      { key: "b", limit: 5, windowMs: 1000 },
    ];
    expect((await rl.hitAll(rules, 0)).ok).toBe(true);
    expect((await rl.hitAll(rules, 10)).ok).toBe(false);
    // b는 막힌 요청으로 줄지 않았다: 4번 더 통과한다.
    for (let i = 0; i < 4; i += 1) expect((await rl.hit("b", 5, 1000, 20 + i)).ok).toBe(true);
    expect((await rl.hit("b", 5, 1000, 30)).ok).toBe(false);
  });

  it("오래된 키는 주기적으로 지워 메모리가 계속 늘지 않는다", async () => {
    const rl = new MemoryRateLimiter();
    for (let i = 0; i < 999; i += 1) await rl.hit(`k${i}`, 10, 1000, 0);
    expect(rl.size).toBe(999);
    await rl.hit("fresh", 10, 1000, 26 * 3_600_000); // 1000번째 호출에서 정리한다
    expect(rl.size).toBe(1);
  });

  it("하루짜리 창(인증번호 하루 한도)은 정리 뒤에도 유지한다", async () => {
    const rl = new MemoryRateLimiter();
    const DAY = 24 * 3_600_000;
    for (let i = 0; i < 2; i += 1) expect((await rl.hit("otp:day", 2, DAY, i)).ok).toBe(true);
    for (let i = 0; i < 997; i += 1) await rl.hit(`noise${i}`, 10, 1000, 3 * 3_600_000);
    await rl.hit("noise-last", 10, 1000, 3 * 3_600_000); // 1000번째 호출에서 정리한다
    expect((await rl.hit("otp:day", 2, DAY, 3 * 3_600_000)).ok).toBe(false);
  });
});

describe("ids", () => {
  it("형식이 맞는 UUID만 참이다", () => {
    expect(isUuid("3f2c1a9e-8b7d-4c6e-9f10-0a1b2c3d4e5f")).toBe(true);
    expect(isUuid("3F2C1A9E-8B7D-4C6E-9F10-0A1B2C3D4E5F")).toBe(true);
    expect(isUuid("------------------------------------")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});

describe("CSP", () => {
  it("nonce를 스크립트·스타일에 넣고, 운영에서는 eval을 허용하지 않는다", () => {
    const prod = buildCsp("abc", false);
    expect(prod).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(prod).toContain("style-src 'self' 'nonce-abc'");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("upgrade-insecure-requests");
    expect(prod).not.toContain("unsafe-eval");
    const dev = buildCsp("abc", true);
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("style-src 'self' 'unsafe-inline'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("운영 CSP(nonce 전용 style-src)가 막는 인라인 style 속성을 쓰지 않는다", () => {
    const root = path.resolve(__dirname, "../src");
    const offenders = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => /\bstyle=\{/.test(readFileSync(path.join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("한국 시간 표기", () => {
  it("서버·브라우저에서 같은 모양으로 보여 준다", () => {
    expect(formatKst("2026-09-24T03:05:00Z")).toBe("9월 24일 12:05");
    expect(formatKst("2026-12-31T15:30:00Z")).toBe("1월 1일 00:30");
    expect(formatKst("nope")).toBe("");
  });
});

describe("문자 길이", () => {
  const url = "https://bghm.kr/m/ABCDEFGHJK";
  it("한글은 2바이트, 영문·숫자는 1바이트로 센다(국내 단문 기준)", () => {
    expect(smsBytes("가a1")).toBe(4);
    expect(SMS_MAX_BYTES).toBe(90);
  });

  it("라벨이 단문에 들어가면 넣고, 길거나 특수문자면 뺀다", () => {
    expect(fallbackSmsText("네이비 캐디백", url)).toBe(`[백홈] '네이비 캐디백' 태그로 새 연락이 왔어요. 확인: ${url}`);
    expect(fallbackSmsText(null, url)).toBe(`[백홈] 등록한 태그로 새 연락이 왔어요. 확인: ${url}`);
    expect(fallbackSmsText("아주아주긴이름의골프백과파우치세트용태그", url)).toContain("등록한 태그로");
    expect(fallbackSmsText("캐디백⛳", url)).toContain("등록한 태그로");
    for (const label of [null, "네이비 캐디백", "아주아주긴이름의골프백과파우치세트용태그"]) {
      expect(smsBytes(fallbackSmsText(label, url))).toBeLessThanOrEqual(SMS_MAX_BYTES);
    }
  });
});


describe("로그 가리기", () => {
  it("오류 문구 속 전화번호처럼 긴 숫자는 가린다", () => {
    expect(maskDigits("invalid recipient 010-1234-5678")).toBe("invalid recipient ***");
    expect(maskDigits("blocked 01012345678 now")).toBe("blocked *** now");
    expect(maskDigits("retry after 30 sec (code 4031)")).toBe("retry after 30 sec (code 4031)");
  });
});
