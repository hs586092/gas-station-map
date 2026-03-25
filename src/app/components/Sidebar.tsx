"use client";

import { useState, useEffect } from "react";

export interface Station {
  id: string;
  name: string;
  brand: string;
  price: number;
  distance: number;
  lat: number;
  lng: number;
}

export interface Filters {
  prodCd: string;
  brands: Set<string>;
  radius: number;
}

const RADIUS_OPTIONS = [
  { value: 3000, label: "3km" },
  { value: 5000, label: "5km" },
  { value: 10000, label: "10km" },
  { value: 20000, label: "20km" },
] as const;

const BRAND_OPTIONS = [
  { code: "SKE", label: "SK", color: "#f42a2a" },
  { code: "GSC", label: "GS", color: "#00a651" },
  { code: "HDO", label: "현대", color: "#0066b3" },
  { code: "SOL", label: "S-OIL", color: "#ffd200" },
  { code: "RTO", label: "알뜰", color: "#ff8c00" },
  { code: "NHO", label: "농협", color: "#006838" },
  { code: "ETC", label: "기타", color: "#9BA8B7" },
] as const;

const PROD_OPTIONS = [
  { code: "B027", label: "휘발유" },
  { code: "D047", label: "경유" },
  { code: "B034", label: "고급휘발유" },
] as const;

export const BRAND_LABELS: Record<string, string> = {
  SKE: "SK에너지",
  GSC: "GS칼텍스",
  HDO: "HD현대오일뱅크",
  SOL: "S-OIL",
  RTO: "자영알뜰",
  RTX: "고속도로알뜰",
  NHO: "농협알뜰",
  ETC: "자가상표",
  E1G: "E1",
  SKG: "SK가스",
};

