"use client";

import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";

interface DetailHeaderProps {
  title: string;
  description?: string;
}

export default function DetailHeader({ title, description }: DetailHeaderProps) {
  return (
    <>
      <SiteHeader />

      {/* 뒤로가기 + 페이지 타이틀 (다크 배경) */}
      <div className="px-5 pt-4 pb-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-[13px] text-white/60 no-underline hover:text-white transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          대시보드로 돌아가기
        </Link>
        <h1 className="text-[20px] font-bold text-white m-0">{title}</h1>
        {description && (
          <p className="text-[13px] text-white/60 m-0 mt-1">{description}</p>
        )}
      </div>
    </>
  );
}
