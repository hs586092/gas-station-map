import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "대시보드 — 주유소맵",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
