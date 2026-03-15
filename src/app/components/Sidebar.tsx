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
  { value: 5000, label: "5km" },
  { value: 10000, label: "10km" },
  { value: 15000, label: "15km" },
  { value: 20000, label: "20km" },
] as const;

const BRAND_OPTIONS = [
  { code: "SKE", label: "SK에너지", color: "#f42a2a" },
  { code: "GSC", label: "GS칼텍스", color: "#00a651" },
  { code: "HDO", label: "HD현대오일", color: "#0066b3" },
  { code: "SOL", label: "S-OIL", color: "#ffd200" },
  { code: "RTO", label: "자영알뜰", color: "#ff8c00" },
  { code: "NHO", label: "농협알뜰", color: "#006838" },
  { code: "ETC", label: "기타", color: "#6b7280" },
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
  const [sheetHeight, setSheetHeight] = useState<"collapsed" | "half" | "full">(
    "collapsed"
  );

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleBrand = (code: string) => {
    const next = new Set(filters.brands);
    if (next.has(code)) {
      next.delete(code);
    } else {
      next.add(code);
    }
    onFiltersChange({ ...filters, brands: next });
  };

  const selectAllBrands = () => {
    onFiltersChange({
      ...filters,
      brands: new Set(BRAND_OPTIONS.map((b) => b.code)),
    });
  };

  const deselectAllBrands = () => {
    onFiltersChange({ ...filters, brands: new Set() });
  };

  const filtered =
    filters.brands.size === 0
      ? stations
      : stations.filter((s) => filters.brands.has(s.brand));
  const sorted = [...filtered].sort((a, b) => a.price - b.price);

  // ── 유종 선택 (탭 버튼 그룹) ──
  const prodTabs = (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {PROD_OPTIONS.map((p) => (
        <button
          key={p.code}
          onClick={() => onFiltersChange({ ...filters, prodCd: p.code })}
          className={`flex-1 py-2 text-[12px] font-semibold rounded-md transition-all ${
            filters.prodCd === p.code
              ? "bg-navy text-white shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  // ── 반경 선택 ──
  const radiusSelector = (
    <div className="flex gap-1.5">
      {RADIUS_OPTIONS.map((r) => (
        <button
          key={r.value}
          onClick={() => onFiltersChange({ ...filters, radius: r.value })}
          className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all ${
            filters.radius === r.value
              ? "bg-accent-orange text-white"
              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  // ── 브랜드 필터 ──
  const brandFilter = (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">브랜드</span>
        <div className="flex gap-2">
          <button onClick={selectAllBrands} className="text-[10px] text-blue-500 hover:text-blue-700 font-medium">
            전체
          </button>
          <button onClick={deselectAllBrands} className="text-[10px] text-gray-400 hover:text-gray-600 font-medium">
            해제
          </button>
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {BRAND_OPTIONS.map((b) => (
          <button
            key={b.code}
            onClick={() => toggleBrand(b.code)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              filters.brands.has(b.code)
                ? "bg-navy/10 text-navy border border-navy/20"
                : "bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: filters.brands.has(b.code) ? b.color : "#d1d5db" }}
            />
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── TOP 5 ──
  const topSection = topStations.length > 0 && myLocation && (
    <div className="border-b border-gray-100">
      <div className="px-4 py-2.5 bg-accent-orange/5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-bold text-accent-orange uppercase tracking-wider flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            내 주변 최저가 TOP 5
          </h3>
          <span className="text-[10px] text-gray-400">반경 {filters.radius / 1000}km</span>
        </div>
      </div>
      {topStations.map((s, i) => (
        <div
          key={s.id}
          onClick={() => onStationClick(s)}
          className={`px-4 py-2.5 cursor-pointer transition-colors hover:bg-accent-orange/5 flex items-center gap-3 ${
            s.id === selectedStationId ? "bg-accent-orange/5" : ""
          }`}
        >
          <span
            className={`text-[13px] font-bold shrink-0 w-5 text-center ${
              i === 0
                ? "text-accent-orange"
                : i <= 2
                  ? "text-gray-400"
                  : "text-gray-300"
            }`}
          >
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-gray-800 truncate">{s.name}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {BRAND_LABELS[s.brand] || s.brand}
              {" · "}
              {s.distance >= 1000
                ? `${(s.distance / 1000).toFixed(1)}km`
                : `${Math.round(s.distance)}m`}
            </p>
          </div>
          <p className="text-[14px] font-bold text-navy shrink-0">
            {s.price.toLocaleString()}
            <span className="text-[10px] font-normal text-gray-400 ml-0.5">원</span>
          </p>
        </div>
      ))}
    </div>
  );

  // ── 필터 패널 ──
  const filterPanel = (
    <div className="px-4 py-3 border-b border-gray-100 space-y-3">
      {prodTabs}
      {radiusSelector}
      {brandFilter}
    </div>
  );

  // ── 모바일: 하단 시트 ──
  if (isMobile) {
    const heightClass =
      sheetHeight === "full"
        ? "h-[80vh]"
        : sheetHeight === "half"
          ? "h-[45vh]"
          : "h-[100px]";

    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-[1000] bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.12)] transition-all duration-300 ${heightClass}`}
      >
        {/* 핸들 */}
        <div
          className="flex justify-center pt-2.5 pb-1 cursor-pointer"
          onClick={() =>
            setSheetHeight((h) =>
              h === "collapsed" ? "half" : h === "half" ? "full" : "collapsed"
            )
          }
        >
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* 모바일 헤더 */}
        <div className="px-4 py-2 flex justify-between items-center">
          <div>
            <h2 className="text-[14px] font-bold text-gray-900">
              주유소 <span className="text-accent-orange">{sorted.length}</span>개
            </h2>
          </div>
          {/* 유종 미니 탭 */}
          <div className="flex bg-gray-100 rounded-md p-0.5">
            {PROD_OPTIONS.map((p) => (
              <button
                key={p.code}
                onClick={() => onFiltersChange({ ...filters, prodCd: p.code })}
                className={`px-2 py-1 text-[10px] font-semibold rounded transition-all ${
                  filters.prodCd === p.code
                    ? "bg-navy text-white"
                    : "text-gray-400"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {sheetHeight !== "collapsed" && (
          <div className="overflow-y-auto" style={{ height: "calc(100% - 80px)" }}>
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
              <p className="p-8 text-[13px] text-gray-400 text-center">
                {stations.length > 0
                  ? "필터 조건에 맞는 주유소가 없습니다"
                  : "지도를 확대하면 주유소가 표시됩니다"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── 데스크톱: 왼쪽 사이드바 ──
  return (
    <>
      {/* 토글 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-3 z-[1001] bg-white shadow-lg rounded-lg px-2.5 py-2 text-[13px] font-medium text-gray-600 hover:bg-gray-50 transition-all border border-gray-200"
        style={{ left: isOpen ? 360 : 16 }}
      >
        {isOpen ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        ) : (
          <div className="flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span>목록</span>
          </div>
        )}
      </button>

      {/* 사이드바 */}
      <div
        className={`fixed top-0 left-0 h-full bg-white shadow-[4px_0_16px_rgba(0,0,0,0.08)] z-[1000] transition-transform duration-300 flex flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ width: 350 }}
      >
        {/* 사이드바 헤더 */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 shrink-0">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className="text-[16px] font-bold text-gray-900">주유소 목록</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {sorted.length > 0
                  ? `${sorted.length}개 · 가격순 정렬`
                  : "지도를 확대하면 주유소가 표시됩니다"}
              </p>
            </div>
          </div>
        </div>

        {/* 필터 패널 - 항상 표시 */}
        {filterPanel}

        {/* TOP 5 */}
        {topSection}

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
            <p className="p-8 text-[13px] text-gray-400 text-center">
              필터 조건에 맞는 주유소가 없습니다
            </p>
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
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors hover:bg-blue-50/50 ${
        isSelected ? "bg-blue-50/70 border-l-[3px] border-l-navy" : ""
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-[13px] font-semibold text-gray-800 truncate">
            {station.name}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">{brandLabel}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[15px] font-bold text-navy">
            {station.price.toLocaleString()}
          </p>
          <p className="text-[10px] text-gray-400">원/L</p>
        </div>
      </div>
      {station.distance > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">
          {station.distance >= 1000
            ? `${(station.distance / 1000).toFixed(1)}km`
            : `${Math.round(station.distance)}m`}
        </p>
      )}
    </div>
  );
}
