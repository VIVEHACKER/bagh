/** 국내 단문(SMS) 한도. 넘으면 장문(LMS) 요금(약 3배)이 붙는다. */
export const SMS_MAX_BYTES = 90;

/** 단문 요금 기준 바이트 수(EUC-KR): 한글 등 비ASCII는 2바이트, ASCII는 1바이트. */
export function smsBytes(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

// 이모지처럼 EUC-KR에 없는 글자는 통신사에서 깨지거나 장문으로 바뀌므로 라벨을 넣지 않는다.
const SMS_SAFE_LABEL = /^[\p{Script=Hangul}A-Za-z0-9 ._()-]+$/u;

/**
 * 알림톡이 실패했을 때 보내는 대체 문자. 습득자가 쓴 글은 넣지 않는다(docs/02 §4-5).
 * 라벨을 넣어도 단문(90바이트)에 들어가면 넣고, 아니면 뺀다.
 */
export function fallbackSmsText(label: string | null, url: string): string {
  // 라벨 끝 글자의 받침에 따라 조사가 바뀌므로 항상 "태그로"로 끝낸다.
  if (label && SMS_SAFE_LABEL.test(label)) {
    const withLabel = `[백홈] '${label}' 태그로 새 연락이 왔어요. 확인: ${url}`;
    if (smsBytes(withLabel) <= SMS_MAX_BYTES) return withLabel;
  }
  return `[백홈] 등록한 태그로 새 연락이 왔어요. 확인: ${url}`;
}
