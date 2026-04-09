"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface CarwashData {
  today: { expectedCount: number; expectedRevenue: number; dowLabel: string; weatherAdjustment: string | null };
  yesterday: { date: string; count: number; revenue: number; vsLastWeekPct: number | null } | null;
  typeRatio: Record<string, { count: number; pct: number }> | null;
  weatherInsight: string | null;
  dowStats: Array<{ dow: number; label: string; avgCount: number; avgRevenue: number; n: number }>;
  weatherStats: Array<{ key: string; label: string; avgCount: number; n: number }>;
  lagWeatherStats: Array<{ key: string; label: string; avgCount: number; n: number }>;
  trend: Array<{ date: string; count: number; revenue: number }>;
  typeBreakdownTrend: Array<{ date: string; basic: number; premium: number; taxi: number; free: number; total: number }>;
  scatterData: Array<{ date: string; fuelCount: number; carwashCount: number }>;
  dataRange: { from: string; to: string; totalDays: number };
}

export default function CarwashPage() {
  const [data, setData] = useState<CarwashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/carwash-summary`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="세차장 분석" description="세차 대수, 날씨 영향 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-48 bg-slate-100 rounded-xl" />
            <div className="h-48 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="세차장 분석" description="세차 대수, 날씨 영향 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="bg-surface-raised rounded-xl p-8 border border-border text-center text-text-secondary">
            세차 데이터를 불러올 수 없습니다.
          </div>
        </div>
      </div>
    );
  }

  const maxDowCount = Math.max(...data.dowStats.map(d => d.avgCount));

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader
        title="세차장 분석"
        description={`${data.dataRange.totalDays}일 데이터 (${data.dataRange.from} ~ ${data.dataRange.to})`}
      />

      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-6">
        {/* 요약 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 오늘 예상 */}
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[11px] text-text-tertiary font-medium mb-2">오늘 예상 ({data.today.dowLabel})</div>
            <div className="text-[28px] font-extrabold text-purple-500" style={{ fontVariantNumeric: "tabular-nums" }}>
              {data.today.expectedCount.toLocaleString()}<span className="text-[14px] text-text-tertiary ml-1">대</span>
            </div>
            {data.today.weatherAdjustment && (
              <div className="text-[12px] text-amber-500 mt-1">⚡ {data.today.weatherAdjustment}</div>
            )}
          </div>
          {/* 어제 실적 */}
          {data.yesterday && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="text-[11px] text-text-tertiary font-medium mb-2">어제 {data.yesterday.date.slice(5)}</div>
              <div className="text-[28px] font-extrabold text-text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>
                {data.yesterday.count.toLocaleString()}<span className="text-[14px] text-text-tertiary ml-1">대</span>
              </div>
              <div className="flex items-center gap-2">
                {data.yesterday.vsLastWeekPct != null && (
                  <span className={`text-[13px] font-bold ${data.yesterday.vsLastWeekPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    전주 대비 {data.yesterday.vsLastWeekPct >= 0 ? "+" : ""}{data.yesterday.vsLastWeekPct}%
                  </span>
                )}
              </div>
            </div>
          )}
          {/* 날씨 인사이트 */}
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[11px] text-text-tertiary font-medium mb-2">날씨 인사이트</div>
            <div className="text-[14px] text-text-primary leading-relaxed">
              {data.weatherInsight || "날씨 데이터 대기 중"}
            </div>
          </div>
        </div>

        {/* 30일 추이 차트 */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">30일 세차 대수 추이</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.trend} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => v.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.[0]) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] shadow-md">
                      <div className="text-text-tertiary">{p.date}</div>
                      <div>세차: <span className="font-bold">{p.count}대</span></div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="count" stroke="#8B5CF6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 요일별 평균 */}
          <div className="bg-surface-raised rounded-xl p-6 border border-border">
            <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">요일별 평균 대수</h2>
            <div className="space-y-2">
              {data.dowStats.map(d => (
                <div key={d.dow} className="flex items-center gap-3">
                  <span className="text-[13px] font-bold text-text-primary w-6 text-right">{d.label}</span>
                  <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-purple-400"
                      style={{ width: `${maxDowCount > 0 ? (d.avgCount / maxDowCount) * 100 : 0}%`, opacity: 0.75 }}
                    />
                  </div>
                  <span className="text-[12px] font-bold text-text-primary w-12 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {d.avgCount}대
                  </span>
                  <span className="text-[10px] text-text-tertiary w-6 text-right">n={d.n}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 날씨별 세차 대수 */}
          <div className="bg-surface-raised rounded-xl p-6 border border-border">
            <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">날씨별 세차 대수</h2>
            <div className="space-y-4">
              <div>
                <div className="text-[12px] text-text-tertiary font-medium mb-2">당일 날씨</div>
                {data.weatherStats.map(w => (
                  <div key={w.key} className="flex items-center justify-between py-1.5">
                    <span className="text-[13px] text-text-secondary">{w.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>{w.avgCount}대</span>
                      <span className="text-[10px] text-text-tertiary">n={w.n}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3">
                <div className="text-[12px] text-text-tertiary font-medium mb-2">비 다음날 세차 (lag-1)</div>
                {data.lagWeatherStats.map(w => {
                  const dryAvg = data.lagWeatherStats.find(l => l.key === "dry")?.avgCount ?? 0;
                  const diffPct = dryAvg > 0 ? +(((w.avgCount - dryAvg) / dryAvg) * 100).toFixed(1) : null;
                  return (
                    <div key={w.key} className="flex items-center justify-between py-1.5">
                      <span className="text-[13px] text-text-secondary">{w.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-bold text-text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>{w.avgCount}대</span>
                        {diffPct != null && w.key !== "dry" && (
                          <span className={`text-[12px] font-bold ${diffPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {diffPct >= 0 ? "+" : ""}{diffPct}%
                          </span>
                        )}
                        <span className="text-[10px] text-text-tertiary">n={w.n}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 종류별 대수 추이 */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">종류별 대수 추이 (30일)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.typeBreakdownTrend} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => v.slice(8)} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.[0]) return null;
                  const p = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] shadow-md">
                      <div className="text-text-tertiary mb-1">{p.date}</div>
                      <div>기본: <span className="font-bold">{p.basic}</span></div>
                      <div>프리미엄: <span className="font-bold">{p.premium}</span></div>
                      {p.taxi > 0 && <div>택시: <span className="font-bold">{p.taxi}</span></div>}
                      {p.free > 0 && <div>무료: <span className="font-bold">{p.free}</span></div>}
                      <div className="border-t border-slate-100 mt-1 pt-1">합계: <span className="font-bold">{p.total}</span></div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="basic" stackId="a" fill="#60A5FA" name="기본" />
              <Bar dataKey="premium" stackId="a" fill="#8B5CF6" name="프리미엄" />
              <Bar dataKey="taxi" stackId="a" fill="#FBBF24" name="택시" />
              <Bar dataKey="free" stackId="a" fill="#CBD5E1" name="무료" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-text-tertiary">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-400 inline-block" />기본 (5~6천)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-purple-500 inline-block" />프리미엄 (7천~1만)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-amber-400 inline-block" />택시</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-slate-300 inline-block" />무료</span>
          </div>
        </div>

        {/* 주유 대수 vs 세차 대수 산점도 */}
        {data.scatterData.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-6 border border-border">
            <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">주유 대수 vs 세차 대수 상관관계</h2>
            <ResponsiveContainer width="100%" height={350}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                <XAxis
                  type="number" dataKey="fuelCount" name="주유 대수"
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  label={{ value: "주유 대수", position: "insideBottomRight", offset: -5, fontSize: 11, fill: "#6B7280" }}
                />
                <YAxis
                  type="number" dataKey="carwashCount" name="세차 대수"
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  label={{ value: "세차 대수", angle: -90, position: "insideLeft", fontSize: 11, fill: "#6B7280" }}
                />
                <ZAxis range={[30, 30]} />
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] shadow-md">
                        <div className="text-text-tertiary">{p.date}</div>
                        <div>주유: <span className="font-bold">{p.fuelCount}대</span></div>
                        <div>세차: <span className="font-bold">{p.carwashCount}대</span></div>
                      </div>
                    );
                  }}
                />
                <Scatter data={data.scatterData} fill="#8B5CF6" opacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
