import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 위치·카메라·마이크를 쓰지 않는다(설계 제약: 위치 수집 금지, docs/01 §8).
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // 내장 Postgres(PGlite)와 로거는 번들링하지 않고 Node에서 그대로 불러온다.
  serverExternalPackages: ["@electric-sql/pglite", "pino"],
  poweredByHeader: false,
  // QR에는 영숫자 모드(작은 QR)를 위해 대문자 주소 /Q/<토큰>을 넣는다. 페이지는 /q/[token] 하나로 둔다
  // (macOS 등 대소문자 무시 파일시스템에서 Q·q 폴더를 따로 둘 수 없다).
  async rewrites() {
    return [{ source: "/Q/:token", destination: "/q/:token" }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
