"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SiteHeaderProps {
  /** 오른쪽 영역에 렌더링할 요소 (로그인 버튼, CTA 등) */
  rightSlot?: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/map", label: "지도" },
  { href: "/community", label: "커뮤니티" },
];

export default function SiteHeader({ rightSlot }: SiteHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="bg-navy text-white h-14 flex items-center px-6 sticky top-0 z-50 border-b border-navy-light shrink-0">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <span className="w-2.5 h-2.5 rounded-full bg-oil-yellow shadow-[0_0_8px_rgba(255,210,0,0.5)]" />
        <span className="font-extrabold text-[15px] tracking-tight hidden sm:inline">SLP</span>
        <span className="text-[11px] font-semibold text-oil-yellow/90 tracking-[0.18em] hidden sm:inline">
          ENERGY ANALYTICS
        </span>
      </Link>
      <div className="h-4 w-px bg-white/15 mx-4" />
      <nav className="flex items-center gap-5 text-[13px]">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard" || pathname.startsWith("/dashboard/")
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`no-underline transition-colors ${
                isActive
                  ? "text-white font-semibold"
                  : "text-white/55 hover:text-white/90"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {rightSlot && <div className="ml-auto flex items-center">{rightSlot}</div>}
    </header>
  );
}
