"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

interface CrossData {
  weatherTriple: {
    sameDay: Array<{ intensity: string; label: string; fuelCount: number; carwashCount: number; conversionPct: number | null; n: number }>;
    nextDay: Array<{ prevIntensity: string; label: string; fuelCount: number; carwashCount: number; conversionPct: number | null; n: number }>;
    tempBand: Array<{ band: string; label: string; carwashAvg: number; fuelAvg: number; n: number }>;
    carwashDrivenFuel: boolean;
    insight: string;
  };
  competitorCascade: { dataStatus: string; daysCollected: number; daysNeeded: number; insight: string };
  dowProfile: Array<{ dow: number; label: string; premiumPct: number; conversionPct: number; fuelPerTxn: number; avgCarwash: number; avgFuel: number; n: number }>;
  similarDays: {
    todayConditions: { dowLabel: string; oilDirection: string; weather: string; tempBand: string | null };
    matches: Array<{ date: string; fuelCount: number; carwashCount: number; conversionPct: number; matchScore: number; conditions: string }>;
    avgFuelCount: number | null;
    avgCarwashCount: number | null;
    avgConversionPct: number | null;
    confidence: string;
    insight: string;
  };
  dataRange: { from: string; to: string; totalDays: number };
}

export default function CrossInsightsPage() {
  const [data, setData] = useState<CrossData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/cross-insights`)
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface text-slate-900">
        <DetailHeader title="크로스 인사이트" description="데이터 교차 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4"><div className="h-48 bg-slate-100 rounded-xl" /><div className="h-48 bg-slate-100 rounded-xl" /></div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface text-slate-900">
        <DetailHeader title="크로스 인사이트" description="데이터 교차 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="bg-surface-raised rounded-xl p-8 border border-border text-center text-slate-800">데이터를 불러올 수 없습니다.</div>
        </div>
      </div>
    );
  }

  const wt = data.weatherTriple;
  const sd = data.similarDays;

  return (
    <div className="min-h-screen bg-surface text-slate-900 h-screen overflow-y-auto">
      <DetailHeader
        title="크로스 인사이트"
        description={`${data.dataRange.totalDays}일 교차 분석 (${data.dataRange.from} ~ ${data.dataRange.to})`}
      />

      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-6">

        {/* 핵심 발견 배너 */}
        <div className={`rounded-xl p-5 border ${wt.carwashDrivenFuel ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
          <div className="text-[15px] font-bold text-slate-900 mb-1">
            {wt.carwashDrivenFuel ? "✓ 세차 드리븐 주유 확인" : "세차와 주유는 독립적"}
          </div>
          <div className="text-[13px] text-slate-800">{wt.insight}</div>
        </div>

        {/* ── 분석 1: 날씨 × 세차 × 주유 3중 교차 ── */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-slate-900 m-0 mb-4">날씨 × 세차 × 주유 3중 교차</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 당일 효과 */}
            <div>
              <h3 className="text-[13px] font-bold text-slate-800 m-0 mb-3">당일 날씨 효과</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-slate-700 font-semibold">날씨</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">주유</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">세차</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">전환율</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wt.sameDay.map(r => (
                      <tr key={r.intensity} className="border-b border-border/50">
                        <td className="py-2 font-medium text-slate-900">{r.label}</td>
                        <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{r.fuelCount}대</td>
                        <td className="py-2 text-right font-bold text-purple-600" style={{ fontVariantNumeric: "tabular-nums" }}>{r.carwashCount}대</td>
                        <td className="py-2 text-right font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{r.conversionPct ?? "-"}%</td>
                        <td className="py-2 text-right text-slate-700">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* lag-1 효과 */}
            <div>
              <h3 className="text-[13px] font-bold text-slate-800 m-0 mb-3">비 다음날 효과 (lag-1)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-slate-700 font-semibold">전날 날씨</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">주유</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">세차</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">전환율</th>
                      <th className="text-right py-2 text-slate-700 font-semibold">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wt.nextDay.map(r => {
                      const dryConv = wt.nextDay.find(d => d.prevIntensity === "dry")?.conversionPct ?? 0;
                      const diff = r.conversionPct != null && dryConv ? +(r.conversionPct - dryConv).toFixed(1) : null;
                      return (
                        <tr key={r.prevIntensity} className="border-b border-border/50">
                          <td className="py-2 font-medium text-slate-900">{r.label}</td>
                          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{r.fuelCount}대</td>
                          <td className="py-2 text-right font-bold text-purple-600" style={{ fontVariantNumeric: "tabular-nums" }}>{r.carwashCount}대</td>
                          <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                            <span className="font-bold">{r.conversionPct ?? "-"}%</span>
                            {diff != null && r.prevIntensity !== "dry" && (
                              <span className={`ml-1 text-[11px] font-bold ${diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {diff >= 0 ? "+" : ""}{diff}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right text-slate-700">{r.n}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 기온대별 */}
          <div className="mt-6 pt-4 border-t border-border">
            <h3 className="text-[13px] font-bold text-slate-800 m-0 mb-3">기온대별</h3>
            <div className="flex gap-4">
              {wt.tempBand.map(t => (
                <div key={t.band} className="flex-1 rounded-lg border border-border p-4 text-center">
                  <div className="text-[12px] text-slate-700 mb-1">{t.label}</div>
                  <div className="text-[18px] font-extrabold text-purple-500" style={{ fontVariantNumeric: "tabular-nums" }}>{t.carwashAvg}<span className="text-[11px] text-slate-700 ml-0.5">대</span></div>
                  <div className="text-[12px] text-slate-800">주유 {t.fuelAvg}대</div>
                  <div className="text-[10px] text-slate-700">n={t.n}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 분석 3: 요일 × 세차 프로파일 ── */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-slate-900 m-0 mb-4">요일 × 세차 프로파일</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 전환율 + 프리미엄 비율 차트 */}
            <div>
              <h3 className="text-[13px] font-bold text-slate-800 m-0 mb-3">전환율 · 프리미엄 비율</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.dowProfile} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B7280" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} unit="%" />
                  <Tooltip content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const p = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] shadow-md">
                        <div className="font-bold">{p.label}요일</div>
                        <div>전환율: <span className="font-bold text-purple-600">{p.conversionPct}%</span></div>
                        <div>프리미엄: <span className="font-bold text-blue-600">{p.premiumPct}%</span></div>
                        <div>세차 {p.avgCarwash}대 / 주유 {p.avgFuel}대</div>
                      </div>
                    );
                  }} />
                  <Bar dataKey="conversionPct" fill="#8B5CF6" name="전환율" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="premiumPct" fill="#60A5FA" name="프리미엄" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-1 text-[11px] text-slate-700">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-purple-500 inline-block" />전환율</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-400 inline-block" />프리미엄 비율</span>
              </div>
            </div>

            {/* 건당 주유량 테이블 */}
            <div>
              <h3 className="text-[13px] font-bold text-slate-800 m-0 mb-3">요일별 상세</h3>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-slate-700 font-semibold">요일</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">세차</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">주유</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">건당L</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">전환율</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">프리미엄</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dowProfile.map(d => (
                    <tr key={d.dow} className="border-b border-border/50">
                      <td className="py-2 font-bold text-slate-900">{d.label}</td>
                      <td className="py-2 text-right text-purple-600 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{d.avgCarwash}</td>
                      <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{d.avgFuel}</td>
                      <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{d.fuelPerTxn}L</td>
                      <td className="py-2 text-right font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{d.conversionPct}%</td>
                      <td className="py-2 text-right text-blue-600" style={{ fontVariantNumeric: "tabular-nums" }}>{d.premiumPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── 분석 4: 유사 사례 매칭 ── */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-slate-900 m-0 mb-2">오늘과 유사한 과거 사례</h2>
          <div className="text-[12px] text-slate-700 mb-4">
            오늘 조건: {sd.todayConditions.dowLabel}요일 · {sd.todayConditions.weather === "dry" ? "맑음" : sd.todayConditions.weather === "light" ? "약한비" : "강한비"}
            {sd.todayConditions.tempBand && ` · ${sd.todayConditions.tempBand === "cold" ? "10도 미만" : "10도 이상"}`}
            {` · 유가 ${sd.todayConditions.oilDirection === "rising" ? "상승" : sd.todayConditions.oilDirection === "falling" ? "하락" : "횡보"}`}
          </div>

          {sd.matches.length > 0 ? (
            <>
              {sd.avgFuelCount && sd.avgCarwashCount && (
                <div className="rounded-lg bg-purple-50 border border-purple-200 p-4 mb-4">
                  <div className="text-[13px] font-bold text-purple-700">
                    유사 {sd.matches.length}일 평균
                    <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-full ${sd.confidence === "high" ? "bg-emerald-100 text-emerald-700" : sd.confidence === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-800"}`}>
                      {sd.confidence === "high" ? "신뢰↑" : sd.confidence === "medium" ? "보통" : "참고"}
                    </span>
                  </div>
                  <div className="flex gap-6 mt-2 text-[14px]">
                    <div>주유 <span className="font-extrabold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>{sd.avgFuelCount}</span>대</div>
                    <div>세차 <span className="font-extrabold text-purple-600" style={{ fontVariantNumeric: "tabular-nums" }}>{sd.avgCarwashCount}</span>대</div>
                    <div>전환율 <span className="font-extrabold text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>{sd.avgConversionPct}%</span></div>
                  </div>
                </div>
              )}
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-slate-700 font-semibold">날짜</th>
                    <th className="text-left py-2 text-slate-700 font-semibold">조건</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">주유</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">세차</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">전환율</th>
                    <th className="text-right py-2 text-slate-700 font-semibold">유사도</th>
                  </tr>
                </thead>
                <tbody>
                  {sd.matches.map(m => (
                    <tr key={m.date} className="border-b border-border/50">
                      <td className="py-2 text-slate-900">{m.date.slice(5)}</td>
                      <td className="py-2 text-slate-800 text-[12px]">{m.conditions}</td>
                      <td className="py-2 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{m.fuelCount}</td>
                      <td className="py-2 text-right text-purple-600 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{m.carwashCount}</td>
                      <td className="py-2 text-right font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{m.conversionPct}%</td>
                      <td className="py-2 text-right">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${m.matchScore >= 7 ? "bg-emerald-50 text-emerald-600" : m.matchScore >= 5 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-500"}`}>
                          {m.matchScore}점
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-[14px] text-slate-700 text-center py-8">유사 사례가 부족합니다. 데이터가 축적되면 표시됩니다.</div>
          )}
        </div>

        {/* ── 분석 2: 경쟁사 연쇄 (축적 중) ── */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-slate-900 m-0 mb-2">경쟁사 → 주유 → 세차 연쇄 효과</h2>
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="text-[14px] text-slate-700">⏳ {data.competitorCascade.insight}</div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-purple-400 h-2 rounded-full transition-all"
              style={{ width: `${(data.competitorCascade.daysCollected / data.competitorCascade.daysNeeded) * 100}%` }}
            />
          </div>
          <div className="text-[11px] text-slate-700 mt-1 text-right">{data.competitorCascade.daysCollected}/{data.competitorCascade.daysNeeded}일</div>
        </div>
      </div>
    </div>
  );
}
