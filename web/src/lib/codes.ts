import { randomInt } from "node:crypto";

// 0·1·I·O는 뺀다. 습득자와 주인이 코드를 손으로 입력할 때 헷갈리지 않게 한다.
// design/golf-tag/build_tag.py의 ALPHABET과 같아야 한다.
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TOKEN_LENGTH = 10;
export const CLAIM_CODE_LENGTH = 8;

const VALID = new RegExp(`^[${CODE_ALPHABET}]+$`);

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** 사람이 입력한 코드를 저장 형식으로 바꾼다: " gsxp-pqqp-m6 " → "GSXPPQQPM6". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function isValidCode(code: string, length: number): boolean {
  return code.length === length && VALID.test(code);
}

/** 4자씩 끊어 보여 준다: GSXPPQQPM6 → GSXP-PQQP-M6. */
export function groupCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}
