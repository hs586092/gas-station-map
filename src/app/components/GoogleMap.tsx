"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import Sidebar, {
  type Station,
  type Filters,
  BRAND_LABELS,
} from "./Sidebar";
import PriceChart from "./PriceChart";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;

interface StationDetail {
  id: string;
  name: string;
  brand: string;
  oldAddress: string;
  newAddress: string;
  tel: string;
  prices: { product: string; price: number }[];
}

const PROD_LABELS: Record<string, string> = {
  B027: "휘발유",
  B034: "고급휘발유",
  D047: "경유",
  K015: "LPG",
};

const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a",
  GSC: "#0066b3",
  HDO: "#00a651",
  SOL: "#ffd200",
  RTO: "#ff8c00",
  NHO: "#006838",
  ETC: "#6b7280",
};

const ALL_BRANDS = new Set([
  "SKE", "GSC", "HDO", "SOL", "RTO", "NHO", "ETC",
]);

function Header() {
  return (
    <header className="h-[56px] bg-navy flex items-center justify-between px-4 md:px-6 shrink-0 z-[1200] relative">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-accent-orange rounded-lg flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 22V8l5-6h4l-1 7h7a2 2 0 0 1 2 2.5L18 22H3z" />
          </svg>
        </div>
        <h1 className="text-white text-[17px] font-bold tracking-tight">주유소 지도</h1>
        <span className="hidden md:inline text-[11px] text-gray-400 ml-1">전국 최저가 주유소 찾기</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-3 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">휘발유</span>
            <span className="text-white font-semibold">—</span>
          </div>
          <div className="w-px h-3 bg-gray-600" />
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400">경유</span>
            <span className="text-white font-semibold">—</span>
          </div>
        </div>
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
  });
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const [showChart, setShowChart] = useState<{ id: string; name: string } | null>(null);

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [topStations, setTopStations] = useState<Station[]>([]);
  const [locatingUser, setLocatingUser] = useState(false);

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
        mapId="gas-station-map"
        onIdle={fetchStations}
        onClick={() => setSelectedStation(null)}
      >
        {/* 내 위치 마커 */}
        {myLocation && (
          <AdvancedMarker position={myLocation}>
            <div className="w-4 h-4 bg-blue-500 border-[3px] border-white rounded-full shadow-[0_0_8px_rgba(66,133,244,0.6)]" />
          </AdvancedMarker>
        )}

        {/* 주유소 마커 */}
        {filteredStations.map((station) => {
          const isSelected = selectedStation?.id === station.id;
          const brandColor = BRAND_COLORS[station.brand] || "#6b7280";
          return (
            <AdvancedMarker
              key={station.id}
              position={{ lat: station.lat, lng: station.lng }}
              onClick={() => handleStationSelect(station)}
            >
              <div
                className="flex items-center gap-0 rounded-full shadow-lg cursor-pointer transition-transform hover:scale-110"
                style={{
                  background: isSelected ? "#1a2332" : "white",
                  border: `2px solid ${isSelected ? "#f59e0b" : brandColor}`,
                  padding: "3px 8px 3px 3px",
                }}
              >
                <div
                  className="w-[6px] h-[6px] rounded-full mr-1.5 shrink-0"
                  style={{ background: brandColor }}
                />
                <span
                  className="text-[11px] font-bold whitespace-nowrap leading-none"
                  style={{ color: isSelected ? "white" : "#1a2332" }}
                >
                  {station.price.toLocaleString()}
                </span>
              </div>
              {/* 꼬리 삼각형 */}
              <div className="flex justify-center -mt-[1px]">
                <div
                  className="w-0 h-0"
                  style={{
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: `5px solid ${isSelected ? "#1a2332" : "white"}`,
                  }}
                />
              </div>
            </AdvancedMarker>
          );
        })}

        {selectedStation && stationDetail && (
          <InfoWindow
            position={{ lat: selectedStation.lat, lng: selectedStation.lng }}
            onCloseClick={() => setSelectedStation(null)}
          >
            <div style={{ minWidth: 240, padding: 0 }}>
              {/* 브랜드 컬러 바 */}
              <div
                className="h-1.5 rounded-t"
                style={{ background: BRAND_COLORS[selectedStation.brand] || "#6b7280" }}
              />
              <div className="p-3">
                <h3 className="text-[15px] font-bold text-gray-900 m-0">
                  {selectedStation.name}
                </h3>
                <p className="text-[12px] text-gray-500 mt-0.5 mb-3">
                  {BRAND_LABELS[selectedStation.brand] || selectedStation.brand}
                  {stationDetail.newAddress || stationDetail.oldAddress
                    ? ` · ${stationDetail.newAddress || stationDetail.oldAddress}`
                    : ""}
                </p>

                {/* 가격 테이블 */}
                <div className="bg-gray-50 rounded-lg p-2.5 mb-3">
                  {stationDetail.prices.map((p) => (
                    <div
                      key={p.product}
                      className="flex justify-between items-center py-1.5 border-b border-gray-100 last:border-0"
                    >
                      <span className="text-[12px] text-gray-600">
                        {PROD_LABELS[p.product] || p.product}
                      </span>
                      <span className="text-[14px] font-bold text-navy">
                        {p.price.toLocaleString()}
                        <span className="text-[11px] font-normal text-gray-400 ml-0.5">원</span>
                      </span>
                    </div>
                  ))}
                </div>

                {stationDetail.tel && (
                  <p className="text-[11px] text-gray-400 mb-2">
                    {stationDetail.tel}
                  </p>
                )}

                {/* 버튼 그룹 */}
                <div className="flex gap-2">
                  <a
                    href={`https://map.naver.com/v5/search/${encodeURIComponent(selectedStation.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 bg-accent-green text-white text-center text-[12px] font-semibold rounded-lg no-underline hover:opacity-90 transition-opacity"
                  >
                    길찾기
                  </a>
                  <button
                    onClick={() =>
                      setShowChart({
                        id: selectedStation.id,
                        name: selectedStation.name,
                      })
                    }
                    className="flex-1 py-2 bg-navy text-white text-[12px] font-semibold rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    가격 추이
                  </button>
                </div>
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* 내 위치 버튼 */}
      <button
        onClick={goToMyLocation}
        disabled={locatingUser}
        className="fixed bottom-6 right-6 z-[1100] w-11 h-11 bg-white border-none rounded-xl shadow-lg cursor-pointer flex items-center justify-center hover:bg-gray-50 transition-colors disabled:cursor-wait"
        title="내 위치로 이동"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={myLocation ? "#3b82f6" : "#9ca3af"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
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
        <div className="fixed top-[72px] left-1/2 -translate-x-1/2 bg-navy/80 text-white px-5 py-2 rounded-full text-[13px] z-[1100] backdrop-blur-sm">
          주유소 검색 중...
        </div>
      )}
    </>
  );
}

export default function GoogleMap() {
  return (
    <div className="flex flex-col h-screen w-screen">
      <Header />
      <div className="flex-1 relative overflow-hidden">
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
          <MapContent />
        </APIProvider>
      </div>
    </div>
  );
}
