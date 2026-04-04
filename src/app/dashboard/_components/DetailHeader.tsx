"use client";

import Link from "next/link";

interface DetailHeaderProps {
  title: string;
  description?: string;
}

export default function DetailHeader({ title, description }: DetailHeaderProps) {
  return (
    <>
      {/* 네비게이션 헤더 */}
      <header className="bg-navy text-white h-14 flex items-center px-5 sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C073" strokeWidth="2.5">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
          </svg>
          <span className="font-bold text-sm hidden sm:inline">주유소맵</span>
        </Link>
        <div className="flex items-center gap-4 ml-6 text-[13px]">
          <Link href="/dashboard" className="text-white font-semibold no-underline">대시보드</Link>
          <Link href="/" className="text-white/60 no-underline hover:text-white/90">지도</Link>
          <Link href="/community" className="text-white/60 no-underline hover:text-white/90">커뮤니티</Link>
        </div>
      </header>

      {/* 뒤로가기 + 페이지 타이틀 */}
      <div className="px-5 pt-4 pb-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-[13px] text-text-secondary no-underline hover:text-text-primary transition-colors mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          대시보드로 돌아가기
        </Link>
        <h1 className="text-[20px] font-bold text-text-primary m-0">{title}</h1>
        {description && (
          <p className="text-[13px] text-text-secondary m-0 mt-1">{description}</p>
        )}
      </div>
    </>
  );
}
