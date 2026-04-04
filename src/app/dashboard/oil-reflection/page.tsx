"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

interface OilPrice { date: string; wti: number | null; brent: number | null; }
interface RetailDay { date: string; gasoline: number | null; diesel: number | null; }
interface OilReflection {
  brentChange: number; priceChange: number | null;
  status: string; message: string; direction: "up" | "down" | "flat";
}

// 유가 변동 이벤트 감지: Brent 주간 변동 ±$3 이상
interface OilEvent {
  startDate: string;
  endDate: string;
  brentStart: number;
  brentEnd: number;
  change: number;
  direction: "up" | "down";
  // 반영 분석
  retailBefore: number | null;
  retailAfter: number | null;
  retailChange: number | null;
  reflected: boolean;
  daysToReflect: number | null;
}

function detectOilEvents(oilPrices: OilPrice[], retailData: RetailDay[]): OilEvent[] {
  if (oilPrices.length < 7) return [];
  const events: OilEvent[] = [];
  const WINDOW = 7; // 7일 윈도우
  const THRESHOLD = 3; // $3 이상 변동

  for (let i = WINDOW; i < oilPrices.length; i += 3) {
    const start = oilPrices[i - WINDOW];
    const end = oilPrices[i];
    if (!start.brent || !end.brent) continue;

    const change = +(end.brent - start.brent).toFixed(2);
    if (Math.abs(change) < THRESHOLD) continue;

    // 이벤트 시점 + 14일 후 소매가 확인
    const eventDate = new Date(end.date);
    const reflectTarget = new Date(eventDate);
    reflectTarget.setDate(reflectTarget.getDate() + 14);
    const targetStr = reflectTarget.toISOString().split("T")[0];

    // 이벤트 시점 소매가
    const retailAtEvent = retailData.find((r) => r.date <= end.date);
    // 14일 후 소매가
    const retailAfterEvent = retailData.find((r) => r.date >= targetStr);

    const retailBefore = retailAtEvent?.gasoline ?? null;
    const retailAfter = retailAfterEvent?.gasoline ?? null;
    const retailChange = retailBefore && retailAfter ? retailAfter - retailBefore : null;
    const reflected = retailChange != null && (
      (change > 0 && retailChange > 5) || (change < 0 && retailChange < -5)
    );

    // 반영까지 소요일 (소매가가 5원 이상 변동한 첫 날)
    let daysToReflect: number | null = null;
    if (retailBefore) {
      for (const r of retailData) {
        if (r.date <= end.date) continue;
        if (r.gasoline && Math.abs(r.gasoline - retailBefore) >= 5) {
          const diff = (new Date(r.date).getTime() - eventDate.getTime()) / 86400000;
          daysToReflect = Math.round(diff);
          break;
        }
      }
    }

    // 중복 이벤트 방지 (같은 주 내)
    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      const gap = (new Date(end.date).getTime() - new Date(lastEvent.endDate).getTime()) / 86400000;
      if (gap < 5) continue;
    }

    events.push({
      startDate: start.date,
      endDate: end.date,
      brentStart: start.brent,
      brentEnd: end.brent,
      change,
      direction: change > 0 ? "up" : "down",
      retailBefore,
      retailAfter,
      retailChange,
      reflected,
      daysToReflect,
    });
  }

  return events.reverse(); // 최신순
}

