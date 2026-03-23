"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface DistrictAnalysis {
  district: string;
  population: {
    peak_hour: number;
    peak_pop: number;
    avg_pop: number;
    night_pop: number;
  };
  gasStation: {
    count: number;
    avg_gasoline: number;
    avg_diesel: number;
    min_gasoline: number;
    max_gasoline: number;
  };
  insight: {
    pop_per_station: number;
    price_vs_avg: number;
    competition_level: string;
  };
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

const COMPETITION_CONFIG: Record<string, { label: string; color: string; bg: string; order: number }> = {
  very_high: { label: "매우 높음", color: "#DC2626", bg: "#FEE2E2", order: 0 },
  high: { label: "높음", color: "#EA580C", bg: "#FFF7ED", order: 1 },
  medium: { label: "보통", color: "#CA8A04", bg: "#FEFCE8", order: 2 },
  low: { label: "낮음", color: "#16A34A", bg: "#F0FDF4", order: 3 },
};

export default function PopulationPage() {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("pop");
  const [sortAsc, setSortAsc] = useState(false);
  const [fuelType, setFuelType] = useState<FuelType>("gasoline");

  useEffect(() => {
    fetch("/api/population-analysis")
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    if (!data) return [];
    const list = [...data.analysis];
    list.sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "pop":
          va = a.population.avg_pop; vb = b.population.avg_pop; break;
        case "price":
          va = fuelType === "gasoline" ? a.gasStation.avg_gasoline : a.gasStation.avg_diesel;
          vb = fuelType === "gasoline" ? b.gasStation.avg_gasoline : b.gasStation.avg_diesel;
          break;
        case "count":
          va = a.gasStation.count; vb = b.gasStation.count; break;
        case "competition":
          va = COMPETITION_CONFIG[a.insight.competition_level]?.order ?? 4;
          vb = COMPETITION_CONFIG[b.insight.competition_level]?.order ?? 4;
          break;
        case "pop_per_station":
          va = a.insight.pop_per_station; vb = b.insight.pop_per_station; break;
        default:
          va = 0; vb = 0;
      }
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [data, sortKey, sortAsc, fuelType]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return [...data.analysis]
      .filter((d) => d.gasStation.count > 0)
      .sort((a, b) => a.population.avg_pop - b.population.avg_pop)
      .map((d) => ({
        name: d.district,
        population: Math.round(d.population.avg_pop / 10000),
        price: fuelType === "gasoline" ? d.gasStation.avg_gasoline : d.gasStation.avg_diesel,
      }));
  }, [data, fuelType]);

  const insights = useMemo(() => {
    if (!data) return [];
    const list: string[] = [];
    const withData = data.analysis.filter((d) => d.gasStation.count > 0);

    // 최고가 자치구
    const highest = [...withData].sort(
      (a, b) => b.gasStation.avg_gasoline - a.gasStation.avg_gasoline
    )[0];
    if (highest) {
      list.push(
        `${highest.district}: 유동인구 ${(highest.population.avg_pop / 10000).toFixed(0)}만 + 평균 휘발유 ${highest.gasStation.avg_gasoline.toLocaleString()}원 → 상권 프리미엄`
      );
    }

    // 최고 경쟁
    const mostCompetitive = [...withData].sort(
      (a, b) => {
        const oa = COMPETITION_CONFIG[a.insight.competition_level]?.order ?? 4;
        const ob = COMPETITION_CONFIG[b.insight.competition_level]?.order ?? 4;
        return oa - ob || b.gasStation.count - a.gasStation.count;
      }
    )[0];
    if (mostCompetitive && mostCompetitive !== highest) {
      list.push(
        `${mostCompetitive.district}: ${mostCompetitive.gasStation.count}개 주유소에 인구 ${(mostCompetitive.population.avg_pop / 10000).toFixed(0)}만 → 가장 치열한 경쟁 지역`
      );
    }

    // 최저가 자치구
    const lowest = [...withData].sort(
      (a, b) => a.gasStation.avg_gasoline - b.gasStation.avg_gasoline
    )[0];
    if (lowest && lowest !== highest && lowest !== mostCompetitive) {
      list.push(
        `${lowest.district}: 평균 ${lowest.gasStation.avg_gasoline.toLocaleString()}원으로 서울 최저가 → 가격 경쟁력 우수`
      );
    }

    return list;
  }, [data]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="h-[56px] bg-navy flex items-center px-5">
          <span className="text-white text-[16px] font-bold">분석 로딩 중...</span>
        </header>
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <p className="text-text-secondary">데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="min-h-screen bg-surface">
      {/* 헤더 */}
      <header className="h-[56px] bg-navy flex items-center gap-4 px-4 md:px-5 shrink-0">
        <Link
          href="/"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors no-underline"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-white text-[15px] font-bold m-0">서울 유동인구 × 주유소 가격 분석</h1>
          <p className="text-gray-400 text-[11px] m-0">기준일: {summary.date}</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="분석 주유소" value={`${summary.total_stations}개`} />
          <SummaryCard label="서울 평균 휘발유가" value={`${summary.avg_gasoline_seoul.toLocaleString()}원`} />
          <SummaryCard label="상관계수" value={summary.correlation.toFixed(2)} />
          <SummaryCard label="상관관계 해석" value={summary.correlation_meaning} small />
        </div>

        {/* 차트 */}
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold text-text-primary m-0">자치구별 비교</h2>
            <div className="flex gap-1 bg-surface rounded-lg p-0.5">
              <button
                onClick={() => setFuelType("gasoline")}
                className={`px-3 py-1 text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors ${
                  fuelType === "gasoline"
                    ? "bg-navy text-white"
                    : "bg-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                휘발유
              </button>
              <button
                onClick={() => setFuelType("diesel")}
                className={`px-3 py-1 text-[12px] font-medium rounded-md border-none cursor-pointer transition-colors ${
                  fuelType === "diesel"
                    ? "bg-navy text-white"
                    : "bg-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                경유
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 유동인구 차트 */}
            <div>
              <p className="text-[12px] font-medium text-text-tertiary mb-2 m-0">평균 유동인구 (만 명)</p>
              <ResponsiveContainer width="100%" height={chartData.length * 28 + 20}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={65} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) => [`${v}만 명`, "유동인구"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="population" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill="#4285F4" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 가격 차트 */}
            <div>
              <p className="text-[12px] font-medium text-text-tertiary mb-2 m-0">
                평균 {fuelType === "gasoline" ? "휘발유" : "경유"}가 (원)
              </p>
              <ResponsiveContainer width="100%" height={chartData.length * 28 + 20}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={["dataMin - 50", "dataMax + 50"]} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={65} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) => [`${Number(v).toLocaleString()}원`, fuelType === "gasoline" ? "휘발유" : "경유"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="price" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.price > (summary.avg_gasoline_seoul) ? "#EA580C" : "#00C073"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* 상세 테이블 */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-[15px] font-bold text-text-primary m-0">자치구별 상세</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]" style={{ minWidth: 800 }}>
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-text-secondary">자치구</th>
                  <th
                    className="text-right px-4 py-2.5 font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort("pop")}
                  >
                    평균 유동인구 <SortIcon active={sortKey === "pop"} asc={sortAsc} />
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-text-secondary">피크 시간</th>
                  <th
                    className="text-right px-4 py-2.5 font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort("count")}
                  >
                    주유소 수 <SortIcon active={sortKey === "count"} asc={sortAsc} />
                  </th>
                  <th
                    className="text-right px-4 py-2.5 font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort("price")}
                  >
                    평균 {fuelType === "gasoline" ? "휘발유" : "경유"}가 <SortIcon active={sortKey === "price"} asc={sortAsc} />
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-text-secondary">서울 대비</th>
                  <th
                    className="text-center px-4 py-2.5 font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort("competition")}
                  >
                    경쟁 강도 <SortIcon active={sortKey === "competition"} asc={sortAsc} />
                  </th>
                  <th
                    className="text-right px-4 py-2.5 font-semibold text-text-secondary cursor-pointer hover:text-text-primary"
                    onClick={() => handleSort("pop_per_station")}
                  >
                    주유소당 인구 <SortIcon active={sortKey === "pop_per_station"} asc={sortAsc} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => {
                  const hasData = d.gasStation.count > 0;
                  const price = fuelType === "gasoline" ? d.gasStation.avg_gasoline : d.gasStation.avg_diesel;
                  const comp = COMPETITION_CONFIG[d.insight.competition_level];
                  return (
                    <tr key={d.district} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-text-primary">{d.district}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary">{d.population.avg_pop.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{d.population.peak_hour}시</td>
                      <td className="px-4 py-2.5 text-right text-text-primary">{d.gasStation.count}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-text-primary">
                        {hasData ? `${price.toLocaleString()}원` : <span className="text-text-tertiary font-normal">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {hasData ? (
                          <span
                            className="font-semibold"
                            style={{ color: d.insight.price_vs_avg > 0 ? "#DC2626" : d.insight.price_vs_avg < 0 ? "#2563EB" : "#6B7A8D" }}
                          >
                            {d.insight.price_vs_avg > 0 ? "+" : ""}{d.insight.price_vs_avg}
                          </span>
                        ) : <span className="text-text-tertiary">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {hasData && comp ? (
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{ color: comp.color, backgroundColor: comp.bg }}
                          >
                            {comp.label}
                          </span>
                        ) : <span className="text-text-tertiary text-[11px]">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {hasData && d.insight.pop_per_station > 0
                          ? d.insight.pop_per_station.toLocaleString()
                          : <span className="text-text-tertiary">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 인사이트 */}
        {insights.length > 0 && (
          <div className="bg-white rounded-xl border border-border p-5">
            <h2 className="text-[15px] font-bold text-text-primary m-0 mb-3">주요 인사이트</h2>
            <div className="space-y-2">
              {insights.map((text, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-emerald mt-0.5 shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
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

function SummaryCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <p className="text-[11px] font-medium text-text-tertiary m-0 mb-1">{label}</p>
      <p className={`font-bold text-text-primary m-0 ${small ? "text-[13px] leading-snug" : "text-[20px]"}`}>
        {value}
      </p>
    </div>
  );
}
