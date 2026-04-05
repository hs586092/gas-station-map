"use client";

import { useState, useEffect } from "react";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

const BRAND_LABELS: Record<string, string> = {
  SKE: "SK에너지", GSC: "GS칼텍스", HDO: "HD현대오일뱅크",
  SOL: "S-OIL", RTO: "자영알뜰", NHO: "농협알뜰", ETC: "기타",
};
const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a", GSC: "#00a651", HDO: "#0066b3",
  SOL: "#ffd200", RTO: "#ff8c00", NHO: "#006838", ETC: "#9BA8B7",
};

interface CompetitorData {
  baseStation: {
    id: string; name: string; brand: string;
    gasoline_price: number | null; diesel_price: number | null;
  };
  competitors: Array<{
    id: string; name: string; brand: string;
    gasoline_price: number | null; diesel_price: number | null;
    distance_km: number; gasoline_diff: number | null; diesel_diff: number | null;
  }>;
  stats: {
    avg_gasoline: number | null; avg_diesel: number | null;
    my_gasoline_rank: number | null; my_diesel_rank: number | null;
    total_count: number;
  };
}

interface Insights {
  rankChange: {
    gasoline: { today: { rank: number; total: number } | null; yesterday: { rank: number; total: number } | null; diff: number | null };
    diesel: { today: { rank: number; total: number } | null; yesterday: { rank: number; total: number } | null; diff: number | null };
    reason: string;
  };
  competitorProfiles: Array<{
    id: string; name: string; brand: string; distance_km: number;
    type: "leader" | "follower" | "steady" | "unknown";
    typeLabel: string; changeCount: number; avgChangeSize: number;
    currentPrice: number | null;
  }>;
}