interface SidebarProps {
  stations: Station[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onStationClick: (station: Station) => void;
  selectedStationId: string | null;
  topStations: Station[];
  myLocation: { lat: number; lng: number } | null;
}

export default function Sidebar({
  stations,
  filters,
  onFiltersChange,
  onStationClick,
  selectedStationId,
  topStations,
  myLocation,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetHeight, setSheetHeight] = useState<"collapsed" | "half" | "full">("collapsed");

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleBrand = (code: string) => {
    const next = new Set(filters.brands);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onFiltersChange({ ...filters, brands: next });
  };

  const filtered =
    filters.brands.size === 0
      ? stations
      : stations.filter((s) => filters.brands.has(s.brand));
  const sorted = [...filtered].sort((a, b) => a.price - b.price);

  const lowestPrice = topStations.length > 0 ? topStations[0].price : null;

  // ── 유종 탭 ──
  const prodTabs = (
    <div className="flex rounded-[10px] bg-surface p-[3px]">
      {PROD_OPTIONS.map((p) => (
        <button
          key={p.code}
          onClick={() => onFiltersChange({ ...filters, prodCd: p.code })}
          className={`flex-1 py-[7px] text-[12px] font-semibold rounded-[8px] border-none cursor-pointer transition-all ${
            filters.prodCd === p.code
              ? "bg-white text-text-primary shadow-sm"
              : "text-text-tertiary hover:text-text-secondary bg-transparent"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  // ── 필터 칩 (반경 + 브랜드 2줄) ──
  const filterChips = (
    <div className="space-y-1.5">
      {/* 반경 */}
      <div className="flex gap-1.5">
        {RADIUS_OPTIONS.map((r) => (
          <button
            key={r.value}
            onClick={() => onFiltersChange({ ...filters, radius: r.value })}
            className={`flex-1 h-[30px] text-[11px] font-medium rounded-full border cursor-pointer transition-all ${
              filters.radius === r.value
                ? "bg-navy text-white border-navy"
                : "bg-white text-text-secondary border-border hover:border-text-tertiary"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {/* 브랜드 */}
      <div className="flex gap-1.5 flex-wrap">
        {BRAND_OPTIONS.map((b) => (
          <button
            key={b.code}
            onClick={() => toggleBrand(b.code)}
            className={`h-[30px] px-2.5 text-[11px] font-medium rounded-full border cursor-pointer transition-all flex items-center gap-1 ${
              filters.brands.has(b.code)
                ? "bg-white text-text-primary border-text-tertiary"
                : "bg-white text-text-tertiary border-border hover:border-text-tertiary opacity-50"
            }`}
          >
            <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: b.color }} />
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── TOP 5 ──
  const topSection = topStations.length > 0 && myLocation && (
    <div className="mx-4 mb-3">
      <div className="bg-emerald-light/50 rounded-[12px] overflow-hidden border border-emerald/10">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] font-bold text-emerald flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            내 주변 최저가
          </span>
          <span className="text-[10px] text-text-tertiary">{filters.radius / 1000}km</span>
        </div>
        {topStations.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onStationClick(s)}
            className={`px-3 py-2 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-emerald/5 ${
              s.id === selectedStationId ? "bg-emerald/5" : ""
            }`}
          >
            <span className={`text-[12px] font-bold w-4 text-center shrink-0 ${
              i === 0 ? "text-emerald" : "text-text-tertiary"
            }`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-text-primary truncate m-0">{s.name}</p>
              <p className="text-[10px] text-text-tertiary m-0 mt-px">
                {BRAND_LABELS[s.brand] || s.brand} · {s.distance >= 1000 ? `${(s.distance / 1000).toFixed(1)}km` : `${Math.round(s.distance)}m`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-[13px] font-bold m-0 ${i === 0 ? "text-emerald" : "text-text-primary"}`}>
                {s.price.toLocaleString()}
              </p>
              <p className="text-[9px] text-text-tertiary m-0">원/L</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 모바일: 바텀 시트 ──
  if (isMobile) {
    const heightClass =
      sheetHeight === "full" ? "h-[85vh]"
        : sheetHeight === "half" ? "h-[45vh]"
        : "h-[72px]";

    return (
      <div className={`fixed bottom-0 left-0 right-0 z-[1000] bg-white rounded-t-[20px] transition-all duration-300 ${heightClass}`} style={{ boxShadow: "0 -4px 24px rgba(0,0,0,0.1)" }}>
        {/* 드래그 핸들 */}
        <div
          className="flex justify-center pt-[10px] pb-1 cursor-pointer"
          onClick={() => setSheetHeight((h) => h === "collapsed" ? "half" : h === "half" ? "full" : "collapsed")}
        >
          <div className="w-9 h-[3px] bg-gray-300 rounded-full" />
        </div>

        {/* 접힌 상태: 요약 */}
        {sheetHeight === "collapsed" && (
          <div className="px-4 py-1 flex items-center justify-between">
            <div>
              <span className="text-[14px] font-bold text-text-primary">
                내 주변 최저가{" "}
                {lowestPrice && <span className="text-emerald">{lowestPrice.toLocaleString()}원</span>}
              </span>
            </div>
            <div className="flex rounded-[8px] bg-surface p-[2px]">
              {PROD_OPTIONS.map((p) => (
                <button
                  key={p.code}
                  onClick={(e) => { e.stopPropagation(); onFiltersChange({ ...filters, prodCd: p.code }); }}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-[6px] border-none cursor-pointer ${
                    filters.prodCd === p.code ? "bg-white text-text-primary shadow-sm" : "text-text-tertiary bg-transparent"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {sheetHeight !== "collapsed" && (
          <div className="flex flex-col overflow-hidden" style={{ height: "calc(100% - 30px)" }}>
            {/* 필터 */}
            <div className="px-4 py-2 space-y-2 shrink-0">
              {prodTabs}
              {filterChips}
            </div>

            {/* 목록 */}
            <div className="overflow-y-auto flex-1">
              {topSection}
              {sorted.map((s) => (
                <StationItem
                  key={s.id}
                  station={s}
                  brandLabel={BRAND_LABELS[s.brand] || s.brand}
                  isSelected={s.id === selectedStationId}
                  onClick={() => onStationClick(s)}
                />
              ))}
              {sorted.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" className="mb-3">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <p className="text-[13px] text-text-tertiary m-0">
                    {stations.length > 0 ? "필터 조건에 맞는 주유소가 없습니다" : "지도를 확대하면 주유소가 표시됩니다"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 데스크톱: 왼쪽 사이드바 ──
  return (
    <>
      {/* 토글 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-[72px] z-[1001] bg-white border border-border rounded-lg w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-surface transition-colors"
        style={{
          left: isOpen ? "calc(var(--sidebar-width) + 4px)" : 12,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7A8D" strokeWidth="2">
          <path d={isOpen ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
        </svg>
      </button>

      <div
        className={`fixed top-[56px] left-0 bg-white z-[1000] flex flex-col transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          width: "var(--sidebar-width)",
          height: "calc(100vh - 56px)",
          boxShadow: "var(--shadow-lg)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* 필터 영역 */}
        <div className="px-4 pt-4 pb-3 space-y-2.5 shrink-0 border-b border-border">
          {prodTabs}
          {filterChips}
        </div>

        {/* TOP 5 */}
        <div className="pt-3 shrink-0">
          {topSection}
        </div>

        {/* 목록 헤더 */}
        <div className="px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-[12px] font-medium text-text-tertiary">
            {sorted.length > 0 ? `${sorted.length}개 주유소 · 가격순` : "주유소를 검색해보세요"}
          </span>
        </div>

        {/* 목록 */}
        <div className="overflow-y-auto flex-1">
          {sorted.map((s) => (
            <StationItem
              key={s.id}
              station={s}
              brandLabel={BRAND_LABELS[s.brand] || s.brand}
              isSelected={s.id === selectedStationId}
              onClick={() => onStationClick(s)}
            />
          ))}
          {sorted.length === 0 && stations.length > 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" className="mb-3">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              <p className="text-[13px] text-text-tertiary m-0">필터 조건에 맞는 주유소가 없습니다</p>
            </div>
          )}
        </div>

      </div>
    </>
  );
}

function StationItem({
  station,
  brandLabel,
  isSelected,
  onClick,
}: {
  station: Station;
  brandLabel: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const brandColor = {
    SKE: "#f42a2a", GSC: "#00a651", HDO: "#0066b3", SOL: "#ffd200",
    RTO: "#ff8c00", NHO: "#006838", ETC: "#9BA8B7",
  }[station.brand] || "#9BA8B7";

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 cursor-pointer transition-all hover:bg-surface/70 ${
        isSelected ? "bg-emerald/5 border-l-[3px] border-l-emerald" : "border-l-[3px] border-l-transparent"
      }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: brandColor }} />
            <p className="text-[13px] font-semibold text-text-primary truncate m-0">{station.name}</p>
          </div>
          <p className="text-[11px] text-text-tertiary m-0 ml-[13px]">
            {brandLabel}
            {station.distance > 0 && (
              <> · {station.distance >= 1000 ? `${(station.distance / 1000).toFixed(1)}km` : `${Math.round(station.distance)}m`}</>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[15px] font-bold text-text-primary m-0">
            {station.price.toLocaleString()}
          </p>
          <p className="text-[10px] text-text-tertiary m-0">원/L</p>
        </div>
      </div>
    </div>
  );
}
