"use client";

import { useState, useEffect } from "react";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

// ─── 타입 ───
interface Insights {
  recommendation: {
    message: string;
    type: "hold" | "raise" | "lower" | "watch";
    suggestedRange: { min: number; max: number } | null;
  };
  oilStory: string;
  oilWeekTrend: {
    trend: "rising" | "falling" | "flat";
    message: string;
    brentWeekChange: number;
  };
  competitorPattern: {
    action: "rising" | "falling" | "mixed" | "stable";
    message: string;
    risingCount: number;
    fallingCount: number;
    stableCount: number;
  };
  weeklyTrend: {
    action: "rising" | "falling" | "mixed" | "stable";
    message: string;
    risingCount: number;
    fallingCount: number;
    stableCount: number;
  };
  myPosition: "cheap" | "average" | "expensive";
  avgPrice: number | null;
  benchmarkInsight: string;
  rankChange: {
    gasoline: {
      today: { rank: number; total: number } | null;
      yesterday: { rank: number; total: number } | null;
      diff: number | null;
    };
  };
  briefingFactors: {
    oil: {
      latestBrent: number | null;
      latestWti: number | null;
      brent2wChange: number;
      oilDirection: "up" | "down" | "flat";
      reflectionStatus: string;
      myPriceChange: number | null;
    };
    position: {
      myPrice: number | null;
      avgPrice: number | null;
      priceDiff: number;
    };
  };
}

// ─── 찬반 분석 로직 ───
type Stance = "pro" | "con" | "neutral";

interface Factor {
  label: string;
  stance: Stance;
  summary: string;
}

function deriveFactors(d: Insights): Factor[] {
  const { briefingFactors: bf, competitorPattern: cp, weeklyTrend: wt, oilWeekTrend: owt } = d;
  const factors: Factor[] = [];

  // A. 유가 분석
  if (bf.oil.oilDirection === "up") {
    if (bf.oil.reflectionStatus === "reflected") {
      factors.push({ label: "유가", stance: "con", summary: `유가 상승분 이미 +${bf.oil.myPriceChange}원 반영 → 추가 인상 불필요` });
    } else {
      factors.push({ label: "유가", stance: "pro", summary: `유가 상승(Brent +$${Math.abs(bf.oil.brent2wChange).toFixed(1)}) 미반영 → 인상 검토` });
    }
  } else if (bf.oil.oilDirection === "down") {
    if (bf.oil.reflectionStatus === "reflected") {
      factors.push({ label: "유가", stance: "neutral", summary: `유가 하락분 이미 반영 완료` });
    } else {
      factors.push({ label: "유가", stance: "con", summary: `유가 하락(Brent -$${Math.abs(bf.oil.brent2wChange).toFixed(1)}) 미반영 → 인하 검토` });
    }
  } else {
    factors.push({ label: "유가", stance: "neutral", summary: "유가 보합 — 가격 변동 압력 없음" });
  }

  // B. 경쟁사 동향
  if (cp.action === "rising") {
    factors.push({ label: "경쟁사", stance: "pro", summary: `${cp.risingCount}곳 인상 → 시장 인상 추세` });
  } else if (cp.action === "falling") {
    factors.push({ label: "경쟁사", stance: "con", summary: `${cp.fallingCount}곳 인하 → 인하 압력` });
  } else if (cp.action === "mixed") {
    factors.push({ label: "경쟁사", stance: "neutral", summary: `인상 ${cp.risingCount}곳, 인하 ${cp.fallingCount}곳 — 혼조세` });
  } else {
    factors.push({ label: "경쟁사", stance: "neutral", summary: "경쟁사 변동 없음 — 관망 중" });
  }

  // C. 내 포지션
  const diff = bf.position.priceDiff;
  if (d.myPosition === "expensive") {
    factors.push({ label: "내 포지션", stance: "con", summary: `평균보다 +${Math.abs(diff)}원 비쌈 → 추가 인상은 경쟁력 약화` });
  } else if (d.myPosition === "cheap") {
    factors.push({ label: "내 포지션", stance: "pro", summary: `평균보다 ${Math.abs(diff)}원 저렴 → 인상 여지 있음` });
  } else {
    factors.push({ label: "내 포지션", stance: "neutral", summary: "평균 수준 유지 중" });
  }

  // D. 시장 추세 (7일)
  if (wt.action === "rising" || owt.trend === "rising") {
    factors.push({ label: "시장 추세", stance: "pro", summary: `이번 주 인상 ${wt.risingCount}곳 + 유가 상승 → 추가 인상 가능성` });
  } else if (wt.action === "falling" || owt.trend === "falling") {
    factors.push({ label: "시장 추세", stance: "con", summary: `이번 주 인하 ${wt.fallingCount}곳 + 유가 하락 → 인하 압력` });
  } else {
    factors.push({ label: "시장 추세", stance: "neutral", summary: "시장 큰 변화 없음 — 안정기" });
  }

  return factors;
}

