"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Label,
  BarChart,
  Bar,
} from "recharts";

interface DistrictAnalysis {
  district: string;
  population: { peak_hour: number; peak_pop: number; avg_pop: number; night_pop: number };
  gasStation: { count: number; avg_gasoline: number; avg_diesel: number; min_gasoline: number; max_gasoline: number };
  insight: { pop_per_station: number; price_vs_avg: number; competition_level: string };
}

interface AnalysisData {
  analysis: DistrictAnalysis[];
  summary: {
    total_districts: number;
    total_stations: number;
    avg_gasoline_seoul: number;
    correlation: number;
    correlation_meaning: string;
    date: string;
  };
}

type SortKey = "pop" | "price" | "count" | "competition" | "pop_per_station";
type FuelType = "gasoline" | "diesel";

const COMP_CFG: Record<string, { label: string; color: string; bg: string; order: number }> = {
  very_high: { label: "매우 높음", color: "#DC2626", bg: "#FEE2E2", order: 0 },
  high: { label: "높음", color: "#EA580C", bg: "#FFF7ED", order: 1 },
  medium: { label: "보통", color: "#CA8A04", bg: "#FEFCE8", order: 2 },
  low: { label: "낮음", color: "#16A34A", bg: "#F0FDF4", order: 3 },
};

function getQuadrant(
  avgPop: number, price: number, seoulAvgPop: number, seoulAvgPrice: number
): { label: string; color: string; bg: string } {
  if (avgPop >= seoulAvgPop && price >= seoulAvgPrice)
    return { label: "프리미엄", color: "#7C3AED", bg: "#F5F3FF" };
  if (avgPop >= seoulAvgPop && price < seoulAvgPrice)
    return { label: "기회", color: "#059669", bg: "#ECFDF5" };
  if (avgPop < seoulAvgPop && price >= seoulAvgPrice)
    return { label: "독점", color: "#DC2626", bg: "#FEF2F2" };
  return { label: "관망", color: "#6B7280", bg: "#F9FAFB" };
}

