"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import Sidebar, {
  type Station,
  type Filters,
  BRAND_LABELS,
} from "./Sidebar";
import PriceChart from "./PriceChart";
import OilPriceChart from "./OilPriceChart";
import CompetitorModal from "./CompetitorModal";
import AuthModal from "./AuthModal";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

interface StationDetail {
  id: string;
  name: string;
  brand: string;
  oldAddress: string;
  newAddress: string;
  tel: string;
  prices: { product: string; price: number }[];
  hasLpg?: boolean;
  hasCarWash?: boolean;
  hasCvs?: boolean;
  evNearby?: { fast: number; slow: number; stations: number; fastStations: number } | null;
}

const PROD_LABELS: Record<string, string> = {
  B027: "휘발유",
  B034: "고급휘발유",
  D047: "경유",
  K015: "LPG",
};

const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a",
  GSC: "#00a651",
  HDO: "#0066b3",
  SOL: "#ffd200",
  RTO: "#ff8c00",
  NHO: "#006838",
  ETC: "#6b7280",
};

const ALL_BRANDS = new Set([
  "SKE", "GSC", "HDO", "SOL", "RTO", "NHO", "ETC",
]);

// 도로 등급별 기본 제한속도 (km/h)
const DEFAULT_MAX_SPEED: Record<string, number> = {
  "101": 100, // 고속도로
  "102": 80,  // 도시고속
  "103": 60,  // 일반국도
  "104": 50,  // 특별/광역시도
  "105": 60,  // 국가지원지방도
  "106": 50,  // 지방도
};

const CONGESTION_COLORS = {
  smooth: "#22c55e",    // 원활 (초록)
  slow: "#eab308",      // 서행 (노랑)
  congested: "#ef4444", // 정체 (빨강)
  noData: "",           // 데이터 없음 (기본 테두리)
} as const;

type CongestionLevel = keyof typeof CONGESTION_COLORS;

function getCongestionLevel(station: Station): CongestionLevel {
  if (!station.roadSpeed || !station.roadRank || !station.roadSpeedUpdatedAt) {
    return "noData";
  }

  // 2시간 이상 경과한 데이터는 무효
  const updatedAt = new Date(station.roadSpeedUpdatedAt).getTime();
  if (Date.now() - updatedAt > 2 * 60 * 60 * 1000) {
    return "noData";
  }

  const maxSpeed = DEFAULT_MAX_SPEED[station.roadRank] || 50;
  const ratio = station.roadSpeed / maxSpeed;

  if (ratio >= 0.7) return "smooth";
  if (ratio >= 0.3) return "slow";
  return "congested";
}

function Header({ onLoginClick }: { onLoginClick: () => void }) {
  const { user, profile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "지도" },
    { href: "/community", label: "커뮤니티" },
    { href: "/population", label: "유동인구 분석" },
  ];

  return (
    <header className="h-[56px] bg-navy flex items-center gap-4 px-4 md:px-5 shrink-0 z-[1200] relative">
      {/* 로고 */}
      <Link href="/" className="flex items-center gap-2 no-underline shrink-0">
        <div className="w-7 h-7 bg-emerald rounded-lg flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
        </div>
        <span className="text-white text-[16px] font-bold tracking-tight hidden md:block">주유소맵</span>
      </Link>

      {/* 데스크톱 네비게이션 */}
      <nav className="hidden md:flex items-center gap-0.5 ml-1">
        {navItems.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 text-[13px] font-medium rounded-lg no-underline transition-colors ${
                isActive
                  ? "text-white bg-white/15"
                  : "text-gray-400 hover:text-white hover:bg-white/10"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* 중앙 검색바 (데스크톱) */}
      <div className="hidden md:flex flex-1 max-w-md mx-auto">
        <div className="relative w-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            type="text"
            placeholder="주유소명, 지역 검색"
            className="w-full h-[34px] pl-9 pr-3 bg-white/12 hover:bg-white/18 focus:bg-white/20 text-[13px] text-white placeholder-gray-400 rounded-lg border-none outline-none transition-colors"
          />
        </div>
      </div>

      {/* 오른쪽 영역 */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        {/* 모바일 커뮤니티 */}
        <Link href="/community" className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors no-underline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </Link>
        {/* 모바일 유동인구 분석 */}
        <Link href="/population" className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors no-underline">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2">
            <path d="M18 20V10M12 20V4M6 20v-6"/>
          </svg>
        </Link>

        {/* 프로필 / 로그인 */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-8 h-8 bg-emerald/20 text-emerald rounded-full flex items-center justify-center border-none cursor-pointer text-[13px] font-bold hover:bg-emerald/30 transition-colors"
            >
              {(profile?.nickname || "U")[0]}
            </button>
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-[1300]" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-[calc(100%+8px)] w-48 bg-white rounded-xl shadow-xl z-[1301] overflow-hidden border border-border">
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[13px] font-semibold text-text-primary m-0">{profile?.nickname || "사용자"}</p>
                    <p className="text-[11px] text-text-tertiary m-0 mt-0.5">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { signOut(); setShowUserMenu(false); }}
                    className="w-full px-4 py-2.5 text-[13px] text-left text-text-secondary hover:bg-surface bg-transparent border-none cursor-pointer transition-colors"
                  >
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={onLoginClick}
            className="h-8 px-4 text-[13px] font-semibold text-white bg-emerald hover:bg-emerald/90 rounded-lg border-none cursor-pointer transition-colors"
          >
            로그인
          </button>
        )}
      </div>
    </header>
  );
}

