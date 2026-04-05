"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

interface PriceDay {
  date: string;
  gasoline: number | null;
  diesel: number | null;
}

interface CompetitorHistory {
  id: string;
  name: string;
  brand: string;
  distance_km: number;
  history: PriceDay[];
}

const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a", GSC: "#00a651", HDO: "#0066b3",
  SOL: "#ffd200", RTO: "#ff8c00", NHO: "#006838", ETC: "#9BA8B7",
};

export default function PriceHistoryPage() {
  const [myHistory, setMyHistory] = useState<PriceDay[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFuel, setSelectedFuel] = useState<"gasoline" | "diesel">("gasoline");
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      fetch(`/api/price-history/${STATION_ID}`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}/competitors`).then((r) => r.json()),
    ]).then(async ([historyData, compData]) => {
      setMyHistory(historyData.history || []);

      // 상위 5개 경쟁사의 가격 이력도 로드
      const top5 = (compData.competitors || []).slice(0, 5);
      const compHistories = await Promise.all(
        top5.map(async (c: { id: string; name: string; brand: string; distance_km: number }) => {
          const res = await fetch(`/api/price-history/${c.id}`);
          const json = await res.json();
          return {
            id: c.id,
            name: c.name,
            brand: c.brand,
            distance_km: c.distance_km,
            history: json.history || [],
          };
        })
      );
      setCompetitors(compHistories);
      setLoading(false);
    });
  }, []);

  // 가격 변경 이력 테이블 데이터
  const changeHistory = myHistory
    .map((day, i) => {
      if (i === 0) return null;
      const prev = myHistory[i - 1];
      const gasDiff = day.gasoline && prev.gasoline ? day.gasoline - prev.gasoline : null;
      const dieselDiff = day.diesel && prev.diesel ? day.diesel - prev.diesel : null;
      if (gasDiff === 0 && dieselDiff === 0) return null;
      if (gasDiff === null && dieselDiff === null) return null;
      return {
        date: day.date,
        gasoline: day.gasoline,
        diesel: day.diesel,
        gasolinePrev: prev.gasoline,
        dieselPrev: prev.diesel,
        gasDiff,
        dieselDiff,
      };
    })
    .filter(Boolean)
    .reverse();

  // 오버레이 차트 데이터 합성
  const chartData = myHistory.map((day) => {
    const row: Record<string, string | number | null> = {
      date: day.date.slice(5),
      fullDate: day.date,
      내주유소: day[selectedFuel],
    };
    for (const comp of competitors) {
      if (overlayIds.has(comp.id)) {
        const match = comp.history.find((h) => h.date === day.date);
        row[comp.name] = match ? match[selectedFuel] : null;
      }
    }
    return row;
  });

  // 가격 통계
  const prices = myHistory.map((d) => d[selectedFuel]).filter((p): p is number => p != null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const latestPrice = prices.length > 0 ? prices[prices.length - 1] : 0;
  const firstPrice = prices.length > 0 ? prices[0] : 0;
  const totalChange = latestPrice - firstPrice;

  const toggleOverlay = (id: string) => {
    setOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="내 가격 추이" description="최근 30일 가격 변동 분석" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="내 가격 추이" description="셀프광장주유소 · 최근 30일 가격 변동 분석" />

      <main className="px-5 pb-10">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">현재가</div>
            <div className="text-[20px] font-extrabold text-text-primary">{latestPrice.toLocaleString()}<span className="text-[12px] font-normal">원</span></div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">30일 변동</div>
            <div className={`text-[20px] font-extrabold ${totalChange > 0 ? "text-coral" : totalChange < 0 ? "text-blue-600" : "text-text-primary"}`}>
              {totalChange > 0 ? "+" : ""}{totalChange}<span className="text-[12px] font-normal">원</span>
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">30일 평균</div>
            <div className="text-[20px] font-extrabold text-text-primary">{avgPrice.toLocaleString()}<span className="text-[12px] font-normal">원</span></div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">최저↔최고</div>
            <div className="text-[14px] font-bold text-text-primary">
              {minPrice.toLocaleString()} ~ {maxPrice.toLocaleString()}
            </div>
          </div>
        </div>

        {/* 유종 선택 */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSelectedFuel("gasoline")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
              selectedFuel === "gasoline"
                ? "bg-coral text-white border-coral"
                : "bg-surface-raised text-text-secondary border-border hover:border-text-secondary"
            }`}
          >
            휘발유
          </button>
          <button
            onClick={() => setSelectedFuel("diesel")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
              selectedFuel === "diesel"
                ? "bg-navy text-white border-navy"
                : "bg-surface-raised text-text-secondary border-border hover:border-text-secondary"
            }`}
          >
            경유
          </button>
        </div>

        {/* 메인 차트 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[16px] font-bold text-text-primary">
              {selectedFuel === "gasoline" ? "휘발유" : "경유"} 가격 추이
            </div>
            <div className="flex gap-3 text-[12px]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: selectedFuel === "gasoline" ? "#FF5252" : "#1B2838" }} />
                내 주유소
              </span>
              {competitors.filter((c) => overlayIds.has(c.id)).map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                  {c.name.length > 6 ? c.name.slice(0, 6) + "…" : c.name}
                </span>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis
                dataKey="date"
                fontSize={11}
                tick={{ fill: "#9BA8B7" }}
                interval="preserveStartEnd"
                axisLine={{ stroke: "#26282F" }}
                tickLine={false}
              />
              <YAxis
                fontSize={11}
                tick={{ fill: "#9BA8B7" }}
                domain={["dataMin - 20", "dataMax + 20"]}
                tickFormatter={(v: number) => v.toLocaleString()}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value).toLocaleString()}원`,
                  String(name),
                ]}
                labelFormatter={(label) => `${label}`}
                labelStyle={{ fontWeight: 600, color: "#1B2838", fontSize: 12 }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #E8EBF0",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  padding: "8px 12px",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="내주유소"
                stroke={selectedFuel === "gasoline" ? "#FF5252" : "#1B2838"}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                connectNulls
              />
              {competitors
                .filter((c) => overlayIds.has(c.id))
                .map((c) => (
                  <Line
                    key={c.id}
                    type="monotone"
                    dataKey={c.name}
                    stroke={BRAND_COLORS[c.brand] || "#9BA8B7"}
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 3"
                    connectNulls
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 경쟁사 오버레이 선택 */}
        {competitors.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
            <div className="text-[13px] font-bold text-text-primary mb-3">경쟁사 가격 비교 (차트에 오버레이)</div>
            <div className="flex flex-wrap gap-2">
              {competitors.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleOverlay(c.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
                    overlayIds.has(c.id)
                      ? "border-emerald bg-emerald-light text-emerald"
                      : "border-border bg-surface-raised text-text-secondary hover:border-text-secondary"
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }}
                  />
                  {c.name}
                  <span className="text-[12px] text-text-tertiary">{c.distance_km}km</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 가격 변경 이력 테이블 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border">
          <div className="text-[13px] font-bold text-text-primary mb-4">가격 변경 이력</div>
          {changeHistory.length === 0 ? (
            <div className="text-[13px] text-text-tertiary text-center py-8">
              30일간 가격 변경 이력이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-text-secondary font-semibold">날짜</th>
                    <th className="text-right py-2 px-3 text-text-secondary font-semibold">휘발유</th>
                    <th className="text-right py-2 px-3 text-text-secondary font-semibold">변동</th>
                    <th className="text-right py-2 px-3 text-text-secondary font-semibold">경유</th>
                    <th className="text-right py-2 px-3 text-text-secondary font-semibold">변동</th>
                  </tr>
                </thead>
                <tbody>
                  {changeHistory.map((c) => {
                    if (!c) return null;
                    return (
                      <tr key={c.date} className="border-b border-border/50 hover:bg-surface transition-colors">
                        <td className="py-2.5 px-3 text-text-primary font-medium">{c.date.slice(5)}</td>
                        <td className="py-2.5 px-3 text-right text-text-primary">
                          {c.gasoline?.toLocaleString() || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {c.gasDiff != null && c.gasDiff !== 0 ? (
                            <span className={c.gasDiff > 0 ? "text-coral" : "text-blue-600"}>
                              {c.gasDiff > 0 ? "▲" : "▼"}{Math.abs(c.gasDiff)}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">-</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-text-primary">
                          {c.diesel?.toLocaleString() || "-"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {c.dieselDiff != null && c.dieselDiff !== 0 ? (
                            <span className={c.dieselDiff > 0 ? "text-coral" : "text-blue-600"}>
                              {c.dieselDiff > 0 ? "▲" : "▼"}{Math.abs(c.dieselDiff)}
                            </span>
                          ) : (
                            <span className="text-text-tertiary">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