export default function PricePositionPage() {
  const [competitors, setCompetitors] = useState<CompetitorData | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFuel, setSelectedFuel] = useState<"gasoline" | "diesel">("gasoline");
  const [sortBy, setSortBy] = useState<"price" | "distance" | "diff">("price");

  useEffect(() => {
    Promise.all([
      fetch(`/api/stations/${STATION_ID}/competitors`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}/dashboard-insights`).then((r) => r.json()),
    ]).then(([compData, insightsData]) => {
      setCompetitors(compData);
      setInsights(insightsData);
      setLoading(false);
    });
  }, []);

  if (loading || !competitors) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="내 가격 · 포지션" description="경쟁사 대비 가격 순위 분석" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const myGas = competitors.baseStation.gasoline_price;
  const myDiesel = competitors.baseStation.diesel_price;
  const myPrice = selectedFuel === "gasoline" ? myGas : myDiesel;

  // 정렬된 경쟁사 목록
  const sortedCompetitors = [...competitors.competitors].sort((a, b) => {
    if (sortBy === "distance") return a.distance_km - b.distance_km;
    if (sortBy === "diff") {
      const diffA = selectedFuel === "gasoline" ? (a.gasoline_diff ?? 0) : (a.diesel_diff ?? 0);
      const diffB = selectedFuel === "gasoline" ? (b.gasoline_diff ?? 0) : (b.diesel_diff ?? 0);
      return diffA - diffB;
    }
    const pA = selectedFuel === "gasoline" ? (a.gasoline_price ?? 9999) : (a.diesel_price ?? 9999);
    const pB = selectedFuel === "gasoline" ? (b.gasoline_price ?? 9999) : (b.diesel_price ?? 9999);
    return pA - pB;
  });

  // 가격 시뮬레이터
  const allPrices = myPrice
    ? [myPrice, ...competitors.competitors
        .map((c) => selectedFuel === "gasoline" ? c.gasoline_price : c.diesel_price)
        .filter((p): p is number => p != null && p > 0)]
        .sort((a, b) => a - b)
    : [];
  const currentRank = myPrice ? allPrices.indexOf(myPrice) + 1 : 0;

  const simulations = myPrice
    ? [-30, -20, -10, 10, 20, 30].map((delta) => {
        const simPrice = myPrice + delta;
        const simPrices = [simPrice, ...competitors.competitors
          .map((c) => selectedFuel === "gasoline" ? c.gasoline_price : c.diesel_price)
          .filter((p): p is number => p != null && p > 0)]
          .sort((a, b) => a - b);
        const simRank = simPrices.indexOf(simPrice) + 1;
        return { delta, simPrice, simRank, total: simPrices.length, rankChange: simRank - currentRank };
      })
    : [];

  // 순위 분포 (내 위치 표시)
  const priceDistribution = allPrices.map((p, i) => ({
    price: p,
    rank: i + 1,
    isMe: p === myPrice,
  }));

  const gasRankInfo = insights?.rankChange?.gasoline;
  const dieselRankInfo = insights?.rankChange?.diesel;
  const activeRankInfo = selectedFuel === "gasoline" ? gasRankInfo : dieselRankInfo;

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="내 가격 · 포지션" description="셀프광장주유소 · 반경 5km 경쟁사 대비 분석" />

      <main className="px-5 pb-10">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">내 {selectedFuel === "gasoline" ? "휘발유" : "경유"}</div>
            <div className="text-[22px] font-extrabold text-text-primary">
              {myPrice?.toLocaleString() || "-"}<span className="text-[12px] font-normal">원</span>
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">현재 순위</div>
            <div className="text-[22px] font-extrabold text-emerald">
              {selectedFuel === "gasoline" ? competitors.stats.my_gasoline_rank : competitors.stats.my_diesel_rank}위
              <span className="text-[12px] font-normal text-text-secondary"> / {competitors.stats.total_count}개</span>
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">지역 평균</div>
            <div className="text-[20px] font-extrabold text-text-primary">
              {(selectedFuel === "gasoline" ? competitors.stats.avg_gasoline : competitors.stats.avg_diesel)?.toLocaleString() || "-"}
              <span className="text-[12px] font-normal">원</span>
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">평균 대비</div>
            {(() => {
              const avg = selectedFuel === "gasoline" ? competitors.stats.avg_gasoline : competitors.stats.avg_diesel;
              const diff = myPrice && avg ? myPrice - avg : null;
              return (
                <div className={`text-[20px] font-extrabold ${
                  diff && diff < 0 ? "text-blue-600" : diff && diff > 0 ? "text-coral" : "text-text-primary"
                }`}>
                  {diff != null ? `${diff > 0 ? "+" : ""}${diff}` : "-"}
                  <span className="text-[12px] font-normal">원</span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* 순위 변동 인사이트 */}
        {activeRankInfo && activeRankInfo.diff !== null && activeRankInfo.diff !== 0 && (
          <div className={`mb-6 rounded-2xl px-5 py-4 ${
            activeRankInfo.diff < 0 ? "bg-emerald-light" : "bg-red-50"
          }`}>
            <div className="text-[16px] font-bold text-text-primary">
              어제 {activeRankInfo.yesterday?.rank}위 → 오늘 {activeRankInfo.today?.rank}위
              {activeRankInfo.diff < 0 ? " 📈 순위 상승" : " 📉 순위 하락"}
            </div>
            {insights?.rankChange.reason && (
              <div className="text-[12px] text-text-secondary mt-1">{insights.rankChange.reason}</div>
            )}
          </div>
        )}

        {/* 유종 선택 + 정렬 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedFuel("gasoline")}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
                selectedFuel === "gasoline" ? "bg-coral text-white border-coral" : "bg-surface-raised text-text-secondary border-border"
              }`}
            >
              휘발유
            </button>
            <button
              onClick={() => setSelectedFuel("diesel")}
              className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
                selectedFuel === "diesel" ? "bg-navy text-white border-navy" : "bg-surface-raised text-text-secondary border-border"
              }`}
            >
              경유
            </button>
          </div>
          <div className="flex gap-1">
            {(["price", "distance", "diff"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
                  sortBy === s ? "bg-slate-200 text-white border-slate-700" : "bg-surface-raised text-text-secondary border-border"
                }`}
              >
                {s === "price" ? "가격순" : s === "distance" ? "거리순" : "차이순"}
              </button>
            ))}
          </div>
        </div>

        {/* 가격 분포 바 */}
        {priceDistribution.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
            <div className="text-[13px] font-bold text-text-primary mb-3">가격 분포 (저가 → 고가)</div>
            <div className="flex items-end gap-px h-16">
              {priceDistribution.map((d, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center"
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      d.isMe ? "bg-emerald" : "bg-gray-200"
                    }`}
                    style={{ height: `${20 + (i / priceDistribution.length) * 44}px` }}
                  />
                  {d.isMe && (
                    <div className="text-[12px] font-bold text-emerald mt-1">나</div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[12px] text-text-tertiary">
              <span>{priceDistribution[0]?.price.toLocaleString()}원</span>
              <span>{priceDistribution[priceDistribution.length - 1]?.price.toLocaleString()}원</span>
            </div>
          </div>
        )}

        {/* 경쟁사 가격 테이블 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="text-[13px] font-bold text-text-primary mb-4">
            경쟁사 전체 ({competitors.competitors.length}개)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-text-secondary font-semibold">순위</th>
                  <th className="text-left py-2 px-3 text-text-secondary font-semibold">주유소</th>
                  <th className="text-right py-2 px-3 text-text-secondary font-semibold">가격</th>
                  <th className="text-right py-2 px-3 text-text-secondary font-semibold">나와 차이</th>
                  <th className="text-right py-2 px-3 text-text-secondary font-semibold">거리</th>
                </tr>
              </thead>
              <tbody>
                {/* 내 주유소 (하이라이트) */}
                <tr className="bg-emerald-light border-b border-border">
                  <td className="py-2.5 px-3 font-bold text-emerald">
                    {selectedFuel === "gasoline" ? competitors.stats.my_gasoline_rank : competitors.stats.my_diesel_rank}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: BRAND_COLORS[competitors.baseStation.brand] }} />
                      <span className="font-bold text-text-primary">{competitors.baseStation.name}</span>
                      <span className="text-[12px] px-1.5 py-0.5 bg-emerald text-white rounded-full font-bold">나</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-text-primary">
                    {myPrice?.toLocaleString() || "-"}
                  </td>
                  <td className="py-2.5 px-3 text-right text-text-tertiary">-</td>
                  <td className="py-2.5 px-3 text-right text-text-tertiary">-</td>
                </tr>
                {sortedCompetitors.map((c, i) => {
                  const price = selectedFuel === "gasoline" ? c.gasoline_price : c.diesel_price;
                  const diff = selectedFuel === "gasoline" ? c.gasoline_diff : c.diesel_diff;
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-surface transition-colors">
                      <td className="py-2.5 px-3 text-text-secondary">{i + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                          <span className="text-text-primary">{c.name}</span>
                          <span className="text-[12px] text-text-tertiary">{BRAND_LABELS[c.brand] || ""}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-text-primary">
                        {price?.toLocaleString() || "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold">
                        {diff != null ? (
                          <span className={diff > 0 ? "text-coral" : diff < 0 ? "text-blue-600" : "text-text-tertiary"}>
                            {diff > 0 ? "+" : ""}{diff}
                          </span>
                        ) : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-text-secondary">{c.distance_km}km</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 가격 시뮬레이터 */}
        {myPrice && simulations.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[13px] font-bold text-text-primary mb-1">가격 시뮬레이터</div>
            <div className="text-[13px] text-text-tertiary mb-4">
              현재 {selectedFuel === "gasoline" ? "휘발유" : "경유"} {myPrice.toLocaleString()}원 · {allPrices.length}개 중 {currentRank}위 — 가격 변경 시 순위 변화 예측
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {simulations.map(({ delta, simPrice, simRank, total, rankChange }) => {
                const isUp = delta > 0;
                return (
                  <div key={delta} className={`rounded-xl p-3 text-center ${isUp ? "bg-red-50" : "bg-blue-50"}`}>
                    <div className={`text-[12px] font-bold ${isUp ? "text-coral" : "text-blue-600"}`}>
                      {delta > 0 ? "+" : ""}{delta}원
                    </div>
                    <div className="text-[14px] font-extrabold text-text-primary mt-1">{simPrice.toLocaleString()}</div>
                    <div className="text-[13px] text-text-secondary mt-1">
                      {total}개 중 <span className="font-bold">{simRank}위</span>
                    </div>
                    {rankChange !== 0 ? (
                      <div className={`text-[12px] font-medium mt-0.5 ${rankChange > 0 ? "text-coral" : "text-blue-600"}`}>
                        {rankChange > 0 ? `▼${rankChange}단계` : `▲${Math.abs(rankChange)}단계`}
                      </div>
                    ) : (
                      <div className="text-[12px] text-text-tertiary mt-0.5">변동 없음</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
