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
  title: "SLP Energy Analytics — 주유소 경영 데이터 플랫폼",
  description:
    "유가 · 경쟁사 · 판매량 · 날씨를 하나로 묶은 주유소 경영 데이터 플랫폼. 사장님의 가격 결정을 데이터로 뒷받침합니다.",
  keywords: [
    "SLP Energy Analytics",
    "주유소 경영",
    "주유소 데이터",
    "유가 분석",
    "경쟁사 가격",
    "주유소 판매량",
    "주유소 벤치마크",
    "휘발유 가격",
    "경유 가격",
  ],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "SLP Energy Analytics — 주유소 경영 데이터 플랫폼",
    description:
      "유가 · 경쟁사 · 판매량 · 날씨를 하나로 묶은 주유소 경영 데이터 플랫폼. 사장님의 가격 결정을 데이터로 뒷받침합니다.",
    type: "website",
    locale: "ko_KR",
    siteName: "SLP Energy Analytics",
  },
  twitter: {
    card: "summary_large_image",
    title: "SLP Energy Analytics — 주유소 경영 데이터 플랫폼",
    description:
      "유가 · 경쟁사 · 판매량 · 날씨를 하나로 묶은 주유소 경영 데이터 플랫폼.",
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
