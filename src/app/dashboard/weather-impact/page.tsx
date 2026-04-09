"use client";

import { useState, useEffect } from "react";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

// ── 타입 ──
interface ByIntensity {
  key: "dry" | "light" | "heavy";
  label: string;
  n: number;
  volumeMean: number;
  countMean: number;
  perTxnMean: number;
  volumeDiffPct: number;
  countDiffPct: number;
  perTxnDiffPct: number;
  adjustedDiffPct: number;
}

interface HeatmapCell {
  dow: number;
  intensity: "dry" | "light" | "heavy";
  n: number;
  volumeMean: number | null;
  volumeDiffPct: number | null;
}

interface AdditiveCell {
  dow: number;
  intensity: "dry" | "light" | "heavy";
  expectedVolume: number;
  diffPct: number;
}

interface Analysis {
  dataRange: { from: string; to: string; days: number };
  baseline: { volume: number; count: number; perTxn: number };
  dowMean: Record<string, number>;
  byIntensity: ByIntensity[];
  tTest: { tStat: number; significant: boolean; label: "유의함" | "참고용" } | null;
  heatmap: HeatmapCell[];
  additiveHeatmap: AdditiveCell[];
  perTxnDecomposition: {
    dry: { n: number; count: number; perTxn: number };
    heavy: { n: number; count: number | null; perTxn: number | null };
    countDiffPct: number | null;
    perTxnDiffPct: number | null;
  };
  correlation: { precipVsVolume: number; tempVsVolume: number };
  todayForecast: {
    date: string;
    dow: number;
    intensity: "dry" | "light" | "heavy";
    intensityLabel: string;
    expectedVolume: number;
    baselineForDow: number;
    diffVsDryPct: number;
    confidence: "high" | "medium" | "low";
    explanation: string;
  } | null;
}

interface Contribution {
  name: string;
  label: string;
  value: number;
  pct: number;
  n: number;
  reliable: boolean;
  badge: string;
  method: "measured" | "estimated" | "fallback";
}

interface IntegratedForecastData {
  forecast: {
    expectedVolume: number;
    expectedCount: number;
    confidence: "high" | "medium" | "low";
    explanation: string;
    baseline: number;
    baselineCount: number;
    diffVsDryPct: number;
    weatherOnly: number;
    modelVersion: string;
    totalDataDays: number;
    contributions: Contribution[];
  } | null;
  coefficients: {
    myPriceElasticity: { perWon: number; n: number; reliable: boolean } | null;
    compGapElasticity: { perWon: number; n: number; reliable: boolean } | null;
    interactions: {
      rainWeekend: { coeff: number; n: number; reliable: boolean } | null;
      rainCompDrop: { coeff: number; n: number; reliable: boolean } | null;
    };
    overallMean: number;
  };
}

const DOW_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const INTENSITY_ORDER: Array<"dry" | "light" | "heavy"> = ["dry", "light", "heavy"];
const INTENSITY_LABEL: Record<string, string> = { dry: "건조", light: "약한 비", heavy: "본격 비" };
const INTENSITY_ICON: Record<string, string> = { dry: "☀️", light: "🌦️", heavy: "🌧️" };

function cellColor(diffPct: number | null, n: number) {
  if (n < 3 || diffPct == null) return { bg: "#F1F4F8", text: "#9BA8B7" };
  const clamped = Math.max(-25, Math.min(25, diffPct));
  if (clamped >= 0) {
    const alpha = Math.min(1, clamped / 15);
    return { bg: `rgba(0, 192, 115, ${0.15 + alpha * 0.7})`, text: clamped > 10 ? "#fff" : "#1a2332" };
  } else {
    const alpha = Math.min(1, Math.abs(clamped) / 20);
    return { bg: `rgba(220, 38, 38, ${0.15 + alpha * 0.7})`, text: Math.abs(clamped) > 12 ? "#fff" : "#1a2332" };
  }
}

