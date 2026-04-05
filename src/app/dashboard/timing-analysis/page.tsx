"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

// ─── 타입 ───
interface TimingData {
  oilEvents: Array<{
    date: string;
    direction: "up" | "down";
    brentChange: number;
    brentPrice: number;
    competitorReactions: Array<{
      name: string;
      reactionDate: string | null;
      daysToReact: number | null;
      priceChange: number | null;
    }>;
    myReaction: {
      reactionDate: string | null;
      daysToReact: number | null;
      priceChange: number | null;
    };
    salesImpact: { beforeAvg: number; afterAvg: number; changeRate: number } | null;
  }>;
  competitorSpeed: Array<{
    name: string;
    avgDaysToReact: number | null;
    reactionCount: number;
    rank: number;
  }>;
  timingImpact: {
    earlyResponse: { avgSalesChange: number; count: number };
    lateResponse: { avgSalesChange: number; count: number };
    optimalDays: number | null;
  } | null;
  currentSituation: {
    pendingReaction: boolean;
    message: string;
    urgency: "high" | "medium" | "low" | "none";
  };
  dataStatus: {
    totalEvents: number;
    minRequired: number;
    isReliable: boolean;
    dataRange: { from: string; to: string };
  };
}

function formatDate(d: string) {
  const [, m, day] = d.split("-");
  return `${+m}/${+day}`;
}

const urgencyColor = {
  high: "border-red-500 bg-red-50 text-red-800",
  medium: "border-amber-500 bg-amber-50 text-amber-800",
  low: "border-blue-500 bg-blue-50 text-blue-800",
  none: "border-emerald-500 bg-emerald-50 text-emerald-800",
};
const urgencyIcon = { high: "🚨", medium: "⚠️", low: "👀", none: "✅" };

const COMP_COLORS = ["#3B82F6", "#EF4444", "#F59E0B", "#8B5CF6"];

