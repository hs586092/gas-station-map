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
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
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
  competitorGap: {
    points: Array<{
      date: string;
      myPrice: number;
      compAvg: number;
      gap: number;
      gasoline_volume: number;
    }>;
    buckets: Array<{
      label: string;
      range: string;
      avgVolume: number;
      count: number;
    }>;
    totalDays: number;
    insight: string;
  };
  keyCompetitorAnalysis: {
    competitors: Array<{
      stationId: string;
      name: string;
      points: Array<{ date: string; gap: number; gasoline_volume: number }>;
      buckets: Array<{ range: string; avgVolume: number; count: number }>;
      correlation: number | null;
      totalDays: number;
    }>;
    insight: string;
    totalDays: number;
  };
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

  const { summary, events, dailySales, eventDates, weekdayPattern, competitorGap, keyCompetitorAnalysis } = data;
  const chartData = chartRange === 30 ? dailySales.slice(-30) : dailySales;

  // 요일 패턴: 월~일 순서로 재배열
  const orderedWeekday = [1, 2, 3, 4, 5, 6, 0].map((i) => weekdayPattern[i]);

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="판매량 · 가격 분석" description="가격 변경이 판매량에 미치는 영향을 분석합니다" />

      <main className="px-5 pb-10 space-y-5">

        {/* ── 1. 요약 카드 ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-[12px] text-text-secondary m-0 mb-1">최근 30일 평균 판매량</p>
            <p className="text-[28px] font-bold text-text-primary m-0">
              {formatNum(summary.avg30d.gasoline)}<span className="text-[14px] font-normal text-text-secondary ml-1">L/일</span>
            </p>
            <p className="text-[12px] text-text-tertiary m-0 mt-1">
              경유 {formatNum(summary.avg30d.diesel)}L/일
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <p className="text-[12px] text-text-secondary m-0 mb-1">가격 탄력성</p>
            {summary.elasticity != null ? (
              <>
                <p className="text-[28px] font-bold text-text-primary m-0">
                  {summary.elasticity}
                </p>
                <p className={`text-[13px] font-semibold m-0 mt-0.5 ${
                  summary.elasticityLabel === "민감" ? "text-red-500" :
                  summary.elasticityLabel === "둔감" ? "text-emerald-600" : "text-amber-500"
                }`}>
                  가격에 {summary.elasticityLabel} ({summary.totalEvents}건 기준)
                </p>
              </>
            ) : (
              <>
                <p className="text-[16px] font-bold text-text-tertiary m-0">—</p>
                <p className="text-[13px] text-text-tertiary m-0 mt-0.5">
                  이벤트 {summary.totalEvents}건 (데이터 축적 중)
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── 2. 판매량 추이 차트 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-text-primary m-0">판매량 추이</h2>
            <div className="flex gap-1">
              {([30, 90] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setChartRange(r)}
                  className={`px-2.5 py-1 text-[13px] rounded-full border transition-colors ${
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
          <div style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fontSize: 12, fill: "#9BA8B7" }}
                  interval={chartRange === 30 ? 4 : 13}
                />
                <YAxis
                  yAxisId="volume"
                  tick={{ fontSize: 12, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 12, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${v}`}
                  width={45}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
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
          <div className="flex items-center gap-4 mt-2 text-[12px] text-text-tertiary">
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-emerald-500 opacity-40" /> 휘발유(L)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500 opacity-30" /> 경유(L)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500" /> 가격(원)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0 border-t border-dashed border-red-400" /> 가격 변경일</span>
          </div>
        </section>

        {/* ── 3. 가격 변경 이벤트 목록 ── */}
        <section>
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">
            가격 변경 이벤트 ({events.length}건)
          </h2>
          {events.length === 0 ? (
            <div className="bg-white rounded-xl border border-border p-6 text-center">
              <p className="text-[13px] text-text-tertiary m-0">
                감지된 가격 변경 이벤트가 없습니다.
              </p>
              <p className="text-[13px] text-text-tertiary m-0 mt-1">
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
                      <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${
                        e.priceChange > 0
                          ? "bg-red-50 text-red-600"
                          : "bg-blue-50 text-blue-600"
                      }`}>
                        {e.priceChange > 0 ? "+" : ""}{e.priceChange}원
                      </span>
                    </div>
                    {e.priceSource === "sales_unit_price" && (
                      <span className="text-[12px] text-text-tertiary bg-gray-100 px-1.5 py-0.5 rounded">추정</span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[13px]">
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
                    <div className="flex items-center gap-4 mt-2 pt-2 border-t border-border text-[13px]">
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
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-3">요일별 평균 판매량</h2>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={orderedWeekday} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="dayLabel" tick={{ fontSize: 12, fill: "#666" }} />
                <YAxis
                  tick={{ fontSize: 12, fill: "#9BA8B7" }}
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
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
              <p className="text-[13px] text-text-secondary m-0 mt-2">
                {maxDay.dayLabel}요일이 가장 많고 ({formatNum(maxDay.avgGasoline)}L), {minDay.dayLabel}요일이 가장 적습니다 ({formatNum(minDay.avgGasoline)}L)
              </p>
            );
          })()}
        </section>

        {/* ── 5. 탄력성 요약 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-[16px] font-bold text-text-primary m-0 mb-2">탄력성 해석</h2>
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
                  <p className="text-[13px] text-text-secondary m-0">
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

        {/* ── 6. 경쟁사 가격 차이 vs 판매량 ── */}
        <section className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[16px] font-bold text-text-primary m-0">경쟁사 대비 가격 차이 vs 판매량</h2>
            <span className="text-[12px] text-text-tertiary bg-gray-100 px-2 py-0.5 rounded">
              데이터 {competitorGap.totalDays}일
            </span>
          </div>

          {competitorGap.totalDays < 7 ? (
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-[13px] text-text-tertiary m-0">
                데이터 축적 중 ({competitorGap.totalDays}일)
              </p>
              <p className="text-[13px] text-text-tertiary m-0 mt-1">
                price_history 기반으로 경쟁사 평균 가격을 비교합니다. 최소 7일 이상의 데이터가 필요합니다.
              </p>
            </div>
          ) : (
            <>
              {/* 구간별 평균 판매량 */}
              <div className="space-y-1.5 mb-4">
                {competitorGap.buckets.map((b, i) => {
                  const maxVol = Math.max(...competitorGap.buckets.filter((x) => x.count > 0).map((x) => x.avgVolume), 1);
                  const pct = b.count > 0 ? (b.avgVolume / maxVol) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[12px] text-text-secondary w-[90px] shrink-0 text-right">{b.range}</span>
                      <div className="flex-1 h-5 bg-gray-50 rounded-full overflow-hidden relative">
                        {b.count > 0 && (
                          <div
                            className={`h-full rounded-full ${
                              i <= 1 ? "bg-emerald-400" : i === 2 ? "bg-gray-300" : "bg-red-400"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        )}
                      </div>
                      <span className="text-[12px] font-semibold text-text-primary w-[60px] shrink-0">
                        {b.count > 0 ? `${formatNum(b.avgVolume)}L` : "—"}
                      </span>
                      <span className="text-[12px] text-text-tertiary w-[30px] shrink-0">
                        {b.count}일
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 산점도 */}
              {competitorGap.points.length >= 7 && (
                <div style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        type="number"
                        dataKey="gap"
                        name="가격 차이"
                        tick={{ fontSize: 12, fill: "#9BA8B7" }}
                        tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
                        label={{ value: "경쟁사 대비 가격 차이(원)", position: "bottom", offset: -2, style: { fontSize: 12, fill: "#9BA8B7" } }}
                      />
                      <YAxis
                        type="number"
                        dataKey="gasoline_volume"
                        name="판매량"
                        tick={{ fontSize: 12, fill: "#9BA8B7" }}
                        tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                        width={40}
                      />
                      <ZAxis range={[30, 30]} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(value, name) => {
                          if (name === "가격 차이") return [`${Number(value) > 0 ? "+" : ""}${value}원`, name];
                          if (name === "판매량") return [`${formatNum(Number(value))}L`, name];
                          return [value, String(name)];
                        }}
                        labelFormatter={() => ""}
                      />
                      <ReferenceLine x={0} stroke="#666" strokeDasharray="3 3" />
                      <Scatter data={competitorGap.points}>
                        {competitorGap.points.map((p, i) => (
                          <Cell key={i} fill={p.gap <= -10 ? "#34D399" : p.gap >= 10 ? "#F87171" : "#9CA3AF"} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 인사이트 */}
              {competitorGap.insight && (
                <div className="bg-gray-50 rounded-lg p-3 mt-3 text-[12px] text-text-secondary">
                  <p className="m-0">{competitorGap.insight}</p>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── 7. 주요 경쟁사 개별 분석 ── */}
        {keyCompetitorAnalysis.competitors.length > 0 && (
          <section className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[16px] font-bold text-text-primary m-0">주요 경쟁사별 가격 차이 vs 판매량</h2>
              <span className="text-[12px] text-text-tertiary bg-gray-100 px-2 py-0.5 rounded">
                데이터 {keyCompetitorAnalysis.totalDays}일
              </span>
            </div>

            {keyCompetitorAnalysis.totalDays < 7 ? (
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-[13px] text-text-tertiary m-0">
                  데이터 축적 중 ({keyCompetitorAnalysis.totalDays}일)
                </p>
                <p className="text-[13px] text-text-tertiary m-0 mt-1">
                  price_history 기반 (3/15 이후). 최소 7일 이상의 데이터가 필요합니다.
                </p>
              </div>
            ) : (
              <>
                {/* 상관계수 비교 바 */}
                <div className="mb-4">
                  <p className="text-[13px] text-text-secondary m-0 mb-2">상관계수 (가격 차이↑ → 판매량 변화)</p>
                  <div className="space-y-2">
                    {keyCompetitorAnalysis.competitors.map((c, i) => {
                      const corr = c.correlation ?? 0;
                      const absPct = Math.min(Math.abs(corr) * 100, 100);
                      const isNeg = corr < 0;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[13px] text-text-primary font-medium w-[100px] shrink-0 truncate">{c.name}</span>
                          <div className="flex-1 h-4 bg-gray-50 rounded-full overflow-hidden relative flex">
                            {/* 중앙 기준 바 */}
                            <div className="w-1/2 flex justify-end">
                              {isNeg && (
                                <div className="bg-red-400 h-full rounded-l-full" style={{ width: `${absPct}%` }} />
                              )}
                            </div>
                            <div className="w-px bg-gray-300 shrink-0" />
                            <div className="w-1/2">
                              {!isNeg && corr > 0 && (
                                <div className="bg-emerald-400 h-full rounded-r-full" style={{ width: `${absPct}%` }} />
                              )}
                            </div>
                          </div>
                          <span className={`text-[13px] font-bold w-[45px] shrink-0 text-right ${
                            corr < -0.3 ? "text-red-500" : corr > 0.3 ? "text-emerald-600" : "text-gray-400"
                          }`}>
                            {c.correlation != null ? c.correlation.toFixed(2) : "—"}
                          </span>
                          <span className="text-[12px] text-text-tertiary w-[25px] shrink-0">{c.totalDays}일</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-text-tertiary m-0 mt-1.5">
                    음수(빨강): 가격 차이가 벌어지면 판매량 감소 / 양수(녹색): 가격 차이와 판매량 동시 증가
                  </p>
                </div>

                {/* 산점도 (4색 통합) */}
                {(() => {
                  const COMP_COLORS = ["#3B82F6", "#EF4444", "#F59E0B", "#8B5CF6"];
                  const allScatterData = keyCompetitorAnalysis.competitors.flatMap((c, ci) =>
                    c.points.map((p) => ({ ...p, compName: c.name, colorIdx: ci }))
                  );
                  if (allScatterData.length < 7) return null;
                  return (
                    <div className="mb-4">
                      <p className="text-[13px] text-text-secondary m-0 mb-2">경쟁사별 가격 차이 vs 일 판매량</p>
                      <div style={{ height: 320 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis
                              type="number"
                              dataKey="gap"
                              name="가격 차이"
                              tick={{ fontSize: 12, fill: "#9BA8B7" }}
                              tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v}`}
                              label={{ value: "내 가격 - 경쟁사 가격(원)", position: "bottom", offset: 0, style: { fontSize: 12, fill: "#9BA8B7" } }}
                            />
                            <YAxis
                              type="number"
                              dataKey="gasoline_volume"
                              name="판매량"
                              tick={{ fontSize: 12, fill: "#9BA8B7" }}
                              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                              width={40}
                            />
                            <ZAxis range={[25, 25]} />
                            <Tooltip
                              contentStyle={{ fontSize: 12, borderRadius: 8 }}
                              formatter={(value, name) => {
                                if (name === "가격 차이") return [`${Number(value) > 0 ? "+" : ""}${value}원`, name];
                                if (name === "판매량") return [`${formatNum(Number(value))}L`, name];
                                return [value, String(name)];
                              }}
                              labelFormatter={() => ""}
                            />
                            <ReferenceLine x={0} stroke="#666" strokeDasharray="3 3" />
                            {keyCompetitorAnalysis.competitors.map((c, ci) => (
                              <Scatter
                                key={c.stationId}
                                name={c.name}
                                data={c.points}
                                fill={COMP_COLORS[ci % COMP_COLORS.length]}
                                opacity={0.7}
                              />
                            ))}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-1">
                        {keyCompetitorAnalysis.competitors.map((c, ci) => (
                          <span key={ci} className="flex items-center gap-1 text-[12px] text-text-secondary">
                            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: COMP_COLORS[ci % COMP_COLORS.length] }} />
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* 경쟁사별 구간 테이블 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-text-secondary">
                        <th className="text-left px-2 py-1.5 font-semibold border-b border-border">경쟁사</th>
                        {["-30↓", "-30~-10", "±10", "+10~+30", "+30↑"].map((r) => (
                          <th key={r} className="text-right px-2 py-1.5 font-semibold border-b border-border whitespace-nowrap">{r}</th>
                        ))}
                        <th className="text-right px-2 py-1.5 font-semibold border-b border-border">상관계수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keyCompetitorAnalysis.competitors.map((c, ci) => (
                        <tr key={ci} className="border-b border-border last:border-0">
                          <td className="px-2 py-2 font-medium text-text-primary">{c.name}</td>
                          {c.buckets.map((b, bi) => (
                            <td key={bi} className="text-right px-2 py-2 text-text-secondary">
                              {b.count > 0 ? (
                                <span>
                                  {formatNum(b.avgVolume)}<span className="text-[12px] text-text-tertiary">L</span>
                                  <span className="text-[12px] text-text-tertiary ml-0.5">({b.count})</span>
                                </span>
                              ) : "—"}
                            </td>
                          ))}
                          <td className={`text-right px-2 py-2 font-bold ${
                            (c.correlation ?? 0) < -0.3 ? "text-red-500" :
                            (c.correlation ?? 0) > 0.3 ? "text-emerald-600" : "text-gray-400"
                          }`}>
                            {c.correlation != null ? c.correlation.toFixed(2) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 인사이트 */}
                {keyCompetitorAnalysis.insight && (
                  <div className="bg-gray-50 rounded-lg p-3 mt-3 text-[12px] text-text-secondary">
                    <p className="m-0">💡 {keyCompetitorAnalysis.insight}</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── 8. 데이터 안내 ── */}
        <p className="text-[13px] text-text-tertiary m-0 leading-relaxed pb-6">
          * 데이터 기간: {summary.dataRange.from ? formatDate(summary.dataRange.from) : "—"} ~ {summary.dataRange.to ? formatDate(summary.dataRange.to) : "—"} ({summary.dataRange.totalDays}일)
          <br />
          * 가격 변경 감지: ±5원 이상 변동 시 이벤트로 인정. "추정" 표시는 판매 단가(매출/판매량) 기준입니다.
          <br />
          * 판매량 변화에는 요일·날씨·계절 등 가격 외 요인도 포함됩니다.
        </p>
      </main>
    </div>
  );
}
