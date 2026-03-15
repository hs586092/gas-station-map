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
  title: "주유소맵 - 유가와 도로 통행량으로 보는 똑똑한 주유소 찾기",
  description:
    "가격만 비교하는 건 옛날 방식. 도로 통행량과 유가를 함께 분석해서 가성비 최고의 주유소를 찾아드립니다. 주유소 사장님을 위한 입지 분석 도구.",
  keywords: [
    "주유소",
    "유가",
    "기름값",
    "최저가 주유소",
    "도로 통행량",
    "주유소 입지 분석",
    "휘발유 가격",
    "경유 가격",
  ],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "주유소맵 - 유가와 도로 통행량으로 보는 똑똑한 주유소 찾기",
    description:
      "가격만 비교하는 건 옛날 방식. 도로 통행량과 유가를 함께 분석해서 가성비 최고의 주유소를 찾아드립니다.",
    type: "website",
    locale: "ko_KR",
    siteName: "주유소맵",
  },
  twitter: {
    card: "summary_large_image",
    title: "주유소맵 - 유가와 도로 통행량으로 보는 똑똑한 주유소 찾기",
    description:
      "도로 통행량과 유가를 함께 분석해서 가성비 최고의 주유소를 찾아드립니다.",
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
