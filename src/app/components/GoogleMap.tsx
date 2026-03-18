"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import Sidebar, {
  type Station,
  type Filters,
  BRAND_LABELS,
} from "./Sidebar";
import PriceChart from "./PriceChart";
import AuthModal from "./AuthModal";
import { useAuth } from "@/lib/auth";
import Link from "next/link";

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

function Header({ onLoginClick }: { onLoginClick: () => void }) {
  const { user, profile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

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
        <Link href="/" className="px-3 py-1.5 text-[13px] font-medium text-white bg-white/15 rounded-lg no-underline transition-colors">
          지도
        </Link>
        <Link href="/community" className="px-3 py-1.5 text-[13px] font-medium text-gray-400 hover:text-white hover:bg-white/10 rounded-lg no-underline transition-colors">
          커뮤니티
        </Link>
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

function TrafficLayerOverlay() {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const layerRef = useRef<google.maps.TrafficLayer | null>(null);

  useEffect(() => {
    if (!map || !mapsLib) return;
    if (!layerRef.current) {
      layerRef.current = new google.maps.TrafficLayer();
    }
    layerRef.current.setMap(map);
    return () => {
      layerRef.current?.setMap(null);
    };
  }, [map, mapsLib]);

  return null;
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
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [showChart, setShowChart] = useState<{ id: string; name: string } | null>(null);

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [topStations, setTopStations] = useState<Station[]>([]);
  const [locatingUser, setLocatingUser] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);

  useEffect(() => {
    requestLocation();
  }, []);

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

  const filteredStations =
    filters.brands.size === 0
      ? stations
      : stations.filter((s) => filters.brands.has(s.brand));

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
      />

      <Map
        defaultCenter={{ lat: 36.5, lng: 127.5 }}
        defaultZoom={7}
        style={{ width: "100%", height: "100%" }}
        onIdle={fetchStations}
        onClick={() => setSelectedStation(null)}
      >
        {showTraffic && <TrafficLayerOverlay />}

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

        {/* 주유소 마커 */}
        {filteredStations.map((station) => {
          const isSelected = selectedStation?.id === station.id;
          const brandColor = BRAND_COLORS[station.brand] || "#6b7280";
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
                  `<rect x="0" y="0" width="60" height="24" rx="12" fill="${isSelected ? '#1B2838' : 'white'}" ` +
                  `stroke="${isSelected ? 'none' : 'rgba(0,0,0,0.08)'}" stroke-width="1"/>` +
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

        {selectedStation && stationDetail && (
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
      {filteredStations.length > 0 && (
        <div className="fixed bottom-6 left-[calc(var(--sidebar-width)+16px)] z-[1100] bg-white/90 backdrop-blur-sm text-text-secondary text-[11px] font-medium px-3 py-1.5 rounded-full shadow-sm border border-border hidden md:block">
          표시 중: {filteredStations.length}개 주유소
        </div>
      )}

      {/* 교통 레이어 토글 */}
      <button
        onClick={() => setShowTraffic((v) => !v)}
        className="fixed bottom-[104px] right-6 z-[1100] w-10 h-10 border rounded-xl cursor-pointer flex items-center justify-center transition-colors"
        style={{
          background: showTraffic ? "#1B2838" : "white",
          borderColor: showTraffic ? "#1B2838" : "var(--color-border)",
          boxShadow: "var(--shadow-md)",
        }}
        title={showTraffic ? "교통 정보 끄기" : "교통 정보 켜기"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={showTraffic ? "#00C073" : "#9BA8B7"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 18h3V9H5zM10.5 18h3V4h-3zM16 18h3v-7h-3z"/>
        </svg>
      </button>

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
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
          <MapContent />
        </APIProvider>
      </div>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