function MapContent() {
  const map = useMap();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [stationDetail, setStationDetail] = useState<StationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    prodCd: "B027",
    brands: new Set(ALL_BRANDS),
    radius: 5000,
    congestion: "all",
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [showChart, setShowChart] = useState<{ id: string; name: string } | null>(null);
  const [showCompetitor, setShowCompetitor] = useState<{ id: string; name: string } | null>(null);
  const [showOilChart, setShowOilChart] = useState(false);

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [topStations, setTopStations] = useState<Station[]>([]);
  const [locatingUser, setLocatingUser] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const heatmapLayerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  // EV 충전소 레이어
  const [showEvChargers, setShowEvChargers] = useState(false);
  const [evChargers, setEvChargers] = useState<{
    station_id: string;
    station_name: string;
    lat: number;
    lng: number;
    fast_count: number;
    slow_count: number;
    total_count: number;
    operator: string;
  }[]>([]);
  const [selectedEvCharger, setSelectedEvCharger] = useState<string | null>(null);

  // 유가 2주 시차 인사이트
  const [oilInsight, setOilInsight] = useState<{
    brentChange: number;
    direction: "up" | "down" | "flat";
    message: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/oil-prices?days=30")
      .then((r) => r.json())
      .then((d) => {
        if (!d.summary?.brentChange) return;
        const ch = d.summary.brentChange;
        const abs = Math.abs(ch).toFixed(1);
        if (ch >= 2) {
          setOilInsight({ brentChange: ch, direction: "up", message: `2주 전 유가 +$${abs} → 소매가 인상 가능성` });
        } else if (ch <= -2) {
          setOilInsight({ brentChange: ch, direction: "down", message: `2주 전 유가 -$${abs} → 소매가 인하 가능성` });
        } else {
          setOilInsight({ brentChange: ch, direction: "flat", message: `2주 전 유가 변동 적음 → 소매가 유지 예상` });
        }
      })
      .catch(() => {});
  }, []);

  const filteredStations = stations.filter((s) => {
    if (filters.brands.size > 0 && !filters.brands.has(s.brand)) return false;
    if (filters.congestion !== "all") {
      const level = getCongestionLevel(s);
      if (level !== filters.congestion) return false;
    }
    return true;
  });

  // 히트맵 레이어 토글
  useEffect(() => {
    if (!map) return;

    if (showHeatmap) {
      const prices = filteredStations.map(s => s.price).filter(p => p > 0);
      if (prices.length === 0) return;

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const range = maxPrice - minPrice || 1;

      const heatmapData = filteredStations
        .filter(s => s.price > 0)
        .map(s => ({
          location: new google.maps.LatLng(s.lat, s.lng),
          weight: 0.1 + ((s.price - minPrice) / range) * 0.9,
        }));

      if (heatmapLayerRef.current) {
        heatmapLayerRef.current.setMap(null);
      }

      heatmapLayerRef.current = new google.maps.visualization.HeatmapLayer({
        data: heatmapData,
        radius: 30,
        opacity: 0.7,
        gradient: [
          'rgba(0, 0, 255, 0)',
          'rgba(0, 100, 255, 0.6)',
          'rgba(0, 200, 100, 0.7)',
          'rgba(255, 255, 0, 0.8)',
          'rgba(255, 150, 0, 0.9)',
          'rgba(255, 0, 0, 1)',
        ],
      });
      heatmapLayerRef.current.setMap(map);
    } else if (heatmapLayerRef.current) {
      heatmapLayerRef.current.setMap(null);
      heatmapLayerRef.current = null;
    }
  }, [showHeatmap, filteredStations, map]);

  // EV 충전소 뷰포트 로드
  const fetchEvChargers = useCallback(() => {
    if (!map || !showEvChargers) return;
    const zoom = map.getZoom();
    if (!zoom || zoom < 13) {
      setEvChargers([]);
      return;
    }
    const bounds = map.getBounds();
    if (!bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    fetch(`/api/ev-chargers?minLat=${sw.lat()}&maxLat=${ne.lat()}&minLng=${sw.lng()}&maxLng=${ne.lng()}`)
      .then((r) => r.json())
      .then((d) => setEvChargers(d.chargers || []))
      .catch(() => {});
  }, [map, showEvChargers]);

  useEffect(() => {
    if (!showEvChargers) {
      setEvChargers([]);
      setSelectedEvCharger(null);
      return;
    }
    fetchEvChargers();
  }, [showEvChargers, fetchEvChargers]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) return;

    setLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMyLocation(loc);
        setLocatingUser(false);
      },
      () => {
        setLocatingUser(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const fetchTopStations = useCallback(async () => {
    if (!myLocation) return;

    try {
      const res = await fetch(
        `/api/stations?lat=${myLocation.lat}&lng=${myLocation.lng}&radius=${filtersRef.current.radius}&prodCd=${filtersRef.current.prodCd}`
      );
      const data = await res.json();
      const sorted = (data.stations || [])
        .sort((a: Station, b: Station) => a.price - b.price)
        .slice(0, 5);
      setTopStations(sorted);
    } catch (error) {
      console.error("TOP 5 조회 실패:", error);
    }
  }, [myLocation]);

  useEffect(() => {
    fetchTopStations();
  }, [fetchTopStations]);

  const goToMyLocation = useCallback(() => {
    if (myLocation && map) {
      map.panTo(myLocation);
      map.setZoom(14);
    } else {
      requestLocation();
    }
  }, [myLocation, map, requestLocation]);

  const fetchStations = useCallback(async () => {
    if (!map) return;

    const center = map.getCenter();
    const zoom = map.getZoom();
    if (!center || !zoom || zoom < 12) {
      setStations([]);
      return;
    }

    const radius = Math.min(5000, Math.round(50000 / Math.pow(2, zoom - 10)));
    const currentFilters = filtersRef.current;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/stations?lat=${center.lat()}&lng=${center.lng()}&radius=${radius}&prodCd=${currentFilters.prodCd}`
      );
      const data = await res.json();
      setStations(data.stations || []);
    } catch (error) {
      console.error("주유소 데이터 로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, [map]);

  const handleFiltersChange = useCallback(
    (newFilters: Filters) => {
      const prodChanged = newFilters.prodCd !== filters.prodCd;
      const radiusChanged = newFilters.radius !== filters.radius;
      setFilters(newFilters);
      if (prodChanged || radiusChanged) {
        setTimeout(() => {
          fetchStations();
          fetchTopStations();
        }, 0);
      }
    },
    [filters.prodCd, filters.radius, fetchStations, fetchTopStations]
  );

  const handleStationSelect = useCallback(
    async (station: Station) => {
      setSelectedStation(station);
      setStationDetail(null);

      if (map) {
        map.panTo({ lat: station.lat, lng: station.lng });
        const zoom = map.getZoom();
        if (zoom && zoom < 14) map.setZoom(14);
      }

      try {
        const res = await fetch(`/api/stations/${station.id}`);
        const data = await res.json();
        setStationDetail(data);
      } catch (error) {
        console.error("주유소 상세 조회 실패:", error);
      }
    },
    [map]
  );

  return (
    <>
      <Sidebar
        stations={stations}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onStationClick={handleStationSelect}
        selectedStationId={selectedStation?.id || null}
        topStations={topStations}
        myLocation={myLocation}
        onOilChartClick={() => setShowOilChart(true)}
      />

      <Map
        defaultCenter={{ lat: 36.5, lng: 127.5 }}
        defaultZoom={7}
        style={{ width: "100%", height: "100%" }}
        onIdle={() => {
          fetchStations();
          if (showEvChargers) fetchEvChargers();
        }}
        onClick={() => setSelectedStation(null)}
      >

        {/* 내 위치 마커 */}
        {myLocation && (
          <Marker
            position={myLocation}
            icon={{
              path: 0,
              scale: 7,
              fillColor: "#4285F4",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2.5,
            }}
          />
        )}

        {/* 주유소 마커 (히트맵 모드에서는 숨김) */}
        {!showHeatmap && filteredStations.map((station) => {
          const isSelected = selectedStation?.id === station.id;
          const brandColor = BRAND_COLORS[station.brand] || "#6b7280";
          const congestion = getCongestionLevel(station);
          const congestionColor = CONGESTION_COLORS[congestion];
          const hasTraffic = congestion !== "noData";

          // 혼잡도 데이터가 있으면 테두리 색상으로 표현
          const strokeColor = isSelected
            ? "none"
            : hasTraffic
              ? congestionColor
              : "rgba(0,0,0,0.08)";
          const strokeWidth = isSelected ? 0 : hasTraffic ? 2.5 : 1;
          const rectX = hasTraffic && !isSelected ? 1.25 : 0;
          const rectY = hasTraffic && !isSelected ? 1.25 : 0;
          const rectW = hasTraffic && !isSelected ? 57.5 : 60;
          const rectH = hasTraffic && !isSelected ? 21.5 : 24;

          return (
            <Marker
              key={station.id}
              position={{ lat: station.lat, lng: station.lng }}
              onClick={() => handleStationSelect(station)}
              label={{
                text: station.price.toLocaleString(),
                fontSize: "11px",
                fontWeight: "bold",
                color: isSelected ? "#00C073" : "#1B2838",
              }}
              icon={{
                url: `data:image/svg+xml,${encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="28">` +
                  `<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="12" fill="${isSelected ? '#1B2838' : 'white'}" ` +
                  `stroke="${strokeColor}" stroke-width="${strokeWidth}"/>` +
                  `<circle cx="10" cy="12" r="4" fill="${brandColor}"/>` +
                  `<polygon points="30,24 26,28 34,28" fill="${isSelected ? '#1B2838' : 'white'}"/>` +
                  `</svg>`
                )}`,
                scaledSize: new google.maps.Size(60, 28),
                anchor: new google.maps.Point(30, 28),
                labelOrigin: new google.maps.Point(36, 12),
              }}
            />
          );
        })}

        {/* EV 충전소 마커 */}
        {showEvChargers && evChargers.map((ev) => (
          <Marker
            key={ev.station_id}
            position={{ lat: ev.lat, lng: ev.lng }}
            onClick={() => setSelectedEvCharger(ev.station_id === selectedEvCharger ? null : ev.station_id)}
            icon={{
              url: `data:image/svg+xml,${encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
                `<circle cx="12" cy="12" r="11" fill="#ef4444" stroke="white" stroke-width="2"/>` +
                `<path d="M13 5L7 13h5l-1 6 6-8h-5l1-6z" fill="white"/>` +
                `</svg>`
              )}`,
              scaledSize: new google.maps.Size(24, 24),
              anchor: new google.maps.Point(12, 12),
            }}
            zIndex={10}
          />
        ))}

        {/* EV 충전소 InfoWindow */}
        {showEvChargers && selectedEvCharger && (() => {
          const ev = evChargers.find((e) => e.station_id === selectedEvCharger);
          if (!ev) return null;
          return (
            <InfoWindow
              position={{ lat: ev.lat, lng: ev.lng }}
              onCloseClick={() => setSelectedEvCharger(null)}
            >
              <div style={{ minWidth: 180, padding: 0 }}>
                <div className="font-semibold text-[13px] text-gray-900 mb-1">{ev.station_name}</div>
                <div className="flex gap-3 mb-1">
                  <span className="text-[12px] text-orange-600 font-medium">급속 {ev.fast_count}대</span>
                  {ev.slow_count > 0 && (
                    <span className="text-[12px] text-gray-500">완속 {ev.slow_count}대</span>
                  )}
                </div>
                {ev.operator && (
                  <div className="text-[11px] text-gray-400">{ev.operator}</div>
                )}
              </div>
            </InfoWindow>
          );
        })()}

        {!showHeatmap && selectedStation && stationDetail && (
          <InfoWindow
            position={{ lat: selectedStation.lat, lng: selectedStation.lng }}
            onCloseClick={() => setSelectedStation(null)}
          >
            <div style={{ minWidth: 260, padding: 0 }}>
              <div className="p-4">
                {/* 브랜드 + 이름 */}
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: BRAND_COLORS[selectedStation.brand] || "#6b7280" }}
                  />
                  <span className="text-[11px] font-medium text-text-tertiary">
                    {BRAND_LABELS[selectedStation.brand] || selectedStation.brand}
                  </span>
                </div>
                <h3 className="text-[16px] font-bold text-text-primary m-0 mb-1">
                  {selectedStation.name}
                </h3>
                {(stationDetail.newAddress || stationDetail.oldAddress) && (
                  <p className="text-[12px] text-text-tertiary m-0 mb-2">
                    {stationDetail.newAddress || stationDetail.oldAddress}
                  </p>
                )}

                {/* 태그 뱃지 */}
                {(stationDetail.hasCarWash || stationDetail.hasCvs || stationDetail.hasLpg) && (
                  <div className="flex gap-1 mb-3 flex-wrap">
                    {stationDetail.hasCarWash && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded-full">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v6M6 8l1.5 1.5M18 8l-1.5 1.5M4 14h16M6 22V14M18 22V14"/></svg>
                        세차
                      </span>
                    )}
                    {stationDetail.hasCvs && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-medium rounded-full">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
                        편의점
                      </span>
                    )}
                    {stationDetail.hasLpg && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-medium rounded-full">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                        LPG
                      </span>
                    )}
                  </div>
                )}

                {/* 도로 혼잡도 */}
                {selectedStation.roadSpeed != null && selectedStation.roadRank && selectedStation.roadSpeedUpdatedAt && (() => {
                  const congestion = getCongestionLevel(selectedStation);
                  if (congestion === "noData") return null;
                  const maxSpd = DEFAULT_MAX_SPEED[selectedStation.roadRank!] || 50;
                  const ratio = Math.min(selectedStation.roadSpeed! / maxSpd, 1);
                  const label = congestion === "smooth" ? "원활" : congestion === "slow" ? "서행" : "정체";
                  const color = CONGESTION_COLORS[congestion];
                  const RANK_LABELS: Record<string, string> = {
                    "101": "고속도로", "102": "도시고속", "103": "일반국도",
                    "104": "시도", "105": "지방도", "106": "지방도",
                  };
                  return (
                    <div className="bg-surface rounded-[10px] p-3 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                          <span className="text-[12px] font-medium text-text-primary">
                            {selectedStation.roadName || "인근 도로"}
                          </span>
                          <span className="text-[10px] text-text-tertiary">
                            {RANK_LABELS[selectedStation.roadRank!] || ""}
                          </span>
                        </div>
                        <span className="text-[12px] font-bold" style={{ color }}>
                          {label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${ratio * 100}%`, background: color }}
                          />
                        </div>
                        <span className="text-[11px] font-semibold text-text-secondary shrink-0">
                          {selectedStation.roadSpeed!.toFixed(0)}
                          <span className="text-[10px] font-normal text-text-tertiary">/{maxSpd}km/h</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* 가격 */}
                <div className="bg-surface rounded-[10px] p-3 mb-3">
                  {stationDetail.prices.map((p) => (
                    <div key={p.product} className="flex justify-between items-center py-1.5 first:pt-0 last:pb-0">
                      <span className="text-[12px] text-text-secondary">{PROD_LABELS[p.product] || p.product}</span>
                      <span className="text-[15px] font-bold text-text-primary">
                        {p.price.toLocaleString()}
                        <span className="text-[11px] font-normal text-text-tertiary ml-0.5">원</span>
                      </span>
                    </div>
                  ))}
                </div>

                {/* 유가 시차 인사이트 */}
                {oilInsight && (
                  <div className={`rounded-[10px] px-3 py-2 mb-3 ${
                    oilInsight.direction === "up" ? "bg-red-50" : oilInsight.direction === "down" ? "bg-blue-50" : "bg-slate-50"
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke={
                        oilInsight.direction === "up" ? "#ef4444" : oilInsight.direction === "down" ? "#3b82f6" : "#64748b"
                      }>
                        <path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/>
                      </svg>
                      <span className={`text-[11px] font-medium ${
                        oilInsight.direction === "up" ? "text-red-700" : oilInsight.direction === "down" ? "text-blue-700" : "text-slate-600"
                      }`}>
                        {oilInsight.message}
                      </span>
                    </div>
                  </div>
                )}

                {/* EV 충전 경쟁 환경 */}
                {stationDetail.evNearby && stationDetail.evNearby.stations > 0 && (() => {
                  const fs = stationDetail.evNearby!.fastStations;
                  const threat = fs <= 5
                    ? { label: "EV 전환 영향 적음", color: "text-emerald-600", bg: "bg-emerald-500", bar: "bg-emerald-100" }
                    : fs <= 20
                      ? { label: "EV 인프라 확대 중", color: "text-amber-600", bg: "bg-amber-400", bar: "bg-amber-100" }
                      : { label: "EV 충전 밀집 지역", color: "text-red-600", bg: "bg-red-500", bar: "bg-red-100" };
                  const barPct = Math.min(fs / 30 * 100, 100);
                  return (
                    <div className="bg-surface rounded-[10px] p-3 mb-3">
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="flex items-center gap-1.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={threat.color}>
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                          </svg>
                          <span className="text-[11px] font-semibold text-gray-700">EV 충전 경쟁 환경</span>
                        </div>
                        <span className={`text-[10px] font-bold ${threat.color}`}>{threat.label}</span>
                      </div>
                      {/* 위협도 게이지 */}
                      <div className={`h-1.5 rounded-full ${threat.bar} mb-3`}>
                        <div className={`h-full rounded-full ${threat.bg} transition-all`} style={{ width: `${barPct}%` }} />
                      </div>
                      {/* 급속 메인 */}
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-[20px] font-bold text-gray-900">{fs}</span>
                        <span className="text-[12px] font-medium text-gray-700">급속 충전소</span>
                        <span className="text-[11px] text-gray-500">(충전기 {stationDetail.evNearby!.fast}대)</span>
                      </div>
                      {/* 완속 부가정보 */}
                      <div className="text-[11px] text-gray-500">
                        완속 {stationDetail.evNearby!.stations - fs}개소 (아파트·주거용)
                      </div>
                    </div>
                  );
                })()}

                {stationDetail.tel && (
                  <p className="text-[11px] text-text-tertiary mb-3 m-0">{stationDetail.tel}</p>
                )}

                {/* 버튼 */}
                <div className="flex gap-2">
                  <a
                    href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedStation.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-9 bg-emerald text-white text-center text-[12px] font-semibold rounded-[10px] no-underline flex items-center justify-center gap-1 hover:opacity-90 transition-opacity"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    길찾기
                  </a>
                  <button
                    onClick={() => setShowChart({ id: selectedStation.id, name: selectedStation.name })}
                    className="flex-1 h-9 bg-navy text-white text-[12px] font-semibold rounded-[10px] border-none cursor-pointer flex items-center justify-center gap-1 hover:opacity-90 transition-opacity"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-5"/></svg>
                    가격 추이
                  </button>
                </div>
                <button
                  onClick={() => setShowCompetitor({ id: selectedStation.id, name: selectedStation.name })}
                  className="w-full h-9 mt-2 bg-surface text-text-secondary text-[12px] font-semibold rounded-[10px] border border-border cursor-pointer flex items-center justify-center gap-1.5 hover:bg-border/30 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  경쟁사 비교
                </button>
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* 모바일 검색바 */}
      <div className="md:hidden fixed top-[68px] left-3 right-3 z-[1100]">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2.5">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input
            type="text"
            placeholder="주유소명, 지역 검색"
            className="w-full h-10 pl-9 pr-3 bg-white text-[13px] text-text-primary placeholder-text-tertiary rounded-[12px] border border-border outline-none focus:border-navy transition-colors"
            style={{ boxShadow: "var(--shadow-md)" }}
          />
        </div>
      </div>

      {/* 표시 중 카운트 */}
      {!showHeatmap && filteredStations.length > 0 && (
        <div className="fixed bottom-6 left-[calc(var(--sidebar-width)+16px)] z-[1100] bg-white/90 backdrop-blur-sm text-text-secondary text-[11px] font-medium px-3 py-1.5 rounded-full shadow-sm border border-border hidden md:block">
          표시 중: {filteredStations.length}개 주유소
        </div>
      )}

      {/* 혼잡도 범례 */}
      {!showHeatmap && filteredStations.some(s => s.roadSpeed != null) && (
        <div
          className="fixed bottom-14 z-[1100] bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2 border border-border hidden md:block"
          style={{
            left: "calc(var(--sidebar-width) + 16px)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="text-[10px] font-semibold text-text-tertiary mb-1.5">도로 혼잡도</div>
          <div className="flex items-center gap-3">
            {([
              ["smooth", "원활", CONGESTION_COLORS.smooth],
              ["slow", "서행", CONGESTION_COLORS.slow],
              ["congested", "정체", CONGESTION_COLORS.congested],
            ] as const).map(([, label, color]) => (
              <div key={label} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="text-[10px] text-text-secondary">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EV 충전소 토글 */}
      <button
        onClick={() => setShowEvChargers((v) => !v)}
        className="fixed bottom-[152px] right-6 z-[1100] w-10 h-10 border rounded-xl cursor-pointer flex items-center justify-center transition-colors"
        style={{
          background: showEvChargers ? "#1B2838" : "white",
          borderColor: showEvChargers ? "#1B2838" : "var(--color-border)",
          boxShadow: "var(--shadow-md)",
        }}
        title={showEvChargers ? "EV 충전소 숨기기" : "EV 충전소 보기"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={showEvChargers ? "#ef4444" : "#9BA8B7"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </button>

      {/* EV 충전소 줌 안내 */}
      {showEvChargers && map && (map.getZoom() || 0) < 13 && (
        <div
          className="fixed bottom-[196px] right-4 z-[1100] bg-white/95 backdrop-blur-sm text-[11px] text-text-secondary font-medium px-3 py-2 rounded-lg border border-border"
          style={{ boxShadow: "var(--shadow-sm)" }}
        >
          줌 인하면 EV 충전소가 표시됩니다
        </div>
      )}

      {/* 히트맵 토글 */}
      <button
        onClick={() => {
          setShowHeatmap((v) => !v);
          if (!showHeatmap) setSelectedStation(null);
        }}
        className="fixed bottom-[104px] right-6 z-[1100] w-10 h-10 border rounded-xl cursor-pointer flex items-center justify-center transition-colors"
        style={{
          background: showHeatmap ? "#1B2838" : "white",
          borderColor: showHeatmap ? "#1B2838" : "var(--color-border)",
          boxShadow: "var(--shadow-md)",
        }}
        title={showHeatmap ? "마커 보기" : "히트맵 보기"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={showHeatmap ? "#FF6B35" : "#9BA8B7"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2c-4 0-8 3.5-8 9.5S12 22 12 22s8-4.5 8-10.5S16 2 12 2z"/>
          <circle cx="12" cy="11" r="3"/>
        </svg>
      </button>

      {/* 히트맵 범례 */}
      {showHeatmap && filteredStations.length > 0 && (() => {
        const prices = filteredStations.map(s => s.price).filter(p => p > 0);
        if (prices.length === 0) return null;
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        return (
          <div
            className="hidden md:block fixed bottom-6 z-[1100] bg-white/95 backdrop-blur-sm rounded-xl px-4 py-3 border border-border"
            style={{
              left: "calc(var(--sidebar-width) + 16px)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <div className="text-[11px] font-semibold text-text-secondary mb-2">가격 히트맵</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-blue-600">{minP.toLocaleString()}원</span>
              <div
                className="h-3 rounded-full"
                style={{
                  width: 120,
                  background: "linear-gradient(to right, rgba(0,100,255,0.8), rgba(0,200,100,0.8), rgba(255,255,0,0.9), rgba(255,150,0,0.95), rgba(255,0,0,1))",
                }}
              />
              <span className="text-[11px] font-medium text-red-600">{maxP.toLocaleString()}원</span>
            </div>
          </div>
        );
      })()}

      {/* 모바일 히트맵 범례 */}
      {showHeatmap && filteredStations.length > 0 && (() => {
        const prices = filteredStations.map(s => s.price).filter(p => p > 0);
        if (prices.length === 0) return null;
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        return (
          <div
            className="md:hidden fixed bottom-20 left-3 right-3 z-[1100] bg-white/95 backdrop-blur-sm rounded-xl px-4 py-3 border border-border"
            style={{ boxShadow: "var(--shadow-md)" }}
          >
            <div className="text-[11px] font-semibold text-text-secondary mb-2">가격 히트맵</div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-blue-600">{minP.toLocaleString()}원</span>
              <div
                className="flex-1 h-3 rounded-full"
                style={{
                  background: "linear-gradient(to right, rgba(0,100,255,0.8), rgba(0,200,100,0.8), rgba(255,255,0,0.9), rgba(255,150,0,0.95), rgba(255,0,0,1))",
                }}
              />
              <span className="text-[11px] font-medium text-red-600">{maxP.toLocaleString()}원</span>
            </div>
          </div>
        );
      })()}

      {/* 내 위치 버튼 */}
      <button
        onClick={goToMyLocation}
        disabled={locatingUser}
        className="fixed bottom-6 right-6 z-[1100] w-10 h-10 bg-white border border-border rounded-xl cursor-pointer flex items-center justify-center hover:bg-surface transition-colors disabled:cursor-wait"
        style={{ boxShadow: "var(--shadow-md)" }}
        title="내 위치로 이동"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={myLocation ? "#4285F4" : "#9BA8B7"} strokeWidth="2">
          <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
      </button>

      {/* 가격 추이 차트 */}
      {showChart && (
        <PriceChart
          stationId={showChart.id}
          stationName={showChart.name}
          onClose={() => setShowChart(null)}
        />
      )}

      {/* 경쟁사 비교 모달 */}
      <CompetitorModal
        stationId={showCompetitor?.id || ""}
        stationName={showCompetitor?.name || ""}
        isOpen={!!showCompetitor}
        onClose={() => setShowCompetitor(null)}
      />

      {/* 국제유가 차트 */}
      {showOilChart && (
        <OilPriceChart onClose={() => setShowOilChart(false)} />
      )}

      {loading && (
        <div className="fixed top-[72px] left-1/2 -translate-x-1/2 bg-white text-text-secondary px-4 py-2 rounded-full text-[12px] font-medium z-[1100] border border-border flex items-center gap-2" style={{ boxShadow: "var(--shadow-md)" }}>
          <div className="w-3.5 h-3.5 border-2 border-gray-200 border-t-emerald rounded-full animate-spin" />
          검색 중
        </div>
      )}
    </>
  );
}

export default function GoogleMap() {
  const [showAuth, setShowAuth] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen">
      <Header onLoginClick={() => setShowAuth(true)} />
      <div className="flex-1 relative overflow-hidden">
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['visualization']}>
          <MapContent />
        </APIProvider>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
