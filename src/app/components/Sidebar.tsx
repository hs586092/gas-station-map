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
  radius: number; // meters
}

const RADIUS_OPTIONS = [
  { value: 5000, label: "5km" },
  { value: 10000, label: "10km" },
  { value: 15000, label: "15km" },
  { value: 20000, label: "20km" },
] as const;

const BRAND_OPTIONS = [
  { code: "SKE", label: "SK에너지" },
  { code: "GSC", label: "GS칼텍스" },
  { code: "HDO", label: "HD현대오일뱅크" },
  { code: "SOL", label: "S-OIL" },
  { code: "RTO", label: "자영알뜰" },
  { code: "NHO", label: "농협알뜰" },
  { code: "ETC", label: "기타" },
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
  const [showFilters, setShowFilters] = useState(false);

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

  // 브랜드 필터 적용된 목록
  const filtered =
    filters.brands.size === 0
      ? stations
      : stations.filter((s) => filters.brands.has(s.brand));
  const sorted = [...filtered].sort((a, b) => a.price - b.price);

  const topSection = topStations.length > 0 && myLocation && (
    <div className="border-b border-gray-200 bg-amber-50 shrink-0">
      <div className="px-4 py-2.5">
        <h3 className="text-xs font-bold text-amber-800 flex items-center gap-1">
          <span>🏆</span> 내 주변 최저가 TOP 5
          <span className="text-[10px] font-normal text-amber-600 ml-auto">반경 {filters.radius / 1000}km</span>
        </h3>
      </div>
      {topStations.map((s, i) => (
        <div
          key={s.id}
          onClick={() => onStationClick(s)}
          className={`px-4 py-2 cursor-pointer transition-colors hover:bg-amber-100 flex items-center gap-3 ${
            s.id === selectedStationId ? "bg-amber-100" : ""
          }`}
        >
          <span
            className={`text-sm font-bold shrink-0 w-5 text-center ${
              i === 0
                ? "text-amber-600"
                : i === 1
                  ? "text-gray-500"
                  : i === 2
                    ? "text-orange-700"
                    : "text-gray-400"
            }`}
          >
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-800 truncate">
              {s.name}
            </p>
            <p className="text-[10px] text-gray-500">
              {BRAND_LABELS[s.brand] || s.brand} ·{" "}
              {s.distance >= 1000
                ? `${(s.distance / 1000).toFixed(1)}km`
                : `${Math.round(s.distance)}m`}
            </p>
          </div>
          <p className="text-sm font-bold text-red-600 shrink-0">
            {s.price.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );

  const filterPanel = (
    <div className="border-b border-gray-200 bg-gray-50">
      {/* 유종 선택 */}
      <div className="px-4 py-3 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-600 mb-2">유종</p>
        <div className="flex gap-2 flex-wrap">
          {PROD_OPTIONS.map((p) => (
            <label
              key={p.code}
              className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                filters.prodCd === p.code
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
              }`}
            >
              <input
                type="radio"
                name="prodCd"
                value={p.code}
                checked={filters.prodCd === p.code}
                onChange={() => onFiltersChange({ ...filters, prodCd: p.code })}
                className="hidden"
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {/* 반경 선택 */}
      <div className="px-4 py-3 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-600 mb-2">검색 반경</p>
        <div className="flex gap-2 flex-wrap">
          {RADIUS_OPTIONS.map((r) => (
            <label
              key={r.value}
              className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                filters.radius === r.value
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-100"
              }`}
            >
              <input
                type="radio"
                name="radius"
                value={r.value}
                checked={filters.radius === r.value}
                onChange={() => onFiltersChange({ ...filters, radius: r.value })}
                className="hidden"
              />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      {/* 브랜드 필터 */}
      <div className="px-4 py-3">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs font-semibold text-gray-600">브랜드</p>
          <div className="flex gap-2">
            <button
              onClick={selectAllBrands}
              className="text-[10px] text-blue-500 hover:text-blue-700"
            >
              전체선택
            </button>
            <button
              onClick={deselectAllBrands}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              해제
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {BRAND_OPTIONS.map((b) => (
            <label
              key={b.code}
              className={`flex items-center px-2.5 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                filters.brands.has(b.code)
                  ? "bg-blue-100 text-blue-700 border border-blue-300"
                  : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-100"
              }`}
            >
              <input
                type="checkbox"
                checked={filters.brands.has(b.code)}
                onChange={() => toggleBrand(b.code)}
                className="hidden"
              />
              {b.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  // ── 모바일: 하단 시트 ──
  if (isMobile) {
    const heightClass =
      sheetHeight === "full"
        ? "h-[80vh]"
        : sheetHeight === "half"
          ? "h-[40vh]"
          : "h-[80px]";

    return (
      <div
        className={`fixed bottom-0 left-0 right-0 z-[1000] bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] transition-all duration-300 ${heightClass}`}
      >
        {/* 핸들 */}
        <div
          className="flex justify-center pt-2 pb-1 cursor-pointer"
          onClick={() =>
            setSheetHeight((h) =>
              h === "collapsed" ? "half" : h === "half" ? "full" : "collapsed"
            )
          }
        >
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* 헤더 */}
        <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-sm font-bold text-gray-800">
            주유소 {sorted.length}개
          </h2>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`text-xs px-2.5 py-1 rounded-full ${
              showFilters
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            필터
          </button>
        </div>

        {sheetHeight !== "collapsed" && (
          <>
            {showFilters && filterPanel}
            <div
              className="overflow-y-auto"
              style={{
                height: showFilters ? "calc(100% - 200px)" : "calc(100% - 60px)",
              }}
            >
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
                <p className="p-4 text-sm text-gray-400 text-center">
                  {stations.length > 0
                    ? "필터 조건에 맞는 주유소가 없습니다"
                    : "지도를 확대하면 주유소가 표시됩니다"}
                </p>
              )}
            </div>
          </>
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
        className="fixed top-4 left-4 z-[1001] bg-white shadow-lg rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all"
        style={{ left: isOpen ? 340 : 16 }}
      >
        {isOpen ? "◀" : "▶ 주유소 목록"}
      </button>

      {/* 사이드바 */}
      <div
        className={`fixed top-0 left-0 h-full bg-white shadow-xl z-[1000] transition-transform duration-300 flex flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ width: 320 }}
      >
        {/* 헤더 */}
        <div className="px-4 py-4 border-b border-gray-200 shrink-0">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">주유소 목록</h2>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                showFilters
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {showFilters ? "필터 닫기" : "필터"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {sorted.length > 0
              ? `${sorted.length}개 주유소 (가격순)`
              : "지도를 확대하면 주유소가 표시됩니다"}
          </p>
        </div>

        {/* 필터 패널 */}
        {showFilters && <div className="shrink-0">{filterPanel}</div>}

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
            <p className="p-4 text-sm text-gray-400 text-center">
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
      className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors hover:bg-blue-50 ${
        isSelected ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-sm font-semibold text-gray-800 truncate">
            {station.name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{brandLabel}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-red-600">
            {station.price.toLocaleString()}
          </p>
          <p className="text-[10px] text-gray-400">원/L</p>
        </div>
      </div>
      {station.distance > 0 && (
        <p className="text-[11px] text-gray-400 mt-1">
          {station.distance >= 1000
            ? `${(station.distance / 1000).toFixed(1)}km`
            : `${Math.round(station.distance)}m`}
        </p>
      )}
    </div>
  );
}