export default function WeatherImpactPage() {
  const [data, setData] = useState<Analysis | null>(null);
  const [integrated, setIntegrated] = useState<IntegratedForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"additive" | "observed">("additive");

  useEffect(() => {
    Promise.all([
      fetch(`/api/stations/${STATION_ID}/weather-sales-analysis`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}/integrated-forecast`).then((r) => r.json()).catch(() => null),
    ]).then(([weatherData, intData]) => {
      if (weatherData.error) {
        setError(weatherData.error);
      } else {
        setData(weatherData);
      }
      if (intData && !intData.error) setIntegrated(intData);
      setLoading(false);
    }).catch(() => {
      setError("데이터를 불러올 수 없습니다.");
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="통합 판매 예측" description="데이터 로딩 중..." />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="통합 판매 예측" description={error || "데이터 없음"} />
      </div>
    );
  }

  const ig = integrated?.forecast;
  const coeffs = integrated?.coefficients;
  const rainy = data.byIntensity.find((b) => b.key === "heavy");
  const dry = data.byIntensity.find((b) => b.key === "dry");

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto text-slate-900">
      <DetailHeader
        title="통합 판매 예측 · 분석"
        description={`${data.dataRange.from} ~ ${data.dataRange.to} · ${data.dataRange.days}일 데이터`}
      />

      <main className="w-full px-5 pb-10 max-w-6xl mx-auto">
        {/* ── 상단 요약 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 통합 예측 카드 (또는 날씨-only fallback) */}
          {(ig || data.todayForecast) && (
            <div className="bg-surface-raised rounded-2xl p-5 shadow-sm border border-border md:col-span-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-semibold text-slate-600">
                    {ig ? "통합 모델 예측" : "날씨 기반 예측"}
                  </div>
                  {ig && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      {ig.modelVersion} · {ig.totalDataDays}일
                    </span>
                  )}
                </div>
                <span className="text-[24px]">
                  {data.todayForecast ? INTENSITY_ICON[data.todayForecast.intensity] : "📊"}
                </span>
              </div>
              <div className="flex items-baseline gap-3 mb-1">
                <span className="text-[36px] font-extrabold text-slate-900 leading-tight">
                  {(ig?.expectedVolume ?? data.todayForecast?.expectedVolume)?.toLocaleString()}
                </span>
                <span className="text-[16px] font-normal text-slate-500">L 예상</span>
                {ig && (
                  <>
                    <span className="text-[28px] font-extrabold text-slate-900 leading-tight ml-2">
                      {ig.expectedCount.toLocaleString()}
                    </span>
                    <span className="text-[14px] font-normal text-slate-500">대</span>
                  </>
                )}
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                {ig?.explanation ?? data.todayForecast?.explanation}
              </div>

              {/* 변수 분해 */}
              {ig && ig.contributions.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 uppercase">변수별 기여</div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] text-slate-500">기저(요일 평균)</span>
                    <span className="text-[14px] font-bold text-slate-900">{ig.baseline.toLocaleString()}L</span>
                  </div>
                  {ig.contributions.map((c) => (
                    <div key={c.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-slate-700">{c.label}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          c.reliable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                        }`}>
                          {c.badge}
                        </span>
                      </div>
                      <span className={`text-[13px] font-bold tabular-nums ${
                        c.value > 0 ? "text-emerald-600" : c.value < 0 ? "text-red-500" : "text-slate-400"
                      }`}>
                        {c.value > 0 ? "+" : ""}{c.value.toLocaleString()}L
                        <span className="text-[10px] font-normal text-slate-400 ml-1">({c.pct > 0 ? "+" : ""}{c.pct}%)</span>
                      </span>
                    </div>
                  ))}
                  {ig.weatherOnly !== ig.expectedVolume && (
                    <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">날씨-only 모델과 차이</span>
                      <span className="text-slate-700 font-bold">
                        {ig.expectedVolume - ig.weatherOnly > 0 ? "+" : ""}{(ig.expectedVolume - ig.weatherOnly).toLocaleString()}L
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  (ig?.confidence ?? data.todayForecast?.confidence) === "high" ? "bg-emerald-100 text-emerald-700" :
                  (ig?.confidence ?? data.todayForecast?.confidence) === "medium" ? "bg-amber-100 text-amber-700" :
                  "bg-slate-100 text-slate-600"
                }`}>
                  신뢰도 {(ig?.confidence ?? data.todayForecast?.confidence) === "high" ? "높음" : (ig?.confidence ?? data.todayForecast?.confidence) === "medium" ? "중간" : "낮음"}
                </span>
              </div>
            </div>
          )}

          {/* 모델 계수 요약 */}
          {coeffs && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="text-[13px] font-semibold text-slate-800 mb-3">모델 계수</div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-slate-600 mb-0.5">내 가격 탄력성</div>
                  {coeffs.myPriceElasticity ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-extrabold">{coeffs.myPriceElasticity.perWon.toFixed(1)}L/원</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        coeffs.myPriceElasticity.reliable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        n={coeffs.myPriceElasticity.n}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-slate-500">데이터 부족</span>
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-slate-600 mb-0.5">경쟁사 가격차 탄력성</div>
                  {coeffs.compGapElasticity ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-extrabold">{coeffs.compGapElasticity.perWon.toFixed(1)}L/원</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        coeffs.compGapElasticity.reliable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        n={coeffs.compGapElasticity.n}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[12px] text-slate-500">데이터 부족</span>
                  )}
                </div>
                <div className="pt-2 border-t border-border">
                  <div className="text-[11px] text-slate-600 mb-1">교차항</div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-slate-700">비 × 주말</span>
                      {coeffs.interactions.rainWeekend ? (
                        <span className="font-bold">
                          {coeffs.interactions.rainWeekend.coeff > 0 ? "+" : ""}{Math.round(coeffs.interactions.rainWeekend.coeff)}L
                          <span className="text-[9px] text-slate-500 ml-1">n={coeffs.interactions.rainWeekend.n}</span>
                        </span>
                      ) : <span className="text-slate-400">-</span>}
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-slate-700">비 × 경쟁사 인하</span>
                      {coeffs.interactions.rainCompDrop ? (
                        <span className="font-bold">
                          {coeffs.interactions.rainCompDrop.coeff > 0 ? "+" : ""}{Math.round(coeffs.interactions.rainCompDrop.coeff)}L
                          <span className="text-[9px] text-slate-500 ml-1">n={coeffs.interactions.rainCompDrop.n}</span>
                        </span>
                      ) : <span className="text-slate-400">-</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 비 영향 + 건당 분해 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {rainy && dry && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold text-slate-800">본격 비 영향</div>
                {data.tTest && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    data.tTest.significant ? "bg-emerald/15 text-emerald" : "bg-slate-100 text-slate-700"
                  }`}>
                    {data.tTest.label}
                  </span>
                )}
              </div>
              <div className="text-[32px] font-extrabold text-red-500 leading-tight">
                {rainy.adjustedDiffPct >= 0 ? "+" : ""}{rainy.adjustedDiffPct}%
              </div>
              <div className="text-[12px] text-slate-700 mt-1">
                건조일 대비 (요일 보정 후 · n={rainy.n})
              </div>
              <div className="text-[11px] text-slate-700 mt-2 leading-relaxed">
                본격 비(≥5mm) 오는 날은 건조일보다 판매량이 평균 {Math.abs(rainy.adjustedDiffPct)}% 감소합니다.
              </div>
            </div>
          )}

          {data.perTxnDecomposition.countDiffPct != null && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="text-[13px] font-semibold text-slate-800 mb-2">비 오는 날 행동 분해</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-800">손님 수</span>
                  <span className={`text-[18px] font-extrabold ${data.perTxnDecomposition.countDiffPct < 0 ? "text-red-500" : "text-emerald"}`}>
                    {data.perTxnDecomposition.countDiffPct >= 0 ? "+" : ""}{data.perTxnDecomposition.countDiffPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-slate-800">건당 주유량</span>
                  <span className={`text-[18px] font-extrabold ${Math.abs(data.perTxnDecomposition.perTxnDiffPct ?? 0) < 2 ? "text-slate-700" : (data.perTxnDecomposition.perTxnDiffPct ?? 0) > 0 ? "text-emerald" : "text-red-500"}`}>
                    {(data.perTxnDecomposition.perTxnDiffPct ?? 0) >= 0 ? "+" : ""}{data.perTxnDecomposition.perTxnDiffPct}%
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-slate-700 mt-3 leading-relaxed">
                {Math.abs(data.perTxnDecomposition.perTxnDiffPct ?? 0) < 2
                  ? "건수만 줄고 건당 주유량은 그대로. '안 오는' 것이지 '덜 넣는' 게 아님."
                  : (data.perTxnDecomposition.perTxnDiffPct ?? 0) > 0
                    ? "건수는 줄지만 온 손님은 평소보다 더 많이 주유."
                    : "건수·건당 모두 감소."}
              </div>
            </div>
          )}
        </div>

        {/* ── 강수강도별 판매량 막대 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-slate-900 mb-1">강수 강도별 평균 판매량</h2>
          <p className="text-[12px] text-slate-800 mb-4">
            강수량 실측 기준: 건조 (&lt;1mm) · 약한 비 (1~5mm) · 본격 비 (≥5mm)
          </p>
          <div className="space-y-3">
            {data.byIntensity.map((b) => {
              const barWidth = Math.max(10, (b.volumeMean / Math.max(...data.byIntensity.map((x) => x.volumeMean))) * 100);
              return (
                <div key={b.key}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[18px]">{INTENSITY_ICON[b.key]}</span>
                      <span className="text-[14px] font-semibold text-slate-900">{b.label}</span>
                      <span className="text-[11px] text-slate-700">n={b.n}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-slate-900">{b.volumeMean.toLocaleString()}L</span>
                      <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded ${
                        b.adjustedDiffPct > 1 ? "bg-emerald/15 text-emerald"
                        : b.adjustedDiffPct < -1 ? "bg-red-50 text-red-500"
                        : "bg-slate-100 text-slate-700"
                      }`}>
                        {b.adjustedDiffPct >= 0 ? "+" : ""}{b.adjustedDiffPct}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-6 bg-slate-100 rounded-md overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-md ${
                        b.key === "dry" ? "bg-emerald/70"
                        : b.key === "light" ? "bg-amber-400/70"
                        : "bg-blue-500/70"
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                    <div className="absolute inset-y-0 left-2 flex items-center text-[11px] text-slate-800">
                      건당 {b.perTxnMean}L · 건수 {b.countMean.toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-700 mt-4 leading-relaxed border-t border-border pt-3">
            Δ% 는 요일 효과를 제거한 순수 날씨 효과입니다. 요일별 평균 판매량이 크게 다르므로(예: 금요일 {data.dowMean["5"]?.toLocaleString()}L vs 일요일 {data.dowMean["0"]?.toLocaleString()}L), 단순 평균 대신 가법 모델로 보정했습니다.
          </div>
        </section>

        {/* ── 요일 × 강수 히트맵 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[16px] font-bold text-slate-900">요일 × 강수 히트맵</h2>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setMode("additive")}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  mode === "additive" ? "bg-surface-raised text-slate-900 shadow-sm" : "text-slate-700"
                }`}
              >
                가법 모델
              </button>
              <button
                onClick={() => setMode("observed")}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  mode === "observed" ? "bg-surface-raised text-slate-900 shadow-sm" : "text-slate-700"
                }`}
              >
                관측값
              </button>
            </div>
          </div>
          <p className="text-[12px] text-slate-800 mb-4">
            {mode === "additive"
              ? "요일 효과 + 날씨 효과의 가법 모델 기대치. 모든 셀이 신뢰 가능."
              : "실제 관측 평균. n<3 셀은 표본 부족으로 회색 처리."}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-[11px] font-semibold text-slate-700 text-left p-2"></th>
                  {INTENSITY_ORDER.map((intensity) => (
                    <th key={intensity} className="text-[11px] font-semibold text-slate-700 p-2">
                      {INTENSITY_ICON[intensity]} {INTENSITY_LABEL[intensity]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOW_NAMES.map((name, dow) => (
                  <tr key={dow}>
                    <td className="text-[12px] font-semibold text-slate-800 p-2">{name}요일</td>
                    {INTENSITY_ORDER.map((intensity) => {
                      if (mode === "additive") {
                        const cell = data.additiveHeatmap.find((c) => c.dow === dow && c.intensity === intensity)!;
                        const color = cellColor(cell.diffPct, 10);
                        return (
                          <td key={intensity} className="p-1">
                            <div
                              className="rounded-lg p-2 text-center transition-transform hover:scale-105"
                              style={{ background: color.bg, color: color.text }}
                              title={`${name}요일 ${INTENSITY_LABEL[intensity]} · 가법 기대: ${cell.expectedVolume.toLocaleString()}L · baseline ${cell.diffPct >= 0 ? "+" : ""}${cell.diffPct}%`}
                            >
                              <div className="text-[13px] font-bold">{cell.expectedVolume.toLocaleString()}</div>
                              <div className="text-[10px] opacity-80">{cell.diffPct >= 0 ? "+" : ""}{cell.diffPct}%</div>
                            </div>
                          </td>
                        );
                      } else {
                        const cell = data.heatmap.find((c) => c.dow === dow && c.intensity === intensity)!;
                        const color = cellColor(cell.volumeDiffPct, cell.n);
                        return (
                          <td key={intensity} className="p-1">
                            <div
                              className="rounded-lg p-2 text-center transition-transform hover:scale-105"
                              style={{ background: color.bg, color: color.text }}
                              title={`${name}요일 ${INTENSITY_LABEL[intensity]} · n=${cell.n} · ${cell.volumeMean ? cell.volumeMean.toLocaleString() + "L" : "-"}`}
                            >
                              <div className="text-[13px] font-bold">
                                {cell.volumeMean ? cell.volumeMean.toLocaleString() : "-"}
                              </div>
                              <div className="text-[10px] opacity-80">
                                n={cell.n}{cell.volumeDiffPct != null ? ` · ${cell.volumeDiffPct >= 0 ? "+" : ""}${cell.volumeDiffPct}%` : ""}
                              </div>
                            </div>
                          </td>
                        );
                      }
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-slate-700 mt-4 leading-relaxed border-t border-border pt-3">
            셀 색상은 전체 평균(baseline) 대비 편차. 초록 = 평균 이상, 빨강 = 평균 이하. 회색 = 표본 부족(n&lt;3).
          </div>
        </section>

        {/* ── 상관계수 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-slate-900 mb-3">상관계수 (Pearson r)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[12px] text-slate-800 mb-1">강수량 × 판매량</div>
              <div className="text-[24px] font-extrabold text-slate-900">
                {data.correlation.precipVsVolume >= 0 ? "+" : ""}{data.correlation.precipVsVolume.toFixed(3)}
              </div>
              <div className="text-[11px] text-slate-700 mt-1">
                {Math.abs(data.correlation.precipVsVolume) >= 0.3
                  ? "약~중간 음의 상관: 강수량이 많을수록 판매량 감소 경향"
                  : "상관 약함"}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-slate-800 mb-1">평균기온 × 판매량</div>
              <div className="text-[24px] font-extrabold text-slate-900">
                {data.correlation.tempVsVolume >= 0 ? "+" : ""}{data.correlation.tempVsVolume.toFixed(3)}
              </div>
              <div className="text-[11px] text-amber-600 mt-1">
                참고용: 현재 데이터는 10월~4월만 포함. 여름 표본 부족으로 기온 효과 해석 제한.
              </div>
            </div>
          </div>
        </section>

        {/* ── 모델 설명 ── */}
        <section className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <h3 className="text-[14px] font-bold text-amber-900 mb-2">모델 구조 및 한계</h3>
          <ul className="text-[12px] text-amber-900 space-y-1 list-disc pl-5">
            <li>
              <strong>통합 모델:</strong> 예상판매량 = 요일기저 + 날씨보정 + 내가격효과 + 경쟁사가격차효과 + 교차항(비×주말, 비×경쟁사인하)
            </li>
            <li>모든 계수는 과거 데이터에서 자동 계산. 데이터가 쌓일수록 정교해짐.</li>
            <li>
              <strong>fallback 규칙:</strong> 교차항 사례 3건 미만 → 0으로 처리.
              경쟁사 가격차 60일 미만 → 축적 중 표시, 추정 계수 사용.
            </li>
            <li>데이터 범위: {data.dataRange.from} ~ {data.dataRange.to} ({data.dataRange.days}일). 여름(6~9월) 데이터 부재로 기온 분석은 1년 후 재평가 필요.</li>
            <li>가법 모델은 요일 효과와 날씨 효과가 독립이라고 가정. 교차항으로 일부 보정 중.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
