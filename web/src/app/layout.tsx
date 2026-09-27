import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_KR } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const notoKr = Noto_Sans_KR({ variable: "--font-noto-kr", weight: ["400", "500", "700"], display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "백홈 BAGHOME", template: "%s · 백홈" },
  description: "주우면 연락되는 QR 네임태그. 주인의 전화번호는 공개되지 않아요.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b1326",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // proxy.ts가 요청마다 CSP nonce를 만든다. nonce가 스크립트에 붙으려면 모든 페이지가 요청 시점에 렌더링돼야 한다.
  await connection();
  return (
    <html lang="ko" className={`${inter.variable} ${notoKr.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
