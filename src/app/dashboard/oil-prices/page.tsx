"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

interface OilPrice {
  date: string;
  wti: number | null;
  brent: number | null;
}

interface OilSummary {
  wti: number | null;
  brent: number | null;
  wtiChange: number | null;
  brentChange: number | null;
  twoWeeksAgoDate: string;
}

interface RetailPrice {
  date: string;
  gasoline: number | null;
  diesel: number | null;
}

export default function OilPricesPage() {
  const [oilData, setOilData] = useState<OilPrice[]>([]);
  const [summary, setSummary] = useState<OilSummary | null>(null);
  const [retailData, setRetailData] = useState<RetailPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRetail, setShowRetail] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/oil-prices?days=60").then((r) => r.json()),
      fetch(`/api/price-history/${STATION_ID}`).then((r) => r.json()),
    ]).then(([oilJson, retailJson]) => {
      setOilData(oilJson.prices || []);
      setSummary(oilJson.summary || null);
      setRetailData(retailJson.history || []);
      setLoading(false);
    });
  }, []);

  // 2주 전 세로선 위치
  const twoWeeksAgoIdx = oilData.length > 0 ? Math.max(0, oilData.length - 11) : -1;
  const twoWeeksAgoDate = twoWeeksAgoIdx >= 0 ? oilData[twoWeeksAgoIdx]?.date?.slice(5) : null;

  // 유가 + 소매가 오버레이 차트 데이터 (2주 시차 적용)
  const overlayData = oilData.map((oil, i) => {
    // 2주 후의 소매가를 현재 유가 날짜에 매핑
    const shiftedDate = new Date(oil.date);
    shiftedDate.setDate(shiftedDate.getDate() + 14);
    const shiftedDateStr = shiftedDate.toISOString().split("T")[0];
    const retail = retailData.find((r) => r.date === shiftedDateStr);

    return {
      date: oil.date.slice(5),
      fullDate: oil.date,
      brent: oil.brent,
      wti: oil.wti,
      // 2주 후 소매가 (시차 반영)
      retailGasoline: retail?.gasoline || null,
      retailDiesel: retail?.diesel || null,
      idx: i,
    };
  });

  // 상관관계 계산 (Brent vs 소매가, 2주 시차)
  const correlationPairs = overlayData
    .filter((d) => d.brent != null && d.retailGasoline != null)
    .map((d) => ({ oil: d.brent!, retail: d.retailGasoline! }));

  let correlation = 0;
  if (correlationPairs.length >= 5) {
    const n = correlationPairs.length;
    const avgOil = correlationPairs.reduce((a, b) => a + b.oil, 0) / n;
    const avgRetail = correlationPairs.reduce((a, b) => a + b.retail, 0) / n;
    let num = 0, denOil = 0, denRetail = 0;
    for (const p of correlationPairs) {
      const dOil = p.oil - avgOil;
      const dRetail = p.retail - avgRetail;
      num += dOil * dRetail;
      denOil += dOil * dOil;
      denRetail += dRetail * dRetail;
    }
    const den = Math.sqrt(denOil * denRetail);
    correlation = den > 0 ? num / den : 0;
  }

  // Brent 통계
  const brentPrices = oilData.map((d) => d.brent).filter((p): p is number => p != null);
  const brentMin = brentPrices.length > 0 ? Math.min(...brentPrices) : 0;
  const brentMax = brentPrices.length > 0 ? Math.max(...brentPrices) : 0;
  const brentAvg = brentPrices.length > 0 ? (brentPrices.reduce((a, b) => a + b, 0) / brentPrices.length) : 0;
  const brentLatest = brentPrices.length > 0 ? brentPrices[brentPrices.length - 1] : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="국제유가" description="WTI/Brent 추이 및 소매가 영향 분석" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="국제유가" description="WTI/Brent 60일 추이 및 소매가 영향 분석" />

      <main className="px-5 pb-10">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">Brent 현재</div>
            <div className="text-[20px] font-extrabold text-text-primary">
              ${brentLatest.toFixed(1)}
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">2주 변동</div>
            <div className={`text-[20px] font-extrabold ${
              (summary?.brentChange ?? 0) > 0 ? "text-coral" : (summary?.brentChange ?? 0) < 0 ? "text-blue-600" : "text-text-primary"
            }`}>
              {(summary?.brentChange ?? 0) > 0 ? "+" : ""}${(summary?.brentChange ?? 0).toFixed(1)}
            </div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">60일 평균</div>
            <div className="text-[20px] font-extrabold text-text-primary">${brentAvg.toFixed(1)}</div>
          </div>
          <div className="bg-surface-raised rounded-xl p-4 border border-border">
            <div className="text-[13px] text-text-secondary mb-1">60일 범위</div>
            <div className="text-[14px] font-bold text-text-primary">
              ${brentMin.toFixed(1)} ~ ${brentMax.toFixed(1)}
            </div>
          </div>
        </div>

        {/* 메인 차트: WTI / Brent */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[16px] font-bold text-text-primary">국제유가 60일 추이</div>
            <div className="flex gap-3 text-[12px]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: "#f97316" }} /> WTI
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: "#3b82f6" }} /> Brent
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3.5 h-px border-t-2 border-dashed border-red-300 inline-block" /> 2주 전
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={oilData.map((p) => ({ ...p, date: p.date.slice(5) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="date" fontSize={11} tick={{ fill: "#9BA8B7" }} interval="preserveStartEnd" axisLine={{ stroke: "#26282F" }} tickLine={false} />
              <YAxis fontSize={11} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(v: number) => `$${v}`} axisLine={false} tickLine={false} width={50} />
              <Tooltip
                formatter={(value, name) => [`$${Number(value).toFixed(2)}/BBL`, name === "wti" ? "WTI" : "Brent"]}
                labelFormatter={(label) => `날짜: ${label}`}
                labelStyle={{ fontWeight: 600, color: "#1B2838", fontSize: 12 }}
                contentStyle={{ borderRadius: 12, border: "1px solid #E8EBF0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "8px 12px", fontSize: 12 }}
              />
              {twoWeeksAgoDate && (
                <ReferenceLine x={twoWeeksAgoDate} stroke="#fca5a5" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "2주 전", position: "top", fontSize: 12, fill: "#ef4444" }} />
              )}
              <Line type="monotone" dataKey="wti" stroke="#f97316" strokeWidth={2} dot={false} name="wti" connectNulls />
              <Line type="monotone" dataKey="brent" stroke="#3b82f6" strokeWidth={2} dot={false} name="brent" connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-3 bg-slate-50 rounded-lg px-3 py-2.5 text-[13px] text-slate-500 leading-relaxed">
            국제유가 변동은 약 <strong className="text-slate-700">2주 후</strong> 주유소 소매가에 반영됩니다.
            빨간 점선(2주 전) 기준의 유가가 현재 소매가에 영향을 주는 시점입니다.
          </div>
        </div>

        {/* 유가-소매가 시차 오버레이 차트 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[16px] font-bold text-text-primary">유가 → 소매가 시차 분석</div>
              <div className="text-[13px] text-text-secondary mt-0.5">
                Brent 유가와 2주 후 내 소매가를 같은 시점에 겹쳐 표시
              </div>
            </div>
            <button
              onClick={() => setShowRetail(!showRetail)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
                showRetail
                  ? "bg-emerald-light text-emerald border-emerald"
                  : "bg-surface-raised text-text-secondary border-border"
              }`}
            >
              소매가 {showRetail ? "ON" : "OFF"}
            </button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={overlayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="date" fontSize={11} tick={{ fill: "#9BA8B7" }} interval="preserveStartEnd" axisLine={{ stroke: "#26282F" }} tickLine={false} />
              <YAxis yAxisId="oil" fontSize={11} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 3", "dataMax + 3"]} tickFormatter={(v: number) => `$${v}`} axisLine={false} tickLine={false} width={50} />
              {showRetail && (
                <YAxis yAxisId="retail" orientation="right" fontSize={11} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 20", "dataMax + 20"]} tickFormatter={(v: number) => `${v}`} axisLine={false} tickLine={false} width={50} />
              )}
              <Tooltip
                formatter={(value, name) => {
                  if (name === "brent") return [`$${Number(value).toFixed(2)}/BBL`, "Brent"];
                  return [`${Number(value).toLocaleString()}원`, "내 소매가(2주 후)"];
                }}
                labelStyle={{ fontWeight: 600, color: "#1B2838", fontSize: 12 }}
                contentStyle={{ borderRadius: 12, border: "1px solid #E8EBF0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "8px 12px", fontSize: 12 }}
              />
              <Line yAxisId="oil" type="monotone" dataKey="brent" stroke="#3b82f6" strokeWidth={2} dot={false} name="brent" connectNulls />
              {showRetail && (
                <Line yAxisId="retail" type="monotone" dataKey="retailGasoline" stroke="#FF5252" strokeWidth={2} dot={false} name="retailGasoline" strokeDasharray="4 3" connectNulls />
              )}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-[12px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: "#3b82f6" }} /> Brent (좌축, $/BBL)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 rounded inline-block" style={{ background: "#FF5252" }} /> 내 휘발유가 2주 후 (우축, 원)
            </span>
          </div>
        </div>

        {/* 상관관계 분석 카드 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="text-[16px] font-bold text-text-primary mb-4">유가-소매가 상관관계</div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-[36px] font-extrabold text-text-primary">
                {correlation.toFixed(2)}
              </div>
              <div className="text-[13px] text-text-secondary mt-1">Pearson 상관계수</div>
            </div>
            <div className="flex-1">
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${
                    correlation >= 0.7 ? "bg-emerald-500"
                      : correlation >= 0.3 ? "bg-amber-400"
                      : "bg-gray-400"
                  }`}
                  style={{ width: `${Math.max(Math.abs(correlation) * 100, 5)}%` }}
                />
              </div>
              <div className="text-[12px] text-text-secondary leading-relaxed">
                {correlation >= 0.7
                  ? "국제유가와 소매가의 상관관계가 높습니다. 유가 변동이 2주 후 소매가에 강하게 반영되는 패턴입니다."
                  : correlation >= 0.3
                  ? "국제유가와 소매가의 상관관계가 보통 수준입니다. 유가 외 다른 요인도 소매가에 영향을 줍니다."
                  : "국제유가와 소매가의 상관관계가 낮습니다. 경쟁 환경이나 지역 요인이 더 큰 영향을 미치고 있습니다."}
              </div>
            </div>
          </div>
        </div>

        {/* 향후 전망 */}
        {summary && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[16px] font-bold text-text-primary mb-3">향후 2주 소매가 전망</div>
            <div className={`rounded-xl px-4 py-4 ${
              (summary.brentChange ?? 0) > 0 ? "bg-red-50" : (summary.brentChange ?? 0) < 0 ? "bg-blue-50" : "bg-slate-50"
            }`}>
              <div className="text-[14px] font-semibold text-text-primary leading-relaxed">
                {(summary.brentChange ?? 0) > 2
                  ? `Brent 유가가 2주간 $${summary.brentChange?.toFixed(1)} 상승했습니다. 향후 2주 내 소매가 인상 압력이 있을 수 있습니다.`
                  : (summary.brentChange ?? 0) < -2
                  ? `Brent 유가가 2주간 $${Math.abs(summary.brentChange ?? 0).toFixed(1)} 하락했습니다. 향후 2주 내 소매가 인하 여력이 생길 수 있습니다.`
                  : `Brent 유가가 2주간 큰 변동 없이 안정적입니다. 소매가 유지가 적절한 시점입니다.`}
              </div>
              <div className="text-[13px] text-text-secondary mt-2">
                * 국제유가 → 국내 소매가 반영에는 약 2주의 시차가 있으며, 실제 반영은 경쟁 환경에 따라 달라질 수 있습니다.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
