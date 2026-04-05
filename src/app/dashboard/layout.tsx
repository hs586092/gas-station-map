import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
  description:
    "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
  openGraph: {
    title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
    description:
      "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
    siteName: "SLP Analytics",
  },
  twitter: {
    card: "summary_large_image",
    title: "감이 아닌 데이터로, 가격을 결정합니다 | SLP Analytics",
    description:
      "AI 적정가 분석, 경쟁사 모니터링, 판매량 탄력성 — 운영의 모든 판단 근거",
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
