"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

// ─── 타입 ───
interface SalesAnalysis {
  summary: {
    avg30d: { gasoline: number; diesel: number };
    totalEvents: number;
    elasticity: number | null;
    elasticityLabel: "민감" | "보통" | "둔감" | "데이터 부족";
    dataRange: { from: string | null; to: string | null; totalDays: number };
  };
  events: Array<{
    date: string;
    fuel: "gasoline";
    priceBefore: number;
    priceAfter: number;
    priceChange: number;
    volumeBefore3d: number;
    volumeAfter3d: number;
    volumeChangeRate: number;
    volumeAfter7d: number | null;
    recoveryRate: number | null;
    priceSource: "price_history" | "sales_unit_price";
    elasticity: number | null;
  }>;
  dailySales: Array<{
    date: string;
    gasoline_volume: number;
    diesel_volume: number;
    gasoline_price: number | null;
    gasoline_count: number;
    diesel_count: number;
  }>;
  eventDates: string[];
  weekdayPattern: Array<{
    day: number;
    dayLabel: string;
    avgGasoline: number;
    avgDiesel: number;
  }>;
}

// ─── 헬퍼 ───
function formatDate(d: string) {
  const [, m, day] = d.split("-");
  return `${+m}/${+day}`;
}

function formatNum(n: number) {
  return n.toLocaleString();
}

