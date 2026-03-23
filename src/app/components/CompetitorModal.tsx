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

type SortKey = "distance" | "price";
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

export default function CompetitorModal({
  stationId,
  stationName,
  isOpen,
  onClose,
}: CompetitorModalProps) {
  const [data, setData] = useState<CompetitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("distance");
  const [fuelType, setFuelType] = useState<FuelType>("gasoline");

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/stations/${stationId}/competitors`)
      .then((res) => {
        if (!res.ok) throw new Error("API 오류");
        return res.json();
      })
      .then((json) => setData(json))
      .catch(() => setError("경쟁사 데이터를 불러오는데 실패했습니다."))
      .finally(() => setLoading(false));
  }, [stationId, isOpen]);

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

        {/* 본문 */}
        <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
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
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D1D5DB"
                strokeWidth="1.5"
                className="mb-3"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p className="text-[13px] text-text-tertiary text-center m-0">
                {error}
              </p>
            </div>
          )}

          {/* 데이터 */}
          {!loading && !error && data && (
            <>
              {/* 1) 상단 요약 카드 */}
              <div className="bg-surface rounded-[14px] p-5 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-medium text-text-tertiary">
                    {BRAND_LABELS[data.baseStation.brand] ||
                      data.baseStation.brand}
                  </span>
                </div>
                <h3 className="text-[15px] font-bold text-text-primary m-0 mb-2">
                  {data.baseStation.name}
                </h3>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="text-[13px] text-text-secondary">
                    5km 내{" "}
                    <span className="font-bold text-text-primary">
                      {data.stats.total_count}개
                    </span>{" "}
                    주유소 중
                  </span>
                  <span className="text-[13px]">
                    {fuelType === "gasoline" ? "휘발유" : "경유"}{" "}
                    <span className="font-bold text-emerald">
                      {rank != null ? `${rank}위` : "-"}
                    </span>
                  </span>
                </div>

                {avgDiff != null && (
                  <div className="mt-2">
                    <span
                      className={`text-[14px] font-bold ${
                        avgDiff < 0
                          ? "text-[#2563EB]"
                          : avgDiff > 0
                          ? "text-[#DC2626]"
                          : "text-text-secondary"
                      }`}
                    >
                      평균보다{" "}
                      {avgDiff < 0
                        ? `${Math.abs(avgDiff)}원 저렴`
                        : avgDiff > 0
                        ? `${avgDiff}원 비쌈`
                        : "동일"}
                    </span>
                    <span className="text-[11px] text-text-tertiary ml-2">
                      (평균 {avgPrice?.toLocaleString()}원)
                    </span>
                  </div>
                )}
              </div>

              {/* 2) 경쟁사 비교 테이블 */}
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-[12px] border-collapse min-w-[520px]">
                  <thead>
                    <tr className="text-text-tertiary text-left">
                      <th className="font-medium py-2 pr-2 w-8">#</th>
                      <th className="font-medium py-2 pr-2">주유소명</th>
                      <th className="font-medium py-2 pr-2 w-16">브랜드</th>
                      <th
                        className="font-medium py-2 pr-2 w-16 cursor-pointer select-none hover:text-text-primary transition-colors"
                        onClick={() =>
                          setSortKey(
                            sortKey === "distance" ? "price" : "distance"
                          )
                        }
                      >
                        거리
                        {sortKey === "distance" && (
                          <span className="ml-0.5 text-emerald">▼</span>
                        )}
                      </th>
                      <th
                        className="font-medium py-2 pr-2 w-16 text-right cursor-pointer select-none hover:text-text-primary transition-colors"
                        onClick={() =>
                          setSortKey(
                            sortKey === "price" ? "distance" : "price"
                          )
                        }
                      >
                        {fuelType === "gasoline" ? "휘발유" : "경유"}
                        {sortKey === "price" && (
                          <span className="ml-0.5 text-emerald">▼</span>
                        )}
                      </th>
                      <th className="font-medium py-2 w-16 text-right">
                        차이
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 기준 주유소 행 */}
                    <tr className="bg-emerald/5 font-semibold border-b border-border">
                      <td className="py-2.5 pr-2 text-emerald">★</td>
                      <td className="py-2.5 pr-2 text-text-primary truncate max-w-[180px]">
                        {data.baseStation.name}
                      </td>
                      <td className="py-2.5 pr-2 text-text-tertiary text-[11px]">
                        {BRAND_LABELS[data.baseStation.brand]?.slice(0, 4) ||
                          data.baseStation.brand}
                      </td>
                      <td className="py-2.5 pr-2 text-text-tertiary">-</td>
                      <td className="py-2.5 pr-2 text-right text-text-primary">
                        {basePrice != null
                          ? basePrice.toLocaleString()
                          : "-"}
                      </td>
                      <td className="py-2.5 text-right text-text-tertiary">
                        기준
                      </td>
                    </tr>

                    {/* 경쟁사 행 */}
                    {sortedCompetitors.map((c, i) => {
                      const price =
                        fuelType === "gasoline"
                          ? c.gasoline_price
                          : c.diesel_price;
                      const diff =
                        fuelType === "gasoline"
                          ? c.gasoline_diff
                          : c.diesel_diff;

                      return (
                        <tr
                          key={c.id}
                          className="border-b border-border/50 hover:bg-surface/50 transition-colors"
                        >
                          <td className="py-2.5 pr-2 text-text-tertiary">
                            {i + 1}
                          </td>
                          <td className="py-2.5 pr-2 text-text-primary truncate max-w-[180px]">
                            {c.name}
                          </td>
                          <td className="py-2.5 pr-2 text-text-tertiary text-[11px]">
                            {BRAND_LABELS[c.brand]?.slice(0, 4) || c.brand}
                          </td>
                          <td className="py-2.5 pr-2 text-text-secondary">
                            {c.distance_km}km
                          </td>
                          <td className="py-2.5 pr-2 text-right text-text-primary">
                            {price != null ? price.toLocaleString() : "-"}
                          </td>
                          <td className="py-2.5 text-right font-medium">
                            {diff != null ? (
                              <span
                                className={
                                  diff > 0
                                    ? "text-[#DC2626]"
                                    : diff < 0
                                    ? "text-[#2563EB]"
                                    : "text-text-tertiary"
                                }
                              >
                                {diff > 0 ? `+${diff}` : diff}
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

              {/* 3) 하단: 유종 선택 토글 */}
              <div className="flex items-center justify-center gap-1 mt-5 bg-surface rounded-[10px] p-1 w-fit mx-auto">
                <button
                  onClick={() => setFuelType("gasoline")}
                  className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${
                    fuelType === "gasoline"
                      ? "bg-white text-text-primary shadow-sm"
                      : "bg-transparent text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  휘발유
                </button>
                <button
                  onClick={() => setFuelType("diesel")}
                  className={`px-4 py-1.5 text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${
                    fuelType === "diesel"
                      ? "bg-white text-text-primary shadow-sm"
                      : "bg-transparent text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  경유
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
