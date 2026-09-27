/**
 * 페이지 응답의 Content-Security-Policy. 요청마다 새 nonce로 만든다.
 * 개발 모드의 'unsafe-eval'은 React 디버깅(서버 오류 스택 복원)에만 필요하다(Next.js CSP 가이드).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next.js 개발 도구(next-devtools)는 nonce 없이 <style>을 넣는다. 개발에서만 인라인 스타일을 허용한다.
    // 운영은 nonce 전용이라 인라인 style 속성이 막힌다(tests/lib.test.ts가 소스에서 style={…} 사용을 막는다).
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // 로컬 http 개발 서버에서는 켜지 않는다.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