export default function SalesAnalysisPage() {
  const [data, setData] = useState<SalesAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartRange, setChartRange] = useState<30 | 90>(30);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/sales-analysis`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, []);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-surface h-screen overflow-y-auto">
        <DetailHeader title="판매량 · 가격 분석" description="가격 변경이 판매량에 미치는 영향을 분석합니다" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const { summary, events, dailySales, eventDates, weekdayPattern } = data;
  const chartData = chartRange === 30 ? dailySales.slice(-30) : dailySales;

  // 요일 패턴: 월~일 순서로 재배열
  const orderedWeekday = [1, 2, 3, 4, 5, 6, 0].map((i) => weekdayPattern[i]);

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="판매량 · 가격 분석" description="가격 변경이 판매량에 미치는 영향을 분석합니다" />

      <div className="px-5 py-4 space-y-5 max-w-2xl mx-auto">

        {/* ── 1. 요약 카드 ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-border p-4">
            <p className="text-[11px] text-text-secondary m-0 mb-1">최근 30일 평균 판매량</p>
            <p className="text-[20px] font-bold text-text-primary m-0">
              {formatNum(summary.avg30d.gasoline)}<span className="text-[12px] font-normal text-text-secondary">L/일</span>
            </p>
            <p className="text-[11px] text-text-tertiary m-0 mt-0.5">
              경유 {formatNum(summary.avg30d.diesel)}L/일
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border p-4">
            <p className="text-[11px] text-text-secondary m-0 mb-1">가격 탄력성</p>
            {summary.elasticity != null ? (
              <>
                <p className="text-[20px] font-bold text-text-primary m-0">
                  {summary.elasticity}
                </p>
                <p className={`text-[11px] font-semibold m-0 mt-0.5 ${
                  summary.elasticityLabel === "민감" ? "text-red-500" :
                  summary.elasticityLabel === "둔감" ? "text-emerald-600" : "text-amber-500"
                }`}>
                  가격에 {summary.elasticityLabel} ({summary.totalEvents}건 기준)
                </p>
              </>
            ) : (
              <>
                <p className="text-[16px] font-bold text-text-tertiary m-0">—</p>
                <p className="text-[11px] text-text-tertiary m-0 mt-0.5">
                  이벤트 {summary.totalEvents}건 (데이터 축적 중)
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── 2. 판매량 추이 차트 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[14px] font-bold text-text-primary m-0">판매량 추이</h2>
            <div className="flex gap-1">
              {([30, 90] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                    chartRange === r
                      ? "bg-navy text-white border-navy"
                      : "bg-white text-text-secondary border-border hover:bg-gray-50"
                  }`}
                >
                  {r}일
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 10, fill: "#9BA8B7" }}
                  interval={chartRange === 30 ? 4 : 13}
                />
                <YAxis
                  yAxisId="volume"
                  tick={{ fontSize: 10, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${v}`}
                  width={45}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (name === "gasoline_volume") return [`${formatNum(v)}L`, "휘발유"];
                    if (name === "diesel_volume") return [`${formatNum(v)}L`, "경유"];
                    if (name === "gasoline_price") return [`${formatNum(v)}원`, "가격"];
                    return [v, String(name)];
                  }}
                  labelFormatter={(label) => formatDate(String(label))}
                />
                {eventDates.map((d) => (
                  <ReferenceLine
                    key={d}
                    x={d}
                    yAxisId="volume"
                    stroke="#ef4444"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                ))}
                <Bar yAxisId="volume" dataKey="gasoline_volume" fill="#00C073" opacity={0.3} radius={[2, 2, 0, 0]} />
                <Bar yAxisId="volume" dataKey="diesel_volume" fill="#3B82F6" opacity={0.2} radius={[2, 2, 0, 0]} />
                <Line yAxisId="price" type="stepAfter" dataKey="gasoline_price" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-text-tertiary">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-500 opacity-40" /> 휘발유(L)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500 opacity-30" /> 경유(L)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" /> 가격(원)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed border-red-400" /> 가격 변경일</span>
          </div>
        </section>

        {/* ── 3. 가격 변경 이벤트 목록 ── */}
        <section>
          <h2 className="text-[14px] font-bold text-text-primary m-0 mb-3">
            가격 변경 이벤트 ({events.length}건)
          </h2>
          {events.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-6 text-center">
              <p className="text-[13px] text-text-tertiary m-0">
                감지된 가격 변경 이벤트가 없습니다.
              </p>
              <p className="text-[11px] text-text-tertiary m-0 mt-1">
                판매 데이터가 더 쌓이면 자동으로 분석됩니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {events.slice(0, 10).map((e, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-text-primary">{formatDate(e.date)}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        e.priceChange > 0
                          ? "bg-red-50 text-red-600"
                          : "bg-blue-50 text-blue-600"
                      }`}>
                        {e.priceChange > 0 ? "+" : ""}{e.priceChange}원
                      </span>
                    </div>
                    {e.priceSource === "sales_unit_price" && (
                      <span className="text-[9px] text-text-tertiary bg-gray-100 px-1.5 py-0.5 rounded">추정</span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <p className="text-text-tertiary m-0">변경 전 3일</p>
                      <p className="font-semibold text-text-primary m-0">{formatNum(e.volumeBefore3d)}L</p>
                    </div>
                    <div>
                      <p className="text-text-tertiary m-0">변경 후 3일</p>
                      <p className="font-semibold text-text-primary m-0">{formatNum(e.volumeAfter3d)}L</p>
                    </div>
                    <div>
                      <p className="text-text-tertiary m-0">판매량 변화</p>
                      <p className={`font-bold m-0 ${
                        e.volumeChangeRate < 0 ? "text-red-500" : e.volumeChangeRate > 0 ? "text-emerald-600" : "text-text-primary"
                      }`}>
                        {e.volumeChangeRate > 0 ? "+" : ""}{e.volumeChangeRate}%
                      </p>
                    </div>
                  </div>

                  {(e.recoveryRate != null || e.elasticity != null) && (
                    <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border text-[11px]">
                      {e.recoveryRate != null && (
                        <span className="text-text-secondary">
                          1주 후: <span className={e.recoveryRate < 0 ? "text-red-500" : "text-emerald-600"}>
                            {e.recoveryRate > 0 ? "+" : ""}{e.recoveryRate}%
                          </span>
                        </span>
                      )}
                      {e.elasticity != null && (
                        <span className="text-text-secondary">
                          탄력성: <span className="font-semibold text-text-primary">{e.elasticity}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 4. 요일별 판매 패턴 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-bold text-text-primary m-0 mb-3">요일별 평균 판매량</h2>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={orderedWeekday} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: "#666" }} />
                <YAxis
                  tick={{ fontSize: 10, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (name === "avgGasoline") return [`${formatNum(v)}L`, "휘발유"];
                    if (name === "avgDiesel") return [`${formatNum(v)}L`, "경유"];
                    return [v, String(name)];
                  }}
                />
                <Bar dataKey="avgGasoline" fill="#00C073" radius={[4, 4, 0, 0]} />
                <Bar dataKey="avgDiesel" fill="#3B82F6" radius={[4, 4, 0, 0]} opacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            const maxDay = orderedWeekday.reduce((max, d) => d.avgGasoline > max.avgGasoline ? d : max, orderedWeekday[0]);
            const minDay = orderedWeekday.reduce((min, d) => d.avgGasoline < min.avgGasoline && d.avgGasoline > 0 ? d : min, orderedWeekday[0]);
            return (
              <p className="text-[11px] text-text-secondary m-0 mt-2">
                {maxDay.dayLabel}요일이 가장 많고 ({formatNum(maxDay.avgGasoline)}L), {minDay.dayLabel}요일이 가장 적습니다 ({formatNum(minDay.avgGasoline)}L)
              </p>
            );
          })()}
        </section>

        {/* ── 5. 탄력성 요약 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-bold text-text-primary m-0 mb-2">탄력성 해석</h2>
          {summary.elasticity != null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={`text-[24px] font-bold ${
                  summary.elasticityLabel === "민감" ? "text-red-500" :
                  summary.elasticityLabel === "둔감" ? "text-emerald-600" : "text-amber-500"
                }`}>
                  {summary.elasticity}
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-text-primary m-0">
                    가격에 {summary.elasticityLabel}
                  </p>
                  <p className="text-[11px] text-text-secondary m-0">
                    {summary.totalEvents}건의 가격 변경 이벤트 기준
                  </p>
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-[12px] text-text-secondary">
                {summary.elasticityLabel === "민감" ? (
                  <p className="m-0">가격 1% 변경 시 판매량이 {Math.abs(summary.elasticity)}% 이상 변동합니다. 가격 인상 시 판매량 감소 폭이 크므로, 소폭 단계적 인상을 권장합니다.</p>
                ) : summary.elasticityLabel === "둔감" ? (
                  <p className="m-0">가격 변동에 판매량이 크게 영향받지 않습니다. 가격 인상 여지가 상대적으로 큽니다.</p>
                ) : (
                  <p className="m-0">가격 변동에 보통 수준으로 반응합니다. 경쟁사 동향을 함께 고려하여 가격을 조정하세요.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-3 text-[12px] text-text-secondary">
              <p className="m-0">
                가격 변경 이벤트가 {summary.totalEvents}건으로, 탄력성을 계산하기에 데이터가 부족합니다.
                최소 3건 이상의 이벤트가 필요합니다. 데이터가 더 쌓이면 자동으로 분석됩니다.
              </p>
            </div>
          )}
        </section>

        {/* ── 6. 데이터 안내 ── */}
        <p className="text-[11px] text-text-tertiary m-0 leading-relaxed pb-6">
          * 데이터 기간: {summary.dataRange.from ? formatDate(summary.dataRange.from) : "—"} ~ {summary.dataRange.to ? formatDate(summary.dataRange.to) : "—"} ({summary.dataRange.totalDays}일)
          <br />
          * 가격 변경 감지: ±5원 이상 변동 시 이벤트로 인정. "추정" 표시는 판매 단가(매출/판매량) 기준입니다.
          <br />
          * 판매량 변화에는 요일·날씨·계절 등 가격 외 요인도 포함됩니다.
        </p>
      </div>
    </div>
  );
}
