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

const DOW_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const INTENSITY_ORDER: Array<"dry" | "light" | "heavy"> = ["dry", "light", "heavy"];
const INTENSITY_LABEL: Record<string, string> = { dry: "건조", light: "약한 비", heavy: "본격 비" };
const INTENSITY_ICON: Record<string, string> = { dry: "☀️", light: "🌦️", heavy: "🌧️" };

// ── 셀 색상: Δ% 기준 emerald(+)↔red(-)
function cellColor(diffPct: number | null, n: number) {
  if (n < 3 || diffPct == null) return { bg: "#F1F4F8", text: "#9BA8B7" }; // 회색 (표본 부족)
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"additive" | "observed">("additive");

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/weather-sales-analysis`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
        } else {
          setData(d);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("데이터를 불러올 수 없습니다.");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="날씨 영향 분석" description="데이터 로딩 중..." />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="날씨 영향 분석" description={error || "데이터 없음"} />
      </div>
    );
  }

  const rainy = data.byIntensity.find((b) => b.key === "heavy");
  const dry = data.byIntensity.find((b) => b.key === "dry");

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader
        title="날씨 × 판매량 다차원 분석"
        description={`${data.dataRange.from} ~ ${data.dataRange.to} · ${data.dataRange.days}일 교집합`}
      />

      <main className="w-full px-5 pb-10 max-w-6xl mx-auto">
        {/* ── 상단 요약 3카드 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 오늘의 예상 판매량 */}
          {data.todayForecast && (
            <div className="bg-gradient-to-br from-navy to-[#0a1526] text-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold text-gray-300">오늘 예상 판매량</div>
                <span className="text-[24px]">{INTENSITY_ICON[data.todayForecast.intensity]}</span>
              </div>
              <div className="text-[32px] font-extrabold leading-tight">
                {data.todayForecast.expectedVolume.toLocaleString()}
                <span className="text-[16px] font-normal text-gray-300 ml-1">L</span>
              </div>
              <div className="text-[12px] text-gray-300 mt-1">{data.todayForecast.explanation}</div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  data.todayForecast.confidence === "high" ? "bg-emerald/30 text-emerald" :
                  data.todayForecast.confidence === "medium" ? "bg-amber-400/30 text-amber-300" :
                  "bg-gray-500/30 text-gray-300"
                }`}>
                  신뢰도 {data.todayForecast.confidence === "high" ? "높음" : data.todayForecast.confidence === "medium" ? "중간" : "낮음"}
                </span>
              </div>
            </div>
          )}

          {/* 본격 비 영향 */}
          {rainy && dry && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold text-text-secondary">본격 비 영향</div>
                {data.tTest && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    data.tTest.significant ? "bg-emerald/15 text-emerald" : "bg-slate-800 text-text-tertiary"
                  }`}>
                    {data.tTest.label}
                  </span>
                )}
              </div>
              <div className="text-[32px] font-extrabold text-red-500 leading-tight">
                {rainy.adjustedDiffPct >= 0 ? "+" : ""}{rainy.adjustedDiffPct}%
              </div>
              <div className="text-[12px] text-text-tertiary mt-1">
                건조일 대비 (요일 보정 후 · n={rainy.n})
              </div>
              <div className="text-[11px] text-text-tertiary mt-2 leading-relaxed">
                본격 비(≥5mm) 오는 날은 건조일보다 판매량이 평균 {Math.abs(rainy.adjustedDiffPct)}% 감소합니다.
              </div>
            </div>
          )}

          {/* 건당 주유량 분해 */}
          {data.perTxnDecomposition.countDiffPct != null && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="text-[13px] font-semibold text-text-secondary mb-2">비 오는 날 행동 분해</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-secondary">손님 수</span>
                  <span className={`text-[18px] font-extrabold ${data.perTxnDecomposition.countDiffPct < 0 ? "text-red-500" : "text-emerald"}`}>
                    {data.perTxnDecomposition.countDiffPct >= 0 ? "+" : ""}{data.perTxnDecomposition.countDiffPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-secondary">건당 주유량</span>
                  <span className={`text-[18px] font-extrabold ${Math.abs(data.perTxnDecomposition.perTxnDiffPct ?? 0) < 2 ? "text-text-tertiary" : (data.perTxnDecomposition.perTxnDiffPct ?? 0) > 0 ? "text-emerald" : "text-red-500"}`}>
                    {(data.perTxnDecomposition.perTxnDiffPct ?? 0) >= 0 ? "+" : ""}{data.perTxnDecomposition.perTxnDiffPct}%
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-text-tertiary mt-3 leading-relaxed">
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
          <h2 className="text-[16px] font-bold text-text-primary mb-1">강수 강도별 평균 판매량</h2>
          <p className="text-[12px] text-text-secondary mb-4">
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
                      <span className="text-[14px] font-semibold text-text-primary">{b.label}</span>
                      <span className="text-[11px] text-text-tertiary">n={b.n}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold text-text-primary">{b.volumeMean.toLocaleString()}L</span>
                      <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded ${
                        b.adjustedDiffPct > 1 ? "bg-emerald/15 text-emerald"
                        : b.adjustedDiffPct < -1 ? "bg-red-950/30 text-red-500"
                        : "bg-slate-800 text-text-tertiary"
                      }`}>
                        {b.adjustedDiffPct >= 0 ? "+" : ""}{b.adjustedDiffPct}%
                      </span>
                    </div>
                  </div>
                  <div className="relative h-6 bg-slate-800 rounded-md overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-md ${
                        b.key === "dry" ? "bg-emerald/70"
                        : b.key === "light" ? "bg-amber-400/70"
                        : "bg-blue-500/70"
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                    <div className="absolute inset-y-0 left-2 flex items-center text-[11px] text-text-secondary">
                      건당 {b.perTxnMean}L · 건수 {b.countMean.toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-text-tertiary mt-4 leading-relaxed border-t border-border pt-3">
            Δ% 는 요일 효과를 제거한 순수 날씨 효과입니다. 요일별 평균 판매량이 크게 다르므로(예: 금요일 {data.dowMean["5"]?.toLocaleString()}L vs 일요일 {data.dowMean["0"]?.toLocaleString()}L), 단순 평균 대신 가법 모델로 보정했습니다.
          </div>
        </section>

        {/* ── 요일 × 강수 히트맵 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[16px] font-bold text-text-primary">요일 × 강수 히트맵</h2>
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setMode("additive")}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  mode === "additive" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary"
                }`}
              >
                가법 모델
              </button>
              <button
                onClick={() => setMode("observed")}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                  mode === "observed" ? "bg-surface-raised text-text-primary shadow-sm" : "text-text-tertiary"
                }`}
              >
                관측값
              </button>
            </div>
          </div>
          <p className="text-[12px] text-text-secondary mb-4">
            {mode === "additive"
              ? "요일 효과 + 날씨 효과의 가법 모델 기대치. 모든 셀이 신뢰 가능."
              : "실제 관측 평균. n<3 셀은 표본 부족으로 회색 처리."}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-[11px] font-semibold text-text-tertiary text-left p-2"></th>
                  {INTENSITY_ORDER.map((intensity) => (
                    <th key={intensity} className="text-[11px] font-semibold text-text-tertiary p-2">
                      {INTENSITY_ICON[intensity]} {INTENSITY_LABEL[intensity]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOW_NAMES.map((name, dow) => (
                  <tr key={dow}>
                    <td className="text-[12px] font-semibold text-text-secondary p-2">{name}요일</td>
                    {INTENSITY_ORDER.map((intensity) => {
                      if (mode === "additive") {
                        const cell = data.additiveHeatmap.find((c) => c.dow === dow && c.intensity === intensity)!;
                        const color = cellColor(cell.diffPct, 10); // 가법 모델은 n 제한 없음
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

          <div className="text-[11px] text-text-tertiary mt-4 leading-relaxed border-t border-border pt-3">
            셀 색상은 전체 평균(baseline) 대비 편차. 초록 = 평균 이상, 빨강 = 평균 이하. 회색 = 표본 부족(n&lt;3).
          </div>
        </section>

        {/* ── 상관계수 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-text-primary mb-3">상관계수 (Pearson r)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[12px] text-text-secondary mb-1">강수량 × 판매량</div>
              <div className="text-[24px] font-extrabold text-text-primary">
                {data.correlation.precipVsVolume >= 0 ? "+" : ""}{data.correlation.precipVsVolume.toFixed(3)}
              </div>
              <div className="text-[11px] text-text-tertiary mt-1">
                {Math.abs(data.correlation.precipVsVolume) >= 0.3
                  ? "약~중간 음의 상관: 강수량이 많을수록 판매량 감소 경향"
                  : "상관 약함"}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-text-secondary mb-1">평균기온 × 판매량</div>
              <div className="text-[24px] font-extrabold text-text-primary">
                {data.correlation.tempVsVolume >= 0 ? "+" : ""}{data.correlation.tempVsVolume.toFixed(3)}
              </div>
              <div className="text-[11px] text-amber-600 mt-1">
                ⚠️ 참고용: 현재 데이터는 10월~4월만 포함. 여름 표본 부족으로 기온 효과 해석 제한.
              </div>
            </div>
          </div>
        </section>

        {/* ── 하단 주의사항 ── */}
        <section className="bg-amber-950/30 border border-amber-900/60 rounded-2xl p-5">
          <h3 className="text-[14px] font-bold text-amber-900 mb-2">📌 분석 한계</h3>
          <ul className="text-[12px] text-amber-900 space-y-1 list-disc pl-5">
            <li>데이터 범위: {data.dataRange.from} ~ {data.dataRange.to} ({data.dataRange.days}일). 여름(6~9월) 데이터 부재로 기온 분석은 1년 후 재평가 필요.</li>
            <li>강수 강도 분류는 Open-Meteo 관측값(precipitation_mm) 기준. 예보 기반 오늘 예측은 예보 정확도에 영향받음.</li>
            <li>가법 모델은 요일 효과와 날씨 효과가 독립이라고 가정. 실제로는 "비 오는 주말 → 더 큰 감소" 같은 교호작용이 있을 수 있음 (표본 더 쌓인 뒤 검토).</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