export default function PopulationPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("pop_per_station");
  const [sortAsc, setSortAsc] = useState(false);
  const [fuelType, setFuelType] = useState<FuelType>("gasoline");

  useEffect(() => {
    fetch("/api/population-analysis")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const withData = useMemo(
    () => data?.analysis.filter((d) => d.gasStation.count > 0) ?? [],
    [data]
  );

  const seoulAvgPop = useMemo(() => {
    if (withData.length === 0) return 0;
    return Math.round(withData.reduce((s, d) => s + d.population.avg_pop, 0) / withData.length);
  }, [withData]);

  const scatterData = useMemo(() => {
    if (!data) return [];
    return withData.map((d) => ({
      name: d.district,
      x: Math.round(d.population.avg_pop / 10000),
      y: fuelType === "gasoline" ? d.gasStation.avg_gasoline : d.gasStation.avg_diesel,
      z: d.gasStation.count,
      raw: d,
    }));
  }, [data, withData, fuelType]);

  const barData = useMemo(() => {
    return [...withData]
      .filter((d) => d.insight.pop_per_station > 0)
      .sort((a, b) => b.insight.pop_per_station - a.insight.pop_per_station)
      .map((d) => ({
        name: d.district,
        value: Math.round(d.insight.pop_per_station / 10000),
        rawValue: d.insight.pop_per_station,
        level: d.insight.competition_level,
      }));
  }, [withData]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const list = [...data.analysis];
    list.sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "pop": va = a.population.avg_pop; vb = b.population.avg_pop; break;
        case "price":
          va = fuelType === "gasoline" ? a.gasStation.avg_gasoline : a.gasStation.avg_diesel;
          vb = fuelType === "gasoline" ? b.gasStation.avg_gasoline : b.gasStation.avg_diesel; break;
        case "count": va = a.gasStation.count; vb = b.gasStation.count; break;
        case "competition":
          va = COMP_CFG[a.insight.competition_level]?.order ?? 4;
          vb = COMP_CFG[b.insight.competition_level]?.order ?? 4; break;
        case "pop_per_station": va = a.insight.pop_per_station; vb = b.insight.pop_per_station; break;
        default: va = 0; vb = 0;
      }
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [data, sortKey, sortAsc, fuelType]);

  const insights = useMemo(() => {
    if (!data || withData.length === 0) return [];
    const lines: string[] = [];
    const avgPrice = data.summary.avg_gasoline_seoul;

    // 가장 유리한 입지
    const best = [...withData].sort((a, b) => b.insight.pop_per_station - a.insight.pop_per_station)[0];
    if (best) {
      lines.push(
        `가장 유리한 입지: ${best.district} (주유소당 ${(best.insight.pop_per_station / 10000).toFixed(1)}만명, 평균 대비 ${best.insight.price_vs_avg > 0 ? "+" : ""}${best.insight.price_vs_avg}원)`
      );
    }

    // 가장 치열한 경쟁
    const worst = [...withData].sort((a, b) => a.insight.pop_per_station - b.insight.pop_per_station)[0];
    if (worst && worst !== best) {
      lines.push(
        `가장 치열한 경쟁: ${worst.district} (주유소 ${worst.gasStation.count}개, 주유소당 ${(worst.insight.pop_per_station / 10000).toFixed(1)}만명)`
      );
    }

    // 프리미엄 지역
    const premiums = withData.filter(
      (d) => d.population.avg_pop >= seoulAvgPop && d.gasStation.avg_gasoline >= avgPrice
    );
    if (premiums.length > 0) {
      lines.push(
        `상권 프리미엄: ${premiums.map((d) => d.district).join(", ")}은 높은 수요와 높은 가격이 공존`
      );
    }

    // 기회 지역
    const opportunities = withData.filter(
      (d) => d.population.avg_pop >= seoulAvgPop && d.gasStation.avg_gasoline < avgPrice
    );
    if (opportunities.length > 0) {
      lines.push(
        `기회 지역: ${opportunities.map((d) => d.district).join(", ")}은 수요 대비 가격이 낮아 진입 가능성`
      );
    }

    return lines;
  }, [data, withData, seoulAvgPop]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ active, asc }: { active: boolean; asc: boolean }) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" className="inline ml-0.5" style={{ opacity: active ? 1 : 0.3 }}>
        <path d="M6 2L9 5H3L6 2Z" fill={active && !asc ? "#1B2838" : "#9BA8B7"} />
        <path d="M6 10L3 7H9L6 10Z" fill={active && asc ? "#1B2838" : "#9BA8B7"} />
      </svg>
    );
  }

  const FuelToggle = () => (
    <div className="flex gap-1 bg-surface rounded-lg p-0.5">
      {(["gasoline", "diesel"] as const).map((ft) => (
        <button
          key={ft}
          onClick={() => setFuelType(ft)}
          className={`px-3 py-1 text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors ${
            fuelType === ft ? "bg-navy text-white" : "bg-transparent text-text-secondary hover:text-text-primary"
          }`}
        >
          {ft === "gasoline" ? "휘발유" : "경유"}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="h-screen overflow-y-auto bg-surface">
        <header className="h-[56px] bg-navy flex items-center px-5">
          <span className="text-white text-[16px] font-bold">분석 로딩 중...</span>
        </header>
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-screen overflow-y-auto bg-surface flex items-center justify-center">
        <p className="text-text-secondary">데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  const { summary } = data;
  const corrColor = Math.abs(summary.correlation) < 0.2 ? "#6B7A8D" : summary.correlation > 0 ? "#16A34A" : "#DC2626";

  return (
    <div className="h-screen overflow-y-auto bg-surface">
      {/* 헤더 */}
      <header className="h-[56px] bg-navy flex items-center gap-4 px-4 md:px-5 shrink-0 sticky top-0 z-50">
        <Link href="/" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors no-underline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </Link>
        <div>
          <h1 className="text-white text-[15px] font-bold m-0">서울 유동인구 × 주유소 가격 분석</h1>
          <p className="text-gray-400 text-[11px] m-0">기준일: {summary.date}</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* 1. 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4285F4" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            label="분석 주유소"
            value={`${summary.total_stations}개`}
          />
          <SummaryCard
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C073" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
            label="서울 평균 휘발유가"
            value={`${summary.avg_gasoline_seoul.toLocaleString()}원`}
          />
          <SummaryCard
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={corrColor} strokeWidth="2"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/></svg>}
            label="상관계수"
            value={summary.correlation.toFixed(2)}
            valueColor={corrColor}
          />
          <SummaryCard
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>}
            label="해석"
            value={summary.correlation_meaning}
            small
          />
        </div>

        {/* 2. 산점도 */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[15px] font-bold text-text-primary m-0">유동인구 vs 주유가격 (4분면 분석)</h2>
            <FuelToggle />
          </div>
          <p className="text-[12px] text-text-tertiary m-0 mb-4">점 크기 = 주유소 수 | 점선 = 서울 평균</p>

          <div className="relative">
            {/* 4분면 라벨 */}
            <div className="absolute top-2 left-[calc(50%+40px)] text-[10px] font-semibold text-purple-400 z-10 pointer-events-none hidden md:block">프리미엄 지역</div>
            <div className="absolute bottom-8 left-[calc(50%+40px)] text-[10px] font-semibold text-emerald-500 z-10 pointer-events-none hidden md:block">기회 지역</div>
            <div className="absolute top-2 left-[80px] text-[10px] font-semibold text-red-400 z-10 pointer-events-none hidden md:block">독점 지역</div>
            <div className="absolute bottom-8 left-[80px] text-[10px] font-semibold text-gray-400 z-10 pointer-events-none hidden md:block">관망 지역</div>

            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="유동인구"
                  tick={{ fontSize: 11 }}
                  label={{ value: "평균 유동인구 (만 명)", position: "bottom", fontSize: 11, fill: "#6B7A8D" }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="가격"
                  tick={{ fontSize: 11 }}
                  domain={["dataMin - 30", "dataMax + 30"]}
                  label={{ value: `평균 ${fuelType === "gasoline" ? "휘발유" : "경유"}가 (원)`, angle: -90, position: "insideLeft", fontSize: 11, fill: "#6B7A8D" }}
                />
                <ReferenceLine
                  x={Math.round(seoulAvgPop / 10000)}
                  stroke="#9BA8B7"
                  strokeDasharray="4 4"
                >
                  <Label value="평균 인구" position="top" fontSize={10} fill="#9BA8B7" />
                </ReferenceLine>
                <ReferenceLine
                  y={summary.avg_gasoline_seoul}
                  stroke="#9BA8B7"
                  strokeDasharray="4 4"
                >
                  <Label value="평균 가격" position="right" fontSize={10} fill="#9BA8B7" />
                </ReferenceLine>
                <Tooltip
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    const q = getQuadrant(d.raw.population.avg_pop, d.y, seoulAvgPop, summary.avg_gasoline_seoul);
                    return (
                      <div className="bg-white border border-border rounded-lg p-3 shadow-lg text-[12px]">
                        <p className="font-bold m-0 mb-1">{d.name}</p>
                        <p className="m-0 text-text-secondary">유동인구: {d.x}만 명</p>
                        <p className="m-0 text-text-secondary">{fuelType === "gasoline" ? "휘발유" : "경유"}: {d.y.toLocaleString()}원</p>
                        <p className="m-0 text-text-secondary">주유소: {d.z}개</p>
                        <p className="m-0 mt-1 font-semibold" style={{ color: q.color }}>{q.label} 지역</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData}>
                  {scatterData.map((entry, i) => {
                    const q = getQuadrant(entry.raw.population.avg_pop, entry.y, seoulAvgPop, summary.avg_gasoline_seoul);
                    return <Cell key={i} fill={q.color} fillOpacity={0.7} r={Math.max(6, Math.min(20, entry.z * 1.2))} />;
                  })}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-4 justify-center mt-2">
            {[
              { label: "프리미엄", color: "#7C3AED", desc: "높은 수요 + 높은 가격" },
              { label: "기회", color: "#059669", desc: "높은 수요 + 낮은 가격" },
              { label: "독점", color: "#DC2626", desc: "낮은 수요 + 높은 가격" },
              { label: "관망", color: "#6B7280", desc: "낮은 수요 + 낮은 가격" },
            ].map((q) => (
              <div key={q.label} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <span className="w-3 h-3 rounded-full" style={{ background: q.color, opacity: 0.7 }} />
                <span className="font-semibold" style={{ color: q.color }}>{q.label}</span>
                <span>{q.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. 주유소당 인구 랭킹 */}
        <div className="bg-white rounded-xl border border-border p-5">
          <h2 className="text-[15px] font-bold text-text-primary m-0 mb-1">주유소 1개당 유동인구 (높을수록 유리한 입지)</h2>
          <p className="text-[12px] text-text-tertiary m-0 mb-4">막대 색상 = 경쟁 강도 (빨강: 경쟁 치열, 초록: 경쟁 낮음)</p>
          <ResponsiveContainer width="100%" height={barData.length * 32 + 40}>
            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} label={{ value: "만 명", position: "right", fontSize: 11, fill: "#6B7A8D" }} />
              <YAxis dataKey="name" type="category" width={65} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v) => [`${Number(v).toLocaleString()}만 명`, "주유소당 인구"]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={COMP_CFG[entry.level]?.color ?? "#6B7280"} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 4. 상세 테이블 */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-text-primary m-0">자치구별 상세</h2>
            <FuelToggle />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ minWidth: 900 }}>
              <thead>
                <tr className="bg-surface border-b border-border">
                  <Th>자치구</Th>
                  <Th right sortable onClick={() => handleSort("pop")}>평균 유동인구 <SortIcon active={sortKey === "pop"} asc={sortAsc} /></Th>
                  <Th right>피크 시간</Th>
                  <Th right sortable onClick={() => handleSort("count")}>주유소 수 <SortIcon active={sortKey === "count"} asc={sortAsc} /></Th>
                  <Th right sortable onClick={() => handleSort("price")}>평균 {fuelType === "gasoline" ? "휘발유" : "경유"}가 <SortIcon active={sortKey === "price"} asc={sortAsc} /></Th>
                  <Th right>서울 대비</Th>
                  <Th center sortable onClick={() => handleSort("competition")}>경쟁 강도 <SortIcon active={sortKey === "competition"} asc={sortAsc} /></Th>
                  <Th right sortable onClick={() => handleSort("pop_per_station")}>주유소당 인구 <SortIcon active={sortKey === "pop_per_station"} asc={sortAsc} /></Th>
                  <Th center>포지션</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const hasData = d.gasStation.count > 0;
                  const price = fuelType === "gasoline" ? d.gasStation.avg_gasoline : d.gasStation.avg_diesel;
                  const comp = COMP_CFG[d.insight.competition_level];
                  const quad = hasData ? getQuadrant(d.population.avg_pop, d.gasStation.avg_gasoline, seoulAvgPop, summary.avg_gasoline_seoul) : null;
                  return (
                    <tr key={d.district} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-text-primary">{d.district}</td>
                      <td className="px-4 py-2.5 text-right">{d.population.avg_pop.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{d.population.peak_hour}시</td>
                      <td className="px-4 py-2.5 text-right">{d.gasStation.count}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {hasData ? `${price.toLocaleString()}원` : <span className="text-text-tertiary font-normal">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {hasData ? (
                          <span className="font-semibold" style={{ color: d.insight.price_vs_avg > 0 ? "#DC2626" : d.insight.price_vs_avg < 0 ? "#2563EB" : "#6B7A8D" }}>
                            {d.insight.price_vs_avg > 0 ? "+" : ""}{d.insight.price_vs_avg}
                          </span>
                        ) : <span className="text-text-tertiary">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {hasData && comp ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color: comp.color, backgroundColor: comp.bg }}>
                            {comp.label}
                          </span>
                        ) : <span className="text-text-tertiary text-[11px]">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {hasData && d.insight.pop_per_station > 0 ? d.insight.pop_per_station.toLocaleString() : <span className="text-text-tertiary">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {quad ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color: quad.color, backgroundColor: quad.bg }}>
                            {quad.label}
                          </span>
                        ) : <span className="text-text-tertiary text-[11px]">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. 인사이트 */}
        {insights.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-5">
            <h2 className="text-[15px] font-bold text-text-primary m-0 mb-3">핵심 인사이트</h2>
            <div className="space-y-2.5">
              {insights.map((text, i) => (
                <div key={i} className="flex gap-2.5 items-start">
                  <span className="w-5 h-5 rounded-full bg-emerald/10 text-emerald flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold">
                    {i + 1}
                  </span>
                  <p className="text-[13px] text-text-secondary m-0 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, small, valueColor }: {
  icon: React.ReactNode; label: string; value: string; small?: boolean; valueColor?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-[11px] font-medium text-text-tertiary">{label}</span></div>
      <p className={`font-bold m-0 ${small ? "text-[13px] leading-snug" : "text-[20px]"}`} style={{ color: valueColor || "#1B2838" }}>
        {value}
      </p>
    </div>
  );
}

function Th({ children, right, center, sortable, onClick }: {
  children: React.ReactNode; right?: boolean; center?: boolean; sortable?: boolean; onClick?: () => void;
}) {
  return (
    <th
      className={`px-4 py-2.5 font-semibold text-text-secondary ${right ? "text-right" : center ? "text-center" : "text-left"} ${sortable ? "cursor-pointer hover:text-text-primary" : ""}`}
      onClick={onClick}
    >
      {children}
    </th>
  );
}
