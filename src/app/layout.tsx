import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
  description:
    "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
  keywords: [
    "SLP Analytics",
    "주유소 경영",
    "주유소 데이터",
    "AI 적정가",
    "경쟁사 모니터링",
    "판매량 탄력성",
    "유가 분석",
    "휘발유 가격",
    "경유 가격",
  ],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
    description:
      "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
    type: "website",
    locale: "ko_KR",
    siteName: "SLP Analytics",
  },
  twitter: {
    card: "summary_large_image",
    title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
    description:
      "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
