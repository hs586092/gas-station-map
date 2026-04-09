"use client";

import { useState, useEffect } from "react";
import { APIProvider, Map, Marker, InfoWindow } from "@vis.gl/react-google-maps";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

interface EvCharger {
  station_id: string;
  station_name: string;
  address: string;
  lat: number;
  lng: number;
  fast_count: number;
  slow_count: number;
  total_count: number;
  operator: string;
  distance_km: number;
}

interface EvData {
  station: { id: string; name: string; lat: number; lng: number };
  summary: { totalFast: number; totalSlow: number; stations: number; fastStations: number };
  chargers: EvCharger[];
  operators: Array<{ name: string; count: number }>;
}

export default function EvThreatPage() {
  const [data, setData] = useState<EvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCharger, setSelectedCharger] = useState<EvCharger | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/ev-nearby`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-surface text-slate-900">
        <DetailHeader title="EV 충전소 위협 분석" description="반경 3km EV 충전 인프라 현황" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const { summary, chargers, operators, station } = data;
  const fastChargers = chargers.filter((c) => c.fast_count > 0);
  const top5Fast = fastChargers.slice(0, 5);

  // 위협 레벨
  const threatLevel = summary.fastStations <= 5
    ? { label: "EV 전환 영향 적음", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" }
    : summary.fastStations <= 20
    ? { label: "EV 인프라 확대 중", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-100" }
    : { label: "EV 충전 밀집 지역", color: "text-red-700", bg: "bg-red-50", border: "border-red-100" };

  // 운영업체 색상
  const opColors = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#f59e0b", "#ec4899"];

  return (
    <div className="min-h-screen bg-surface text-slate-900 h-screen overflow-y-auto">
      <DetailHeader title="EV 충전소 위협 분석" description="셀프광장주유소 · 반경 3km EV 충전 인프라 현황" />

      <main className="px-5 pb-10">
        {/* 위협 레벨 + 요약 */}
        <div className={`mb-6 rounded-2xl p-5 shadow-sm border ${threatLevel.bg} ${threatLevel.border}`}>
          <div className="flex items-center gap-2 mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={threatLevel.color}>
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span className={`text-[16px] font-bold ${threatLevel.color}`}>{threatLevel.label}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-[12px] text-slate-800">총 충전소</div>
              <div className="text-[20px] font-extrabold text-slate-900">{summary.stations}<span className="text-[13px] font-normal">개소</span></div>
            </div>
            <div>
              <div className="text-[12px] text-slate-800">급속 충전소</div>
              <div className="text-[20px] font-extrabold text-slate-900">{summary.fastStations}<span className="text-[13px] font-normal">개소</span></div>
            </div>
            <div>
              <div className="text-[12px] text-slate-800">급속 충전기</div>
              <div className="text-[20px] font-extrabold text-slate-900">{summary.totalFast}<span className="text-[13px] font-normal">대</span></div>
            </div>
            <div>
              <div className="text-[12px] text-slate-800">완속 충전기</div>
              <div className="text-[20px] font-extrabold text-slate-900">{summary.totalSlow}<span className="text-[13px] font-normal">대</span></div>
            </div>
          </div>
        </div>

        {/* 뷰 모드 전환 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setViewMode("map")} className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${viewMode === "map" ? "bg-navy text-white border-navy" : "bg-surface-raised text-slate-800 border-border"}`}>
            지도
          </button>
          <button onClick={() => setViewMode("list")} className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${viewMode === "list" ? "bg-navy text-white border-navy" : "bg-surface-raised text-slate-800 border-border"}`}>
            목록
          </button>
        </div>

        {/* 지도 */}
        {viewMode === "map" && MAPS_KEY && (
          <div className="bg-surface-raised rounded-xl border border-border overflow-hidden mb-6" style={{ height: 400 }}>
            <APIProvider apiKey={MAPS_KEY}>
              <Map
                defaultCenter={{ lat: station.lat, lng: station.lng }}
                defaultZoom={14}
                style={{ width: "100%", height: "100%" }}
                gestureHandling="greedy"
              >
                {/* 내 주유소 마커 */}
                <Marker
                  position={{ lat: station.lat, lng: station.lng }}
                  title="내 주유소"
                />
                {/* EV 충전소 마커 */}
                {chargers.map((c) => (
                  <Marker
                    key={c.station_id}
                    position={{ lat: c.lat, lng: c.lng }}
                    title={c.station_name}
                    onClick={() => setSelectedCharger(c)}
                    icon={{
                      url: "data:image/svg+xml," + encodeURIComponent(
                        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${c.fast_count > 0 ? '%23ef4444' : '%236b7280'}" stroke="white" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`
                      ),
                      scaledSize: { width: 24, height: 24, equals: () => false },
                    }}
                  />
                ))}
                {/* 선택된 충전소 InfoWindow */}
                {selectedCharger && (
                  <InfoWindow
                    position={{ lat: selectedCharger.lat, lng: selectedCharger.lng }}
                    onCloseClick={() => setSelectedCharger(null)}
                  >
                    <div style={{ minWidth: 180, fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{selectedCharger.station_name}</div>
                      <div style={{ color: "#666", marginBottom: 2 }}>{selectedCharger.operator}</div>
                      <div>급속 {selectedCharger.fast_count}대 · 완속 {selectedCharger.slow_count}대</div>
                      <div style={{ color: "#999", marginTop: 2 }}>{selectedCharger.distance_km}km</div>
                    </div>
                  </InfoWindow>
                )}
              </Map>
            </APIProvider>
          </div>
        )}

        {/* 목록 뷰 또는 항상 표시되는 TOP 5 */}
        {viewMode === "list" && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
            <div className="text-[13px] font-bold text-slate-900 mb-4">전체 충전소 ({chargers.length}개)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-slate-800 font-semibold">충전소명</th>
                    <th className="text-left py-2 px-2 text-slate-800 font-semibold">운영사</th>
                    <th className="text-right py-2 px-2 text-slate-800 font-semibold">급속</th>
                    <th className="text-right py-2 px-2 text-slate-800 font-semibold">완속</th>
                    <th className="text-right py-2 px-2 text-slate-800 font-semibold">거리</th>
                  </tr>
                </thead>
                <tbody>
                  {chargers.map((c) => (
                    <tr key={c.station_id} className="border-b border-border/50 hover:bg-surface transition-colors">
                      <td className="py-2 px-2 text-slate-900 font-medium">{c.station_name}</td>
                      <td className="py-2 px-2 text-slate-800">{c.operator}</td>
                      <td className="py-2 px-2 text-right font-bold text-coral">{c.fast_count > 0 ? c.fast_count : "-"}</td>
                      <td className="py-2 px-2 text-right text-slate-800">{c.slow_count > 0 ? c.slow_count : "-"}</td>
                      <td className="py-2 px-2 text-right text-slate-800">{c.distance_km}km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 가장 가까운 급속 충전소 TOP 5 */}
        {top5Fast.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
            <div className="text-[13px] font-bold text-slate-900 mb-3">가장 가까운 급속 충전소 TOP 5</div>
            <div className="space-y-2">
              {top5Fast.map((c, i) => (
                <div key={c.station_id} className="flex items-center justify-between rounded-lg bg-surface px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-bold text-slate-700 w-5">{i + 1}</span>
                    <div>
                      <div className="text-[12px] font-semibold text-slate-900">{c.station_name}</div>
                      <div className="text-[12px] text-slate-800">{c.operator} · 급속 {c.fast_count}대</div>
                    </div>
                  </div>
                  <div className="text-[13px] font-bold text-slate-900">{c.distance_km}km</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 운영업체별 분류 */}
        {operators.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[13px] font-bold text-slate-900 mb-4">운영업체별 충전소 수</div>
            <div className="space-y-2">
              {operators.slice(0, 8).map((op, i) => {
                const pct = Math.round((op.count / summary.stations) * 100);
                return (
                  <div key={op.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-slate-900">{op.name}</span>
                      <span className="text-[12px] font-bold text-slate-900">{op.count}개 ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: opColors[i % opColors.length] }}
                      />
                    </div>
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
