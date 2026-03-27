"use client";

import { useState, useEffect, useMemo } from "react";

interface CompetitorModalProps {
  stationId: string;
  stationName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface BaseStation {
  id: string;
  name: string;
  brand: string;
  gasoline_price: number | null;
  diesel_price: number | null;
}

interface Competitor {
  id: string;
  name: string;
  brand: string;
  gasoline_price: number | null;
  diesel_price: number | null;
  distance_km: number;
  gasoline_diff: number | null;
  diesel_diff: number | null;
}

interface Stats {
  avg_gasoline: number | null;
  avg_diesel: number | null;
  my_gasoline_rank: number | null;
  my_diesel_rank: number | null;
  total_count: number;
}

interface CompetitorData {
  baseStation: BaseStation;
  competitors: Competitor[];
  stats: Stats;
}

interface Correlation {
  id: string;
  name: string;
  brand: string;
  distance_km: number;
  gasoline_correlation: number | null;
  diesel_correlation: number | null;
  gasoline_price: number | null;
  diesel_price: number | null;
  data_points: number;
}

interface CorrelationData {
  baseStation: { id: string; name: string; brand: string };
  dataPoints: number;
  dateRange: { from: string | null; to: string | null };
  correlations: Correlation[];
  reliability: "low" | "medium" | "high";
}

type Tab = "price" | "correlation";
type SortKey = "distance" | "price";
type CorrelationSortKey = "distance" | "correlation";
type FuelType = "gasoline" | "diesel";

const BRAND_LABELS: Record<string, string> = {
  SKE: "SK에너지",
  GSC: "GS칼텍스",
  HDO: "HD현대오일뱅크",
  SOL: "S-OIL",
  RTO: "자영알뜰",
  NHO: "농협",
  ETC: "기타",
};

function CorrelationBar({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-14 h-2 bg-border/50 rounded-full" />
        <span className="text-[11px] text-text-tertiary">분석불가 —</span>
      </div>
    );
  }

  const absVal = Math.abs(value);
  let color: string;
  let label: string;

  if (value < 0) {
    color = "#DC2626";
    label = "역방향 🔴";
  } else if (value < 0.3) {
    color = "#9CA3AF";
    label = "낮음 ⚪";
  } else if (value < 0.7) {
    color = "#F59E0B";
    label = "보통 🟡";
  } else {
    color = "#10B981";
    label = "높음 🟢";
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-2 bg-border/30 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(absVal * 100, 8)}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span className="text-[11px] whitespace-nowrap" style={{ color }}>
        {value.toFixed(2)} {label}
      </span>
    </div>
  );
}

