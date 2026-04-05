import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "대시보드 — SLP Energy Analytics",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