export default function TimingAnalysisPage() {
  const [data, setData] = useState<TimingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/timing-analysis`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-surface h-screen overflow-y-auto">
        <DetailHeader title="타이밍 분석" description="유가 변동 → 경쟁사 반응 → 최적 대응 시점 분석" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const { oilEvents, competitorSpeed, timingImpact, currentSituation, dataStatus } = data;

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="타이밍 분석" description="유가 변동 → 경쟁사 반응 → 최적 대응 시점 분석" />

      <main className="px-5 pb-10 space-y-5">

        {/* ── 1. 현재 상황 카드 ── */}
        <section className={`rounded-2xl p-5 border-2 ${urgencyColor[currentSituation.urgency]} shadow-sm`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[20px]">{urgencyIcon[currentSituation.urgency]}</span>
            <span className="text-[16px] font-bold">현재 상황</span>
          </div>
          <p className="text-[14px] font-semibold m-0 leading-relaxed">{currentSituation.message}</p>
          {timingImpact?.optimalDays && (
            <p className="text-[12px] opacity-70 m-0 mt-2">
              과거 패턴 기준 최적 대응: 경쟁사 반응 후 {timingImpact.optimalDays}일 이내
            </p>
          )}
        </section>

        {/* ── 2. 경쟁사 반응 속도 비교 ── */}
        <section className="bg-surface-raised rounded-xl border border-border p-4">
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">경쟁사 반응 속도</h2>
          {competitorSpeed.some((c) => c.avgDaysToReact != null) ? (
            <>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={competitorSpeed.filter((c) => c.avgDaysToReact != null)}
                    layout="vertical"
                    margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: "#9BA8B7" }}
                      label={{ value: "평균 반응일(일)", position: "bottom", offset: -2, style: { fontSize: 12, fill: "#9BA8B7" } }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#9CA3AF" }} width={100} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(value) => [`${value}일`, "평균 반응"]} />
                    <Bar dataKey="avgDaysToReact" radius={[0, 4, 4, 0]}>
                      {competitorSpeed.filter((c) => c.avgDaysToReact != null).map((_, i) => (
                        <rect key={i} fill={COMP_COLORS[i % COMP_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1 mt-3">
                {competitorSpeed.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px]">
                    <span className="text-text-primary font-medium">{c.rank}위 {c.name}</span>
                    <span className="text-text-secondary">
                      {c.avgDaysToReact != null ? `평균 ${c.avgDaysToReact}일 (${c.reactionCount}회)` : "반응 기록 없음"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="bg-slate-50 rounded-lg p-4 text-center text-[12px] text-text-tertiary">
              경쟁사 반응 데이터가 아직 없습니다. price_history가 쌓이면 자동으로 분석됩니다.
            </div>
          )}
        </section>

        {/* ── 3. 선제 vs 추종 판매량 비교 ── */}
        <section className="bg-surface-raised rounded-xl border border-border p-4">
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">선제 대응 vs 추종 대응</h2>
          {timingImpact ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                <p className="text-[13px] text-emerald-700 m-0 mb-1">경쟁사보다 먼저/같이</p>
                <p className={`text-[28px] font-bold m-0 ${timingImpact.earlyResponse.avgSalesChange < 0 ? "text-red-500" : "text-emerald-600"}`}>
                  {timingImpact.earlyResponse.avgSalesChange > 0 ? "+" : ""}{timingImpact.earlyResponse.avgSalesChange}%
                </p>
                <p className="text-[12px] text-emerald-600 m-0 mt-1">{timingImpact.earlyResponse.count}건</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-center">
                <p className="text-[13px] text-red-700 m-0 mb-1">경쟁사보다 늦게</p>
                <p className={`text-[28px] font-bold m-0 ${timingImpact.lateResponse.avgSalesChange < 0 ? "text-red-500" : "text-emerald-600"}`}>
                  {timingImpact.lateResponse.avgSalesChange > 0 ? "+" : ""}{timingImpact.lateResponse.avgSalesChange}%
                </p>
                <p className="text-[12px] text-red-600 m-0 mt-1">{timingImpact.lateResponse.count}건</p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 rounded-lg p-4 text-center text-[12px] text-text-tertiary">
              데이터 축적 중 ({dataStatus.totalEvents}개 이벤트 / 최소 2개 필요)
            </div>
          )}
          {timingImpact && (
            <div className="bg-slate-50 rounded-lg p-3 mt-3 text-[12px] text-text-secondary">
              {timingImpact.earlyResponse.avgSalesChange > timingImpact.lateResponse.avgSalesChange ? (
                <p className="m-0">💡 경쟁사보다 먼저 대응하면 판매량 손실이 {Math.abs(timingImpact.earlyResponse.avgSalesChange - timingImpact.lateResponse.avgSalesChange).toFixed(1)}%p 적습니다.
                  {timingImpact.optimalDays && ` 경쟁사 반응 후 ${timingImpact.optimalDays}일 이내 대응을 권장합니다.`}</p>
              ) : (
                <p className="m-0">💡 현재 데이터에서는 대응 시점에 따른 판매량 차이가 뚜렷하지 않습니다. 데이터가 더 쌓이면 패턴이 명확해질 수 있습니다.</p>
              )}
            </div>
          )}
        </section>

        {/* ── 4. 유가 이벤트 타임라인 ── */}
        <section className="bg-surface-raised rounded-xl border border-border p-4">
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">
            유가 이벤트 타임라인 ({oilEvents.length}건)
          </h2>
          {oilEvents.length === 0 ? (
            <div className="bg-slate-50 rounded-lg p-4 text-center text-[12px] text-text-tertiary">
              <p className="m-0">±$2 이상의 유가 변동 이벤트가 감지되지 않았습니다.</p>
              <p className="m-0 mt-1">데이터 기간: {dataStatus.dataRange.from ? formatDate(dataStatus.dataRange.from) : "—"} ~ {dataStatus.dataRange.to ? formatDate(dataStatus.dataRange.to) : "—"}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {oilEvents.map((ev, i) => (
                <div key={i} className="border border-border rounded-xl p-4">
                  {/* 이벤트 헤더 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${
                        ev.direction === "up" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                      }`}>
                        Brent {ev.brentChange > 0 ? "+" : ""}{ev.brentChange.toFixed(1)}$
                      </span>
                      <span className="text-[13px] font-bold text-text-primary">{formatDate(ev.date)}</span>
                    </div>
                    <span className="text-[13px] text-text-tertiary">${ev.brentPrice.toFixed(1)}</span>
                  </div>

                  {/* 반응 타임라인 */}
                  <div className="space-y-1.5">
                    {ev.competitorReactions.map((r, ri) => (
                      <div key={ri} className="flex items-center gap-2 text-[13px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COMP_COLORS[ri % COMP_COLORS.length] }} />
                        <span className="text-text-primary font-medium w-[90px] shrink-0 truncate">{r.name}</span>
                        {r.reactionDate ? (
                          <>
                            <span className="text-text-secondary">{r.daysToReact}일 후</span>
                            <span className="text-text-tertiary">({formatDate(r.reactionDate)})</span>
                            <span className={`font-semibold ${r.priceChange! > 0 ? "text-red-500" : "text-blue-500"}`}>
                              {r.priceChange! > 0 ? "+" : ""}{r.priceChange}원
                            </span>
                          </>
                        ) : (
                          <span className="text-text-tertiary">미반응</span>
                        )}
                      </div>
                    ))}
                    {/* 내 반응 */}
                    <div className="flex items-center gap-2 text-[13px] pt-1 border-t border-border mt-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-emerald-700 font-bold w-[90px] shrink-0">우리 주유소</span>
                      {ev.myReaction.reactionDate ? (
                        <>
                          <span className="text-text-secondary">{ev.myReaction.daysToReact}일 후</span>
                          <span className="text-text-tertiary">({formatDate(ev.myReaction.reactionDate)})</span>
                          <span className={`font-semibold ${ev.myReaction.priceChange! > 0 ? "text-red-500" : "text-blue-500"}`}>
                            {ev.myReaction.priceChange! > 0 ? "+" : ""}{ev.myReaction.priceChange}원
                          </span>
                        </>
                      ) : (
                        <span className="text-text-tertiary">미반응</span>
                      )}
                    </div>
                  </div>

                  {/* 판매량 영향 */}
                  {ev.salesImpact && (
                    <div className="mt-2 pt-2 border-t border-border text-[13px] flex items-center gap-3">
                      <span className="text-text-secondary">판매량:</span>
                      <span className="text-text-secondary">{ev.salesImpact.beforeAvg.toLocaleString()}L →</span>
                      <span className="text-text-secondary">{ev.salesImpact.afterAvg.toLocaleString()}L</span>
                      <span className={`font-bold ${ev.salesImpact.changeRate < 0 ? "text-red-500" : "text-emerald-600"}`}>
                        ({ev.salesImpact.changeRate > 0 ? "+" : ""}{ev.salesImpact.changeRate}%)
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 5. 데이터 안내 ── */}
        <div className="bg-slate-50 rounded-xl p-4 text-[13px] text-text-tertiary space-y-1">
          <p className="m-0 font-semibold text-text-secondary">데이터 현황</p>
          <p className="m-0">유가 이벤트: {dataStatus.totalEvents}건 (최소 {dataStatus.minRequired}건 필요, {dataStatus.isReliable ? "✅ 신뢰 가능" : "⏳ 축적 중"})</p>
          <p className="m-0">분석 기간: {dataStatus.dataRange.from ? formatDate(dataStatus.dataRange.from) : "—"} ~ {dataStatus.dataRange.to ? formatDate(dataStatus.dataRange.to) : "—"} (price_history 기준)</p>
          <p className="m-0">유가 이벤트 기준: Brent 주간 변동 ±$2 이상</p>
          <p className="m-0">경쟁사 반응: 유가 이벤트 후 14일 내 ±5원 이상 가격 변경</p>
        </div>
      </main>
    </div>
  );
}