// ─── 컴포넌트 ───
const recColor: Record<string, string> = {
  hold: "border-emerald-500 bg-emerald-50 text-emerald-800",
  raise: "border-coral bg-red-50 text-red-800",
  lower: "border-blue-500 bg-blue-50 text-blue-800",
  watch: "border-amber-500 bg-amber-50 text-amber-800",
};
const recIcon: Record<string, string> = {
  hold: "✅", raise: "📈", lower: "📉", watch: "👀",
};
const recLabel: Record<string, string> = {
  hold: "현 가격 유지", raise: "인상 검토", lower: "인하 검토", watch: "시장 주시",
};

const stanceIcon: Record<Stance, string> = {
  pro: "🔺", con: "🔻", neutral: "➖",
};
const stanceLabel: Record<Stance, string> = {
  pro: "인상 찬성", con: "인상 반대", neutral: "중립",
};
const stanceColor: Record<Stance, string> = {
  pro: "text-red-600", con: "text-blue-600", neutral: "text-gray-500",
};

export default function BriefingPage() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/dashboard-insights`)
      .then((r) => r.json())
      .then((data) => { setInsights(data); setLoading(false); });
  }, []);

  if (loading || !insights) {
    return (
      <div className="min-h-screen bg-surface h-screen overflow-y-auto">
        <DetailHeader title="경영 브리핑 상세" description="종합 추천의 판단 근거를 투명하게 공개합니다" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const factors = deriveFactors(insights);
  const proCount = factors.filter((f) => f.stance === "pro").length;
  const conCount = factors.filter((f) => f.stance === "con").length;
  const bf = insights.briefingFactors;
  const rec = insights.recommendation;

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="경영 브리핑 상세" description="종합 추천의 판단 근거를 투명하게 공개합니다" />

      <main className="px-5 pb-10 space-y-5">

        {/* ── 1. 오늘의 추천 ── */}
        <section className={`rounded-2xl p-5 border-2 ${recColor[rec.type]} shadow-sm`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[22px]">{recIcon[rec.type]}</span>
            <span className="text-[14px] font-bold">오늘의 추천: {recLabel[rec.type]}</span>
          </div>
          <p className="text-[15px] font-semibold m-0 leading-relaxed">{rec.message}</p>
          {insights.oilStory && (
            <p className="text-[12px] opacity-70 m-0 mt-2 leading-relaxed">{insights.oilStory}</p>
          )}
        </section>

        {/* ── 2. 판단 근거 4가지 ── */}
        <section>
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">판단 근거</h2>
          <div className="space-y-3">
            {factors.map((f, i) => (
              <FactorCard key={i} factor={f} index={i} insights={insights} />
            ))}
          </div>
        </section>

        {/* ── 3. 찬반 요약 테이블 ── */}
        <section>
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">찬반 요약</h2>
          <div className="rounded-xl border border-border overflow-hidden bg-white">
            {/* 헤더 */}
            <div className="grid grid-cols-3 text-[11px] font-semibold text-text-secondary bg-gray-50 border-b border-border">
              <div className="px-3 py-2">항목</div>
              <div className="px-3 py-2 text-red-600">🔺 인상 찬성</div>
              <div className="px-3 py-2 text-blue-600">🔻 인상 반대</div>
            </div>
            {/* 행 */}
            {factors.map((f, i) => (
              <div key={i} className={`grid grid-cols-3 text-[12px] ${i < factors.length - 1 ? "border-b border-border" : ""}`}>
                <div className="px-3 py-2.5 font-medium text-text-primary">{f.label}</div>
                <div className="px-3 py-2.5 text-red-600">
                  {f.stance === "pro" ? f.summary : ""}
                </div>
                <div className="px-3 py-2.5 text-blue-600">
                  {f.stance === "con" ? f.summary : ""}
                </div>
              </div>
            ))}
            {/* 종합 */}
            <div className="grid grid-cols-3 text-[12px] font-bold bg-gray-50 border-t border-border">
              <div className="px-3 py-2.5 text-text-primary">종합</div>
              <div className="px-3 py-2.5 text-red-600 col-span-2">
                찬성 {proCount} vs 반대 {conCount} → {recLabel[rec.type]}
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. 금액 범위 ── */}
        {rec.suggestedRange && (
          <section className="rounded-xl border border-border bg-white p-4">
            <h2 className="text-[14px] font-bold text-text-primary m-0 mb-2">
              {rec.type === "raise" ? "📈 인상" : rec.type === "lower" ? "📉 인하" : "💡"} 검토 금액
            </h2>
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-bold text-text-primary">
                {rec.suggestedRange.min}~{rec.suggestedRange.max}원
              </span>
              <span className="text-[12px] text-text-secondary">경쟁사 평균 기준</span>
            </div>
            {bf.position.avgPrice && (
              <p className="text-[12px] text-text-tertiary m-0 mt-1">
                현재 경쟁사 평균: {bf.position.avgPrice.toLocaleString()}원
                {bf.position.myPrice && ` / 내 가격: ${bf.position.myPrice.toLocaleString()}원`}
              </p>
            )}
          </section>
        )}

        {/* ── 5. 면책조항 ── */}
        <p className="text-[11px] text-text-tertiary m-0 leading-relaxed pb-6">
          * 본 분석은 국제유가·경쟁사 가격·시장 추세 데이터를 기반으로 자동 생성된 참고 정보입니다. 최종 가격 결정은 사장님의 판단에 따릅니다.
        </p>
      </main>
    </div>
  );
}

// ─── 판단 근거 카드 컴포넌트 ───
function FactorCard({ factor, index, insights }: { factor: Factor; index: number; insights: Insights }) {
  const bf = insights.briefingFactors;
  const labels = ["A", "B", "C", "D"];

  return (
    <div className="rounded-xl border border-border bg-white p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-bold text-text-secondary">
            {labels[index]}
          </span>
          <span className="text-[14px] font-bold text-text-primary">{factor.label}</span>
        </div>
        <span className={`text-[11px] font-semibold ${stanceColor[factor.stance]} flex items-center gap-1`}>
          {stanceIcon[factor.stance]} {stanceLabel[factor.stance]}
        </span>
      </div>

      {/* 상세 데이터 */}
      <div className="text-[12px] text-text-secondary space-y-1 mb-2">
        {index === 0 && (
          <>
            {bf.oil.latestBrent != null && (
              <p className="m-0">현재 Brent ${bf.oil.latestBrent.toFixed(2)} / WTI ${bf.oil.latestWti?.toFixed(2) ?? "—"}</p>
            )}
            <p className="m-0">2주 전 대비: {bf.oil.brent2wChange >= 0 ? "+" : ""}${bf.oil.brent2wChange.toFixed(2)}</p>
            <p className="m-0">
              소매가 반영:{" "}
              {bf.oil.reflectionStatus === "reflected"
                ? `✅ 반영 완료 (${bf.oil.myPriceChange != null ? `${bf.oil.myPriceChange >= 0 ? "+" : ""}${bf.oil.myPriceChange}원` : "—"})`
                : bf.oil.reflectionStatus === "not_reflected"
                  ? "❌ 미반영"
                  : "➖ 해당 없음"}
            </p>
          </>
        )}
        {index === 1 && (
          <>
            <p className="m-0">오늘: 인상 {insights.competitorPattern.risingCount}곳 / 인하 {insights.competitorPattern.fallingCount}곳 / 유지 {insights.competitorPattern.stableCount}곳</p>
            <p className="m-0">이번 주: 인상 {insights.weeklyTrend.risingCount}곳 / 인하 {insights.weeklyTrend.fallingCount}곳</p>
          </>
        )}
        {index === 2 && (
          <>
            {bf.position.avgPrice != null && bf.position.myPrice != null && (
              <p className="m-0">
                내 가격 {bf.position.myPrice.toLocaleString()}원 / 평균 {bf.position.avgPrice.toLocaleString()}원
                {" "}({bf.position.priceDiff >= 0 ? "+" : ""}{bf.position.priceDiff}원)
              </p>
            )}
            {insights.rankChange.gasoline.today && (
              <p className="m-0">
                순위: {insights.rankChange.gasoline.today.rank}위 / {insights.rankChange.gasoline.today.total}곳
                {insights.rankChange.gasoline.diff != null && insights.rankChange.gasoline.diff !== 0 && (
                  <span className={insights.rankChange.gasoline.diff < 0 ? " text-emerald-600" : " text-red-500"}>
                    {" "}({insights.rankChange.gasoline.diff < 0 ? "▲" : "▼"}{Math.abs(insights.rankChange.gasoline.diff)}단계 {insights.rankChange.gasoline.diff < 0 ? "상승" : "하락"})
                  </span>
                )}
              </p>
            )}
          </>
        )}
        {index === 3 && (
          <>
            <p className="m-0">{insights.oilWeekTrend.message}</p>
            <p className="m-0">{insights.weeklyTrend.message}</p>
          </>
        )}
      </div>

      {/* 판단 요약 */}
      <div className={`text-[12px] font-medium ${stanceColor[factor.stance]} bg-gray-50 rounded-lg px-3 py-2`}>
        → {factor.summary}
      </div>
    </div>
  );
}
