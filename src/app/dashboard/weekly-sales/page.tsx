"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일 (JS dow)

interface DailySale {
  date: string;
  gasoline_volume: number;
  diesel_volume: number;
  gasoline_count: number;
  diesel_count: number;
}

interface WeekData {
  weekLabel: string;
  mondayStr: string;
  days: Array<{
    date: string;
    dow: number;
    dowLabel: string;
    total: number;
    gasoline: number;
    diesel: number;
    count: number;
  }>;
  total: number;
  avgPerDay: number;
}

function getKSTToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function dowFromStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function getMondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export default function WeeklySalesPage() {
  const [dailySales, setDailySales] = useState<DailySale[] | null>(null);
  const [dowMean, setDowMean] = useState<Record<number, number> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/stations/${STATION_ID}/sales-analysis`).then(r => r.json()),
      fetch(`/api/stations/${STATION_ID}/integrated-forecast`).then(r => r.json()).catch(() => null),
    ]).then(([salesData, intData]) => {
      if (salesData?.dailySales) setDailySales(salesData.dailySales);
      if (intData?.coefficients?.dowMean) setDowMean(intData.coefficients.dowMean);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="주간 판매 분석" description="데이터 로딩 중..." />
      </div>
    );
  }

  if (!dailySales || dailySales.length === 0) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="주간 판매 분석" description="데이터가 부족합니다." />
      </div>
    );
  }

  const todayStr = getKSTToday();

  // ── 주차별 데이터 구성 (최근 8주) ──
  const weeks: WeekData[] = [];
  const thisMon = getMondayOf(todayStr);

  for (let w = 0; w < 8; w++) {
    const monday = addDays(thisMon, -7 * w);
    const sunday = addDays(monday, 6);
    const weekDays: WeekData["days"] = [];

    for (let d = 0; d < 7; d++) {
      const dateStr = addDays(monday, d);
      const sale = dailySales.find(s => s.date === dateStr);
      const gas = sale ? Number(sale.gasoline_volume) || 0 : 0;
      const diesel = sale ? Number(sale.diesel_volume) || 0 : 0;
      const count = sale ? (Number(sale.gasoline_count) || 0) + (Number(sale.diesel_count) || 0) : 0;
      const total = gas + diesel;
      const dow = dowFromStr(dateStr);
      weekDays.push({
        date: dateStr,
        dow,
        dowLabel: DOW_LABELS[dow],
        total,
        gasoline: gas,
        diesel,
        count,
      });
    }

    const total = weekDays.reduce((s, d) => s + d.total, 0);
    const activeDays = weekDays.filter(d => d.total > 0).length;
    weeks.push({
      weekLabel: `${monday.slice(5)} ~ ${sunday.slice(5)}`,
      mondayStr: monday,
      days: weekDays,
      total,
      avgPerDay: activeDays > 0 ? Math.round(total / activeDays) : 0,
    });
  }

  const thisWeek = weeks[0];
  const lastWeek = weeks[1];

  // 이번 주 실적 (오늘까지)
  const thisWeekActual = thisWeek.days.filter(d => d.date <= todayStr && d.total > 0);
  const thisWeekTotal = thisWeekActual.reduce((s, d) => s + d.total, 0);
  const lastWeekSame = lastWeek.days.filter(d => d.total > 0).slice(0, thisWeekActual.length);
  const lastWeekSameTotal = lastWeekSame.reduce((s, d) => s + d.total, 0);
  const weekDiffPct = lastWeekSameTotal > 0 ? +((thisWeekTotal - lastWeekSameTotal) / lastWeekSameTotal * 100).toFixed(1) : null;

  // ── 요일별 평균 vs 실제 (이번 주) ──
  const dowChartData = DOW_ORDER.map((jsDow, i) => {
    const label = ["월", "화", "수", "목", "금", "토", "일"][i];
    const avg = dowMean?.[jsDow] ?? 0;
    const dayData = thisWeek.days.find(d => d.dow === jsDow);
    const actual = dayData && dayData.date <= todayStr ? dayData.total : null;
    const isToday = dayData?.date === todayStr;
    return { label, avg: Math.round(avg), actual, isToday, date: dayData?.date ?? "" };
  });

  // ── 주차별 비교 차트 ──
  const weeklyChart = weeks.slice(0, 8).reverse().map(w => ({
    label: w.weekLabel,
    total: w.total,
    avg: w.avgPerDay,
    isCurrent: w.mondayStr === thisMon,
  }));

  // ── 요일별 전체 통계 (히트맵용) ──
  const dowStats = DOW_ORDER.map((jsDow, i) => {
    const label = ["월", "화", "수", "목", "금", "토", "일"][i];
    const allDays = dailySales
      .filter(s => dowFromStr(s.date) === jsDow)
      .map(s => (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0))
      .filter(v => v > 0);
    const avg = allDays.length > 0 ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : 0;
    const max = allDays.length > 0 ? Math.max(...allDays) : 0;
    const min = allDays.length > 0 ? Math.min(...allDays) : 0;
    return { label, jsDow, avg, max, min, n: allDays.length };
  });
  const overallAvg = dowStats.reduce((s, d) => s + d.avg, 0) / 7;

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto text-slate-900">
      <DetailHeader
        title="주간 판매 분석"
        description={`${thisWeek.weekLabel} · 이번 주 ${thisWeekActual.length}일 실적`}
      />

      <main className="w-full px-5 pb-10 max-w-6xl mx-auto">
        {/* ── 상단 요약 3카드 ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[12px] text-slate-600 mb-1">이번 주 누적</div>
            <div className="text-[28px] font-extrabold text-slate-900 tnum tracking-tight">
              {thisWeekTotal > 0 ? thisWeekTotal.toLocaleString() : "-"}
              <span className="text-[14px] font-normal text-slate-500 ml-1">L</span>
            </div>
            {weekDiffPct != null && (
              <div className={`text-[13px] font-bold mt-1 ${weekDiffPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                지난주 대비 {weekDiffPct >= 0 ? "+" : ""}{weekDiffPct}%
              </div>
            )}
            <div className="text-[11px] text-slate-500 mt-1">{thisWeekActual.length}일 기준 · 같은 기간 비교</div>
          </div>

          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[12px] text-slate-600 mb-1">지난주 전체</div>
            <div className="text-[28px] font-extrabold text-slate-900 tnum tracking-tight">
              {lastWeek.total > 0 ? lastWeek.total.toLocaleString() : "-"}
              <span className="text-[14px] font-normal text-slate-500 ml-1">L</span>
            </div>
            <div className="text-[13px] text-slate-600 mt-1">
              일평균 {lastWeek.avgPerDay.toLocaleString()}L
            </div>
          </div>

          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[12px] text-slate-600 mb-1">최고 판매 요일</div>
            {(() => {
              const best = [...dowStats].sort((a, b) => b.avg - a.avg)[0];
              const worst = [...dowStats].sort((a, b) => a.avg - b.avg)[0];
              return (
                <>
                  <div className="text-[28px] font-extrabold text-emerald-600 tnum tracking-tight">
                    {best.label}요일
                    <span className="text-[14px] font-normal text-slate-500 ml-2">{best.avg.toLocaleString()}L</span>
                  </div>
                  <div className="text-[13px] text-red-500 mt-1">
                    최저: {worst.label}요일 {worst.avg.toLocaleString()}L
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* ── 이번 주 요일별 실적 vs 평균 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-slate-900 mb-1">이번 주 요일별 실적</h2>
          <p className="text-[12px] text-slate-600 mb-4">회색 = 요일 평균, 컬러 = 실제 판매량</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dowChartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={35} />
              <Tooltip
                formatter={(value: unknown, name: unknown) => [
                  `${Number(value).toLocaleString()}L`,
                  name === "avg" ? "요일 평균" : "실제",
                ]}
                contentStyle={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="avg" fill="#E5E7EB" radius={[4, 4, 0, 0]} name="avg" />
              <Bar dataKey="actual" radius={[4, 4, 0, 0]} name="actual">
                {dowChartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={
                      d.actual == null ? "transparent"
                      : d.isToday ? "#3B82F6"
                      : d.actual >= d.avg ? "#10B981"
                      : "#EF4444"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200 inline-block" /> 요일 평균</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> 평균 이상</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> 평균 이하</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> 오늘</span>
          </div>
        </section>

        {/* ── 최근 8주 주간 추이 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-slate-900 mb-1">주간 판매 추이</h2>
          <p className="text-[12px] text-slate-600 mb-4">최근 8주간 주 합계 비교</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
              <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} width={35} />
              <Tooltip
                formatter={(value: unknown) => [`${Number(value).toLocaleString()}L`]}
                contentStyle={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {weeklyChart.map((d, i) => (
                  <Cell key={i} fill={d.isCurrent ? "#3B82F6" : "#CBD5E1"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        {/* ── 요일별 통계 테이블 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <h2 className="text-[16px] font-bold text-slate-900 mb-3">요일별 판매 통계</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-slate-600 font-semibold">요일</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">평균</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">최고</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">최저</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">평균 대비</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">표본</th>
                </tr>
              </thead>
              <tbody>
                {dowStats.map((d) => {
                  const diff = overallAvg > 0 ? +((d.avg - overallAvg) / overallAvg * 100).toFixed(1) : 0;
                  return (
                    <tr key={d.label} className="border-b border-border/50 hover:bg-surface transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{d.label}요일</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 tnum">{d.avg.toLocaleString()}L</td>
                      <td className="py-2.5 px-3 text-right text-emerald-600 tnum">{d.max.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right text-red-500 tnum">{d.min.toLocaleString()}</td>
                      <td className={`py-2.5 px-3 text-right font-bold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-500" : "text-slate-600"}`}>
                        {diff > 0 ? "+" : ""}{diff}%
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">{d.n}일</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 이번 주 일별 상세 ── */}
        <section className="bg-surface-raised rounded-xl p-5 border border-border">
          <h2 className="text-[16px] font-bold text-slate-900 mb-3">이번 주 일별 상세</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-slate-600 font-semibold">날짜</th>
                  <th className="text-left py-2 px-3 text-slate-600 font-semibold">요일</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">총 판매</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">휘발유</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">경유</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">건수</th>
                  <th className="text-right py-2 px-3 text-slate-600 font-semibold">요일평균 대비</th>
                </tr>
              </thead>
              <tbody>
                {thisWeek.days.map((d) => {
                  const avg = dowMean?.[d.dow] ?? 0;
                  const diff = avg > 0 && d.total > 0 ? +((d.total - avg) / avg * 100).toFixed(1) : null;
                  const isToday = d.date === todayStr;
                  const isFuture = d.date > todayStr;
                  return (
                    <tr key={d.date} className={`border-b border-border/50 ${isToday ? "bg-blue-50" : isFuture ? "opacity-40" : "hover:bg-surface"} transition-colors`}>
                      <td className="py-2.5 px-3 text-slate-900">{d.date.slice(5)}</td>
                      <td className={`py-2.5 px-3 ${isToday ? "font-bold text-blue-600" : "text-slate-700"}`}>
                        {d.dowLabel}{isToday ? " (오늘)" : ""}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 tnum">
                        {d.total > 0 ? d.total.toLocaleString() : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 tnum">
                        {d.gasoline > 0 ? d.gasoline.toLocaleString() : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 tnum">
                        {d.diesel > 0 ? d.diesel.toLocaleString() : "-"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 tnum">
                        {d.count > 0 ? d.count.toLocaleString() : "-"}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold ${
                        diff == null ? "text-slate-400"
                        : diff >= 0 ? "text-emerald-600" : "text-red-500"
                      }`}>
                        {diff != null ? `${diff > 0 ? "+" : ""}${diff}%` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
