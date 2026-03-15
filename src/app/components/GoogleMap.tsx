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

const ALL_BRANDS = new Set([
  "SKE", "GSC", "HDO", "SOL", "RTO", "NHO", "ETC",
]);

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

  // 내 위치 상태
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [topStations, setTopStations] = useState<Station[]>([]);
  const [locatingUser, setLocatingUser] = useState(false);

  // 초기 위치 요청
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

  // 내 위치 기준 TOP 5 조회
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

  // 위치 변경 또는 유종 변경 시 TOP 5 갱신
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

  // 브랜드 필터 적용
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
        style={{ width: "100vw", height: "100vh" }}
        mapId="gas-station-map"
        onIdle={fetchStations}
        onClick={() => setSelectedStation(null)}
      >
        {/* 내 위치 마커 */}
        {myLocation && (
          <AdvancedMarker position={myLocation}>
            <div
              style={{
                width: 18,
                height: 18,
                background: "#4285F4",
                border: "3px solid white",
                borderRadius: "50%",
                boxShadow: "0 0 8px rgba(66,133,244,0.6)",
              }}
            />
          </AdvancedMarker>
        )}

        {/* 주유소 마커 */}
        {filteredStations.map((station) => (
          <AdvancedMarker
            key={station.id}
            position={{ lat: station.lat, lng: station.lng }}
            onClick={() => handleStationSelect(station)}
          >
            <div
              style={{
                background:
                  selectedStation?.id === station.id ? "#2563eb" : "#e53e3e",
                color: "white",
                padding: "4px 8px",
                borderRadius: "12px",
                fontSize: "11px",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
                transition: "background 0.2s",
              }}
            >
              {station.price.toLocaleString()}
            </div>
          </AdvancedMarker>
        ))}

        {selectedStation && (
          <InfoWindow
            position={{ lat: selectedStation.lat, lng: selectedStation.lng }}
            onCloseClick={() => setSelectedStation(null)}
          >
            <div style={{ minWidth: 200, padding: 4 }}>
              <h3
                style={{
                  margin: "0 0 8px",
                  fontSize: 15,
                  fontWeight: "bold",
                }}
              >
                {selectedStation.name}
              </h3>
              <p style={{ margin: "0 0 4px", fontSize: 13, color: "#666" }}>
                {BRAND_LABELS[selectedStation.brand] || selectedStation.brand}
              </p>

              {stationDetail ? (
                <>
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 12,
                      color: "#888",
                    }}
                  >
                    {stationDetail.newAddress || stationDetail.oldAddress}
                  </p>
                  <table
                    style={{
                      width: "100%",
                      fontSize: 13,
                      borderCollapse: "collapse",
                    }}
                  >
                    <tbody>
                      {stationDetail.prices.map((p) => (
                        <tr
                          key={p.product}
                          style={{ borderTop: "1px solid #eee" }}
                        >
                          <td style={{ padding: "4px 0", color: "#555" }}>
                            {PROD_LABELS[p.product] || p.product}
                          </td>
                          <td
                            style={{
                              padding: "4px 0",
                              textAlign: "right",
                              fontWeight: "bold",
                            }}
                          >
                            {p.price.toLocaleString()}원
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {stationDetail.tel && (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: "#888",
                      }}
                    >
                      📞 {stationDetail.tel}
                    </p>
                  )}
                  <button
                    onClick={() =>
                      setShowChart({
                        id: selectedStation.id,
                        name: selectedStation.name,
                      })
                    }
                    style={{
                      marginTop: 10,
                      width: "100%",
                      padding: "8px 0",
                      background: "#3182ce",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: "bold",
                      cursor: "pointer",
                    }}
                  >
                    📈 가격 추이 보기
                  </button>
                </>
              ) : (
                <p style={{ fontSize: 12, color: "#aaa" }}>로딩 중...</p>
              )}
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* 내 위치 버튼 */}
      <button
        onClick={goToMyLocation}
        disabled={locatingUser}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1100,
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "white",
          border: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          cursor: locatingUser ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
        }}
        title="내 위치로 이동"
      >
        {locatingUser ? "..." : "📍"}
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
        <div
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.7)",
            color: "white",
            padding: "8px 20px",
            borderRadius: 20,
            fontSize: 14,
            zIndex: 1100,
          }}
        >
          주유소 검색 중...
        </div>
      )}
    </>
  );
}

export default function GoogleMap() {
  return (
    <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
      <MapContent />
    </APIProvider>
  );
}
