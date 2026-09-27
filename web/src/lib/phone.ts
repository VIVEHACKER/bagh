/**
 * 한국 휴대폰 번호를 E.164(+8210…)로 정규화한다. 휴대폰이 아니면 null.
 * 받는 형식: 010-1234-5678, 01012345678, +82 10 1234 5678, 821012345678
 */
export function normalizeKrMobile(input: string): string | null {
  const digits = input.replace(/[^0-9+]/g, "");
  let national: string;
  if (digits.startsWith("+82")) national = `0${digits.slice(3)}`;
  else if (digits.startsWith("82") && digits.length >= 11) national = `0${digits.slice(2)}`;
  else national = digits;
  national = national.replace(/^00/, "0");
  if (!/^01[016789]\d{7,8}$/.test(national)) return null;
  return `+82${national.slice(1)}`;
}

/** 화면 표시용 가림: +821012345678 → 010-****-5678 */
export function maskPhone(e164: string): string {
  const national = `0${e164.replace(/^\+82/, "")}`;
  return `${national.slice(0, 3)}-****-${national.slice(-4)}`;
}