export default function OilReflectionPage() {
  const [oilPrices, setOilPrices] = useState<OilPrice[]>([]);
  const [retailData, setRetailData] = useState<RetailDay[]>([]);
  const [reflection, setReflection] = useState<OilReflection | null>(null);
  const [oilStory, setOilStory] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/oil-prices?days=60").then((r) => r.json()),
      fetch(`/api/price-history/${STATION_ID}`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}/dashboard-insights`).then((r) => r.json()),
    ]).then(([oilJson, retailJson, stationJson, insightsJson]) => {
      setOilPrices(oilJson.prices || []);
      setRetailData(retailJson.history || []);
      setReflection(stationJson.oilReflection || null);
      setOilStory(insightsJson.oilStory || "");
      setLoading(false);
    });
  }, []);

  const events = detectOilEvents(oilPrices, retailData);

  // 평균 반영 속도
  const reflectDays = events.map((e) => e.daysToReflect).filter((d): d is number => d != null);
  const avgReflectDays = reflectDays.length > 0 ? Math.round(reflectDays.reduce((a, b) => a + b, 0) / reflectDays.length) : null;

  // 시차 오버레이 차트
  const overlayData = oilPrices.map((oil) => {
    const shiftedDate = new Date(oil.date);
    shiftedDate.setDate(shiftedDate.getDate() + 14);
    const shiftedStr = shiftedDate.toISOString().split("T")[0];
    const retail = retailData.find((r) => r.date === shiftedStr);
    return {
      date: oil.date.slice(5),
      brent: oil.brent,
      retail: retail?.gasoline || null,
    };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="유가 반영 분석" description="국제유가 변동의 소매가 반영 타임라인" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="유가 반영 분석" description="셀프광장주유소 · 국제유가 변동의 소매가 반영 타임라인" />

      <main className="px-5 pb-10">
        {/* 현재 상태 */}
        {reflection && (
          <div className={`mb-6 rounded-2xl p-5 shadow-sm border border-border ${
            reflection.direction === "up" ? "bg-red-50 border-red-200"
              : reflection.direction === "down" ? "bg-blue-50 border-blue-200"
              : "bg-white"
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[18px]">{reflection.direction === "up" ? "📈" : reflection.direction === "down" ? "📉" : "➡️"}</span>
              <span className="text-[15px] font-bold text-text-primary">현재 반영 상태</span>
            </div>
            <p className="text-[14px] font-semibold text-text-primary m-0">{reflection.message}</p>
            {reflection.priceChange !== null && (
              <p className="text-[12px] text-text-secondary m-0 mt-1">
                소매가 2주간 {reflection.priceChange >= 0 ? "+" : ""}{reflection.priceChange}원 · Brent 2주간 {reflection.brentChange >= 0 ? "+" : ""}{reflection.brentChange.toFixed(1)}%
              </p>
            )}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">감지된 유가 이벤트</div>
            <div className="text-[22px] font-extrabold text-text-primary">{events.length}<span className="text-[12px] font-normal">건</span></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">평균 반영 속도</div>
            <div className="text-[22px] font-extrabold text-text-primary">
              {avgReflectDays != null ? <>{avgReflectDays}<span className="text-[12px] font-normal">일</span></> : <span className="text-[14px] text-text-tertiary">데이터 부족</span>}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">반영 완료율</div>
            <div className="text-[22px] font-extrabold text-emerald">
              {events.length > 0
                ? `${Math.round((events.filter((e) => e.reflected).length / events.length) * 100)}%`
                : "-"}
            </div>
          </div>
        </div>

        {/* 흐름 분석 스토리 */}
        {oilStory && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-border mb-6">
            <div className="text-[13px] font-bold text-text-primary mb-2">흐름 분석</div>
            <div className="text-[12px] text-text-secondary leading-relaxed">{oilStory}</div>
          </div>
        )}

        {/* Brent vs 소매가 시차 차트 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-border mb-6">
          <div className="text-[16px] font-bold text-text-primary mb-1">Brent 유가 → 소매가 시차 비교</div>
          <div className="text-[13px] text-text-secondary mb-4">Brent 유가와 2주 후 내 소매가를 같은 시점에 겹쳐 표시</div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={overlayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="date" fontSize={12} tick={{ fill: "#9BA8B7" }} interval="preserveStartEnd" tickLine={false} />
              <YAxis yAxisId="oil" fontSize={12} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(v: number) => `$${v}`} axisLine={false} tickLine={false} width={50} />
              <YAxis yAxisId="retail" orientation="right" fontSize={12} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 20", "dataMax + 20"]} tickFormatter={(v: number) => `${v}`} axisLine={false} tickLine={false} width={50} />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "brent") return [`$${Number(value).toFixed(2)}`, "Brent"];
                  return [`${Number(value).toLocaleString()}원`, "내 소매가(2주 후)"];
                }}
                contentStyle={{ borderRadius: 10, border: "1px solid #E8EBF0", fontSize: 12 }}
              />
              <Line yAxisId="oil" type="monotone" dataKey="brent" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="retail" type="monotone" dataKey="retail" stroke="#FF5252" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-[12px]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 rounded inline-block bg-blue-500" /> Brent (좌축)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 rounded inline-block bg-coral" /> 내 휘발유 2주 후 (우축)</span>
          </div>
        </div>

        {/* 유가 변동 이벤트 타임라인 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
          <div className="text-[16px] font-bold text-text-primary mb-1">유가 변동 이벤트</div>
          <div className="text-[13px] text-text-secondary mb-4">Brent 주간 변동 ±$3 이상 감지</div>

          {events.length === 0 ? (
            <div className="text-[13px] text-text-tertiary text-center py-8">
              60일간 감지된 유가 변동 이벤트가 없습니다.
            </div>
          ) : (
            <div className="relative">
              {/* 타임라인 세로선 */}
              <div className="absolute left-[18px] top-0 bottom-0 w-0.5 bg-border" />

              <div className="space-y-4">
                {events.map((ev, i) => (
                  <div key={i} className="relative pl-10">
                    {/* 타임라인 도트 */}
                    <div className={`absolute left-[11px] top-1.5 w-4 h-4 rounded-full border-2 border-white shadow-sm ${
                      ev.direction === "up" ? "bg-coral" : "bg-blue-500"
                    }`} />

                    <div className={`rounded-xl p-4 ${ev.direction === "up" ? "bg-red-50" : "bg-blue-50"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[12px] font-bold text-text-primary">
                          {ev.endDate.slice(5)} · Brent {ev.direction === "up" ? "▲" : "▼"}${Math.abs(ev.change).toFixed(1)}
                        </div>
                        <span className={`text-[12px] px-2 py-0.5 rounded-full font-bold ${
                          ev.reflected ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-text-tertiary"
                        }`}>
                          {ev.reflected ? "반영 완료" : "미반영"}
                        </span>
                      </div>
                      <div className="text-[13px] text-text-secondary">
                        Brent ${ev.brentStart.toFixed(1)} → ${ev.brentEnd.toFixed(1)}
                        <span className="text-text-tertiary"> ({ev.startDate.slice(5)} ~ {ev.endDate.slice(5)})</span>
                      </div>
                      {ev.retailChange != null && (
                        <div className="text-[13px] text-text-secondary mt-1">
                          내 소매가: {ev.retailChange >= 0 ? "+" : ""}{ev.retailChange}원
                          {ev.daysToReflect != null && (
                            <span className="text-text-tertiary"> (반영까지 {ev.daysToReflect}일)</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