export default function CompetitorModal({
  stationId,
  stationName,
  isOpen,
  onClose,
}: CompetitorModalProps) {
  const [tab, setTab] = useState<Tab>("price");
  const [fuelType, setFuelType] = useState<FuelType>("gasoline");

  // 가격 비교 데이터
  const [data, setData] = useState<CompetitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("distance");

  // 상관관계 데이터
  const [corrData, setCorrData] = useState<CorrelationData | null>(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrFetched, setCorrFetched] = useState(false);
  const [corrSortKey, setCorrSortKey] = useState<CorrelationSortKey>("correlation");

  // 가격 비교 데이터 로드
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setTab("price");
    setCorrData(null);
    setCorrFetched(false);

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setData(null);
        const res = await fetch(`/api/stations/${stationId}/competitors`);
        if (!res.ok) throw new Error("API 오류");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setError("경쟁사 데이터를 불러오는데 실패했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [stationId, isOpen]);

  // 상관관계 탭 클릭 시 로드 (1회만)
  useEffect(() => {
    if (tab !== "correlation" || corrFetched || !isOpen) return;

    let cancelled = false;
    setCorrFetched(true);

    (async () => {
      try {
        setCorrLoading(true);
        setCorrError(null);
        const res = await fetch(`/api/stations/${stationId}/correlation`);
        if (!res.ok) throw new Error("API 오류");
        const json = await res.json();
        if (!cancelled) setCorrData(json);
      } catch {
        if (!cancelled) setCorrError("연동성 데이터를 불러오는데 실패했습니다.");
      } finally {
        if (!cancelled) setCorrLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, corrFetched, stationId, isOpen]);

  const sortedCompetitors = useMemo(() => {
    if (!data) return [];
    const list = [...data.competitors];
    if (sortKey === "price") {
      list.sort((a, b) => {
        const aPrice = fuelType === "gasoline" ? a.gasoline_price : a.diesel_price;
        const bPrice = fuelType === "gasoline" ? b.gasoline_price : b.diesel_price;
        if (aPrice == null) return 1;
        if (bPrice == null) return -1;
        return aPrice - bPrice;
      });
    }
    return list;
  }, [data, sortKey, fuelType]);

  const sortedCorrelations = useMemo(() => {
    if (!corrData) return [];
    const list = [...corrData.correlations];
    if (corrSortKey === "correlation") {
      list.sort((a, b) => {
        const aCorr = fuelType === "gasoline" ? a.gasoline_correlation : a.diesel_correlation;
        const bCorr = fuelType === "gasoline" ? b.gasoline_correlation : b.diesel_correlation;
        if (aCorr == null) return 1;
        if (bCorr == null) return -1;
        return bCorr - aCorr;
      });
    } else {
      list.sort((a, b) => a.distance_km - b.distance_km);
    }
    return list;
  }, [corrData, corrSortKey, fuelType]);

  if (!isOpen) return null;

  const basePrice =
    data && fuelType === "gasoline"
      ? data.baseStation.gasoline_price
      : data?.baseStation.diesel_price;
  const avgPrice =
    data && fuelType === "gasoline"
      ? data.stats.avg_gasoline
      : data?.stats.avg_diesel;
  const rank =
    fuelType === "gasoline"
      ? data?.stats.my_gasoline_rank
      : data?.stats.my_diesel_rank;
  const avgDiff =
    basePrice != null && avgPrice != null ? basePrice - avgPrice : null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[20px] w-full max-w-[640px] max-h-[85vh] flex flex-col"
        style={{ boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 pt-6 pb-0 shrink-0">
          <div>
            <h2 className="text-[17px] font-bold text-text-primary m-0">
              경쟁사 비교
            </h2>
            <p className="text-[12px] text-text-tertiary mt-0.5 m-0">
              {stationName} · 반경 5km
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[10px] hover:bg-surface bg-transparent border-none cursor-pointer transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9BA8B7"
              strokeWidth="2.5"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 px-6 pt-4 pb-0 shrink-0">
          <button
            onClick={() => setTab("price")}
            className={`px-4 py-2 text-[13px] font-semibold rounded-[10px] border-none cursor-pointer transition-all ${
              tab === "price"
                ? "bg-navy text-white"
                : "bg-surface text-text-tertiary hover:text-text-secondary"
            }`}
          >
            💰 가격 비교
          </button>
          <button
            onClick={() => setTab("correlation")}
            className={`px-4 py-2 text-[13px] font-semibold rounded-[10px] border-none cursor-pointer transition-all ${
              tab === "correlation"
                ? "bg-navy text-white"
                : "bg-surface text-text-tertiary hover:text-text-secondary"
            }`}
          >
            🔗 가격 연동성
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-auto px-6 pb-6 pt-4">

          {/* ===== 가격 비교 탭 ===== */}
          {tab === "price" && (
            <>
              {/* 로딩 */}
              {loading && (
                <div className="space-y-4">
                  <div className="bg-surface rounded-[14px] p-5 animate-pulse">
                    <div className="h-4 bg-border rounded w-2/3 mb-3" />
                    <div className="h-6 bg-border rounded w-1/2 mb-2" />
                    <div className="h-3 bg-border rounded w-3/4" />
                  </div>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="h-4 bg-border rounded w-6" />
                      <div className="h-4 bg-border rounded flex-1" />
                      <div className="h-4 bg-border rounded w-16" />
                      <div className="h-4 bg-border rounded w-16" />
                    </div>
                  ))}
                </div>
              )}

              {/* 에러 */}
              {error && (
                <div className="flex flex-col items-center justify-center py-16">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" className="mb-3">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <p className="text-[13px] text-text-tertiary text-center m-0">{error}</p>
                </div>
              )}

              {/* 데이터 */}
              {!loading && !error && data && (
                <>
                  {/* 요약 카드 */}
                  <div className="bg-surface rounded-[14px] p-5 mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-medium text-text-tertiary">
                        {BRAND_LABELS[data.baseStation.brand] || data.baseStation.brand}
                      </span>
                    </div>
                    <h3 className="text-[15px] font-bold text-text-primary m-0 mb-2">
                      {data.baseStation.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-[13px] text-text-secondary">
                        5km 내 <span className="font-bold text-text-primary">{data.stats.total_count}개</span> 주유소 중
                      </span>
                      <span className="text-[13px]">
                        {fuelType === "gasoline" ? "휘발유" : "경유"}{" "}
                        <span className="font-bold text-emerald">{rank != null ? `${rank}위` : "-"}</span>
                      </span>
                    </div>
                    {avgDiff != null && (
                      <div className="mt-2">
                        <span className={`text-[14px] font-bold ${avgDiff < 0 ? "text-[#2563EB]" : avgDiff > 0 ? "text-[#DC2626]" : "text-text-secondary"}`}>
                          평균보다 {avgDiff < 0 ? `${Math.abs(avgDiff)}원 저렴` : avgDiff > 0 ? `${avgDiff}원 비쌈` : "동일"}
                        </span>
                        <span className="text-[11px] text-text-tertiary ml-2">(평균 {avgPrice?.toLocaleString()}원)</span>
                      </div>
                    )}
                  </div>

                  {/* 테이블 */}
                  <div className="overflow-x-auto -mx-6 px-6">
                    <table className="w-full text-[12px] border-collapse min-w-[520px]">
                      <thead>
                        <tr className="text-text-tertiary text-left">
                          <th className="font-medium py-2 pr-2 w-8">#</th>
                          <th className="font-medium py-2 pr-2">주유소명</th>
                          <th className="font-medium py-2 pr-2 w-16">브랜드</th>
                          <th className="font-medium py-2 pr-2 w-16 cursor-pointer select-none hover:text-text-primary transition-colors" onClick={() => setSortKey(sortKey === "distance" ? "price" : "distance")}>
                            거리{sortKey === "distance" && <span className="ml-0.5 text-emerald">▼</span>}
                          </th>
                          <th className="font-medium py-2 pr-2 w-16 text-right cursor-pointer select-none hover:text-text-primary transition-colors" onClick={() => setSortKey(sortKey === "price" ? "distance" : "price")}>
                            {fuelType === "gasoline" ? "휘발유" : "경유"}{sortKey === "price" && <span className="ml-0.5 text-emerald">▼</span>}
                          </th>
                          <th className="font-medium py-2 w-16 text-right">차이</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-emerald/5 font-semibold border-b border-border">
                          <td className="py-2.5 pr-2 text-emerald">★</td>
                          <td className="py-2.5 pr-2 text-text-primary truncate max-w-[180px]">{data.baseStation.name}</td>
                          <td className="py-2.5 pr-2 text-text-tertiary text-[11px]">{BRAND_LABELS[data.baseStation.brand]?.slice(0, 4) || data.baseStation.brand}</td>
                          <td className="py-2.5 pr-2 text-text-tertiary">-</td>
                          <td className="py-2.5 pr-2 text-right text-text-primary">{basePrice != null ? basePrice.toLocaleString() : "-"}</td>
                          <td className="py-2.5 text-right text-text-tertiary">기준</td>
                        </tr>
                        {sortedCompetitors.map((c, i) => {
                          const price = fuelType === "gasoline" ? c.gasoline_price : c.diesel_price;
                          const diff = fuelType === "gasoline" ? c.gasoline_diff : c.diesel_diff;
                          return (
                            <tr key={c.id} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                              <td className="py-2.5 pr-2 text-text-tertiary">{i + 1}</td>
                              <td className="py-2.5 pr-2 text-text-primary truncate max-w-[180px]">{c.name}</td>
                              <td className="py-2.5 pr-2 text-text-tertiary text-[11px]">{BRAND_LABELS[c.brand]?.slice(0, 4) || c.brand}</td>
                              <td className="py-2.5 pr-2 text-text-secondary">{c.distance_km}km</td>
                              <td className="py-2.5 pr-2 text-right text-text-primary">{price != null ? price.toLocaleString() : "-"}</td>
                              <td className="py-2.5 text-right font-medium">
                                {diff != null ? (
                                  <span className={diff > 0 ? "text-[#DC2626]" : diff < 0 ? "text-[#2563EB]" : "text-text-tertiary"}>
                                    {diff > 0 ? `+${diff}` : diff}
                                  </span>
                                ) : <span className="text-text-tertiary">-</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 유종 토글 */}
                  <div className="flex items-center justify-center gap-1 mt-5 bg-surface rounded-[10px] p-1 w-fit mx-auto">
                    <button onClick={() => setFuelType("gasoline")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${fuelType === "gasoline" ? "bg-white text-text-primary shadow-sm" : "bg-transparent text-text-tertiary hover:text-text-secondary"}`}>
                      휘발유
                    </button>
                    <button onClick={() => setFuelType("diesel")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${fuelType === "diesel" ? "bg-white text-text-primary shadow-sm" : "bg-transparent text-text-tertiary hover:text-text-secondary"}`}>
                      경유
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== 가격 연동성 탭 ===== */}
          {tab === "correlation" && (
            <>
              {/* 로딩 */}
              {corrLoading && (
                <div className="space-y-4">
                  <div className="bg-surface rounded-[14px] p-5 animate-pulse">
                    <div className="h-4 bg-border rounded w-1/2 mb-3" />
                    <div className="h-3 bg-border rounded w-2/3" />
                  </div>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="h-4 bg-border rounded flex-1" />
                      <div className="h-4 bg-border rounded w-20" />
                      <div className="h-4 bg-border rounded w-24" />
                    </div>
                  ))}
                </div>
              )}

              {/* 에러 */}
              {corrError && (
                <div className="flex flex-col items-center justify-center py-16">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" className="mb-3">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <p className="text-[13px] text-text-tertiary text-center m-0">{corrError}</p>
                </div>
              )}

              {/* 데이터 */}
              {!corrLoading && !corrError && corrData && (
                <>
                  {/* 신뢰도 + 기간 안내 */}
                  <div className="mb-4">
                    {corrData.reliability === "low" && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3">
                        <span className="text-[13px] leading-relaxed text-amber-800">
                          ⚠️ 데이터 부족 ({corrData.dataPoints}일) — 2주 이상 쌓이면 정확도 향상
                        </span>
                      </div>
                    )}
                    {corrData.reliability === "medium" && (
                      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-[12px] px-4 py-3">
                        <span className="text-[13px] leading-relaxed text-blue-800">
                          📊 보통 신뢰도 ({corrData.dataPoints}일)
                        </span>
                      </div>
                    )}
                    {corrData.reliability === "high" && (
                      <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-[12px] px-4 py-3">
                        <span className="text-[13px] leading-relaxed text-emerald-800">
                          ✅ 높은 신뢰도 ({corrData.dataPoints}일)
                        </span>
                      </div>
                    )}
                    {corrData.dateRange.from && corrData.dateRange.to && (
                      <p className="text-[11px] text-text-tertiary mt-2 m-0">
                        수집 기간: {corrData.dateRange.from} ~ {corrData.dateRange.to}
                      </p>
                    )}
                  </div>

                  {/* 연동성 테이블 */}
                  <div className="overflow-x-auto -mx-6 px-6">
                    <table className="w-full text-[12px] border-collapse min-w-[520px]">
                      <thead>
                        <tr className="text-text-tertiary text-left">
                          <th className="font-medium py-2 pr-2">주유소명</th>
                          <th className="font-medium py-2 pr-2 w-16">브랜드</th>
                          <th
                            className="font-medium py-2 pr-2 w-14 cursor-pointer select-none hover:text-text-primary transition-colors"
                            onClick={() => setCorrSortKey(corrSortKey === "distance" ? "correlation" : "distance")}
                          >
                            거리{corrSortKey === "distance" && <span className="ml-0.5 text-emerald">▼</span>}
                          </th>
                          <th
                            className="font-medium py-2 pr-2 w-[180px] cursor-pointer select-none hover:text-text-primary transition-colors"
                            onClick={() => setCorrSortKey(corrSortKey === "correlation" ? "distance" : "correlation")}
                          >
                            연동성{corrSortKey === "correlation" && <span className="ml-0.5 text-emerald">▼</span>}
                          </th>
                          <th className="font-medium py-2 w-16 text-right">현재가</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedCorrelations.map((c) => {
                          const corr = fuelType === "gasoline" ? c.gasoline_correlation : c.diesel_correlation;
                          const price = fuelType === "gasoline" ? c.gasoline_price : c.diesel_price;
                          return (
                            <tr key={c.id} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                              <td className="py-2.5 pr-2 text-text-primary truncate max-w-[160px]">{c.name}</td>
                              <td className="py-2.5 pr-2 text-text-tertiary text-[11px]">{BRAND_LABELS[c.brand]?.slice(0, 4) || c.brand}</td>
                              <td className="py-2.5 pr-2 text-text-secondary">{c.distance_km}km</td>
                              <td className="py-2.5 pr-2">
                                <CorrelationBar value={corr} />
                              </td>
                              <td className="py-2.5 text-right text-text-primary">
                                {price != null ? price.toLocaleString() : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 유종 토글 + 해석 텍스트 */}
                  <div className="flex items-center justify-center gap-1 mt-5 bg-surface rounded-[10px] p-1 w-fit mx-auto">
                    <button onClick={() => setFuelType("gasoline")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${fuelType === "gasoline" ? "bg-white text-text-primary shadow-sm" : "bg-transparent text-text-tertiary hover:text-text-secondary"}`}>
                      휘발유
                    </button>
                    <button onClick={() => setFuelType("diesel")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${fuelType === "diesel" ? "bg-white text-text-primary shadow-sm" : "bg-transparent text-text-tertiary hover:text-text-secondary"}`}>
                      경유
                    </button>
                  </div>
                  <p className="text-[11px] text-text-tertiary text-center mt-3 m-0">
                    연동성이 높은 주유소는 가격을 함께 올리고 내리는 경향이 있습니다.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
