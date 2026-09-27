import pino from "pino";

// 로그에는 전화번호, 메시지 본문, 토큰·코드 원문을 남기지 않는다(docs/02 §4-5).
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "baghome-web" },
  redact: {
    // link: 서명 답장 링크는 15분짜리 접근 권한이다. 운영 로그에 남기지 않는다.
    paths: ["phone", "*.phone", "to", "*.to", "body", "*.body", "text", "*.text", "code", "*.code", "token", "*.token", "claimCode", "link", "*.link"],
    censor: "[redacted]",
  },
});

export type Logger = typeof log;

/** 외부 업체 오류 문구에 섞인 전화번호 같은 긴 숫자열(8자리 이상, 하이픈 포함)을 가린다. */
export function maskDigits(message: string): string {
  return message.replace(/\d[\d-]{6,}\d/g, "***");
}
