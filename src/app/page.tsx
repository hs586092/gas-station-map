"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import SiteHeader from "@/app/components/SiteHeader";

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // 로그인한 사용자는 대시보드로 리다이렉트
  useEffect(() => {
    if (!loading && user) {
      router.replace("/dashboard");
    }
  }, [loading, user, router]);

  return (
    <div className="h-screen overflow-y-auto bg-white text-text-primary">
      <SiteHeader
        rightSlot={
          <Link
            href="/dashboard"
            className="px-4 py-1.5 text-[13px] font-bold bg-oil-yellow hover:bg-oil-yellow-soft text-navy rounded-md no-underline transition-colors border border-oil-yellow-border shadow-sm"
          >
            무료 시작
          </Link>
        }
      />

      {/* ── 히어로 ── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-navy via-navy to-[#0a1526] text-white">
        <div className="absolute inset-0 opacity-10 pointer-events-none"
             style={{
               backgroundImage:
                 "radial-gradient(circle at 20% 30%, #00C073 0, transparent 40%), radial-gradient(circle at 80% 70%, #3b82f6 0, transparent 40%)",
             }} />
        <div className="relative max-w-6xl mx-auto px-5 md:px-10 py-20 md:py-28 text-center">
          <div className="inline-block px-3 py-1 mb-6 text-[12px] font-semibold text-emerald bg-emerald/15 border border-emerald/30 rounded-full">
            주유소 경영 데이터 플랫폼
          </div>
          <h1 className="text-[32px] md:text-[52px] font-extrabold leading-[1.15] mb-6 tracking-tight">
            감이 아닌 데이터로,<br className="md:hidden" /> 가격을 결정합니다.
          </h1>
          {/* SLP Analytics — 브랜드 로고마크 */}
          <div className="inline-flex items-center gap-2.5 mb-7">
            <span className="w-2 h-2 rounded-full bg-oil-yellow shadow-[0_0_10px_rgba(255,210,0,0.7)]" />
            <span className="text-[18px] md:text-[22px] font-extrabold tracking-tight text-white">SLP</span>
            <span className="text-[12px] md:text-[14px] font-semibold text-oil-yellow tracking-[0.22em] uppercase">
              Analytics
            </span>
          </div>
          <p className="text-[16px] md:text-[19px] text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">
            경쟁사 실시간 모니터링부터 AI 적정가 분석, 국제유가 반영 타이밍까지 —<br className="hidden md:inline" />
            매일 아침, 오늘의 가격 판단 근거를 브리핑으로 받아보세요.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-3.5 text-[15px] font-bold bg-emerald hover:bg-emerald/90 text-white rounded-xl no-underline transition-all shadow-lg shadow-emerald/20 hover:shadow-emerald/30"
            >
              대시보드 체험하기 →
            </Link>
            <Link
              href="/map"
              className="w-full sm:w-auto px-8 py-3.5 text-[15px] font-bold bg-white/10 hover:bg-white/15 text-white border border-white/20 rounded-xl no-underline transition-colors"
            >
              경쟁사 지도 보기
            </Link>
          </div>
          <p className="text-[12px] text-gray-400 mt-6">무료 체험 · 별도 설치 없음 · 하남·광주 지역 기준</p>
        </div>
      </section>

      {/* ── 핵심 기능 카드 ── */}
      <section className="max-w-6xl mx-auto px-5 md:px-10 py-20 md:py-24">
        <div className="text-center mb-14">
          <div className="text-[13px] font-bold text-emerald mb-2 tracking-wide">CORE FEATURES</div>
          <h2 className="text-[28px] md:text-[36px] font-extrabold text-text-primary mb-3">
            주유소 경영의 모든 판단 근거
          </h2>
          <p className="text-[15px] text-text-secondary">
            가격 결정에 필요한 데이터를 자동으로 수집하고 분석합니다.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            {
              icon: "🎯",
              title: "경쟁사 실시간 모니터링",
              desc: "반경 5km 내 주유소 가격을 매일 자동 수집. 인상·인하 즉시 감지.",
              bullets: ["일일 가격 변동 알림", "브랜드별·거리별 비교", "순위 변동 인사이트"],
            },
            {
              icon: "🤖",
              title: "AI 경영 브리핑",
              desc: "Claude 기반 일일 가격 전략 리포트. 인상/인하/유지 근거를 자동 작성.",
              bullets: ["오늘의 핵심 추천", "경쟁사 패턴 분석", "150자 요약 리포트"],
            },
            {
              icon: "🛢️",
              title: "국제유가 반영 타이밍",
              desc: "두바이유·WTI 변동 대비 내 가격 반영 상태를 한눈에.",
              bullets: ["2주 전 유가 대비", "반영 지연 경고", "최적 조정 시점"],
            },
            {
              icon: "📊",
              title: "판매량 × 가격 탄력성",
              desc: "내 주유소의 실제 판매 데이터로 가격 변경의 효과를 측정.",
              bullets: ["가격 변경 이벤트 추적", "탄력성 지수 산출", "주중/주말 분석"],
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-2xl p-7 border border-border shadow-sm hover:shadow-md hover:border-emerald/40 transition-all"
            >
              <div className="text-[36px] mb-3">{f.icon}</div>
              <h3 className="text-[19px] font-bold text-text-primary mb-2">{f.title}</h3>
              <p className="text-[14px] text-text-secondary leading-relaxed mb-4">{f.desc}</p>
              <ul className="space-y-1.5">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00C073" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 대시보드 미리보기 ── */}
      <section className="bg-gradient-to-b from-surface to-white py-20 md:py-24">
        <div className="max-w-6xl mx-auto px-5 md:px-10">
          <div className="text-center mb-12">
            <div className="text-[13px] font-bold text-emerald mb-2 tracking-wide">DASHBOARD</div>
            <h2 className="text-[28px] md:text-[36px] font-extrabold text-text-primary mb-3">
              이런 인사이트를 매일 받습니다
            </h2>
            <p className="text-[15px] text-text-secondary">
              12개 이상의 카드로 구성된 경영 대시보드. 한 화면에 오늘의 모든 판단 근거가 모입니다.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "내 가격 · 포지션", sub: "반경 내 순위·가격 차이", color: "emerald" },
              { title: "경쟁사 가격 변동", sub: "오늘 인상·인하 현황", color: "blue" },
              { title: "적정가 벤치마크", sub: "동일 브랜드·지역 평균", color: "amber" },
              { title: "국제유가 반영", sub: "두바이유 2주 대비 상태", color: "red" },
              { title: "AI 경영 브리핑", sub: "오늘의 가격 전략 리포트", color: "violet" },
              { title: "판매량 × 탄력성", sub: "가격 변경 효과 측정", color: "teal" },
            ].map((card, i) => (
              <div
                key={i}
                className="bg-white rounded-xl p-5 border border-border shadow-sm"
              >
                <div className="text-[13px] font-semibold text-text-secondary mb-2">{card.title}</div>
                <div className="flex items-end gap-2 mb-1">
                  <div className="text-[24px] font-extrabold text-text-primary">—</div>
                </div>
                <div className="text-[12px] text-text-tertiary">{card.sub}</div>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link
              href="/dashboard"
              className="inline-block px-8 py-3.5 text-[15px] font-bold bg-navy hover:bg-navy/90 text-white rounded-xl no-underline transition-colors"
            >
              실제 대시보드 둘러보기 →
            </Link>
          </div>
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="bg-navy text-white py-20">
        <div className="max-w-4xl mx-auto px-5 md:px-10 text-center">
          <h2 className="text-[28px] md:text-[36px] font-extrabold mb-4">
            오늘부터 데이터로 결정하세요
          </h2>
          <p className="text-[15px] md:text-[17px] text-gray-300 mb-8">
            설치 없이 바로 시작할 수 있습니다. 무료 체험 후 결정하세요.
          </p>
          <Link
            href="/dashboard"
            className="inline-block px-10 py-4 text-[16px] font-bold bg-emerald hover:bg-emerald/90 text-white rounded-xl no-underline transition-all shadow-lg shadow-emerald/20"
          >
            무료로 시작하기
          </Link>
          <div className="mt-10 pt-8 border-t border-white/10 text-[13px] text-gray-400">
            문의 · 피드백은 대시보드 내 커뮤니티 게시판 또는 관리자에게 연락주세요.
          </div>
        </div>
      </section>

      {/* ── 푸터 ── */}
      <footer className="bg-[#0a1526] text-gray-500 py-8">
        <div className="max-w-6xl mx-auto px-5 md:px-10 flex flex-col md:flex-row items-center justify-between gap-3 text-[12px]">
          <div>© 2026 SLP Energy Analytics · 주유소 경영 데이터 플랫폼</div>
          <div className="flex items-center gap-4">
            <Link href="/map" className="hover:text-gray-300 no-underline">지도</Link>
            <Link href="/dashboard" className="hover:text-gray-300 no-underline">대시보드</Link>
            <Link href="/community" className="hover:text-gray-300 no-underline">커뮤니티</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
