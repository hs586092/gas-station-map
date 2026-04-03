"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

const STATION_ID = "A0003453";

const BRAND_LABELS: Record<string, string> = {
  SKE: "SK에너지", GSC: "GS칼텍스", HDO: "HD현대오일뱅크",
  SOL: "S-OIL", RTO: "자영알뜰", NHO: "농협알뜰", ETC: "기타",
};
const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a", GSC: "#00a651", HDO: "#0066b3",
  SOL: "#ffd200", RTO: "#ff8c00", NHO: "#006838", ETC: "#9BA8B7",
};

// ─── 타입 ───
interface CompetitorData {
  baseStation: {
    id: string; name: string; brand: string;
    gasoline_price: number | null; diesel_price: number | null;
  };
  competitors: Array<{
    id: string; name: string; brand: string;
    gasoline_price: number | null; diesel_price: number | null;
    distance_km: number; gasoline_diff: number | null; diesel_diff: number | null;
  }>;
  stats: {
    avg_gasoline: number | null; avg_diesel: number | null;
    my_gasoline_rank: number | null; my_diesel_rank: number | null;
    total_count: number;
  };
}

interface CompetitorChange {
  id: string; name: string; brand: string; distance_km: number;
  gasoline_price: number | null; diesel_price: number | null;
  gasoline_diff: number | null; diesel_diff: number | null;
  gap_vs_me: number | null; gap_vs_me_yesterday: number | null;
}

interface BenchmarkData {
  station: { price: number; district: string | null; fuel_type: string };
  benchmarks: {
    district: { label: string; avg: number; count: number; rank: number } | null;
    brand: { label: string; avg: number; count: number; rank: number } | null;
    overall: { label: string; avg: number; count: number; rank: number };
  };
}

interface StationDetail {
  name: string; brand: string; newAddress: string | null;
  oilReflection: {
    brentChange: number; priceChange: number | null;
    message: string; direction: "up" | "down" | "flat";
  } | null;
  evNearby: {
    fast: number; slow: number; stations: number; fastStations: number;
  } | null;
}

interface OilPriceData {
  prices: Array<{ date: string; wti: number | null; brent: number | null }>;
  summary: {
    wti: number | null; brent: number | null;
    wtiChange: number | null; brentChange: number | null;
  } | null;
}

interface PriceHistoryData {
  history: Array<{ date: string; gasoline: number | null; diesel: number | null }>;
}

interface Insights {
  rankChange: {
    gasoline: { today: { rank: number; total: number } | null; yesterday: { rank: number; total: number } | null; diff: number | null };
    diesel: { today: { rank: number; total: number } | null; yesterday: { rank: number; total: number } | null; diff: number | null };
    reason: string;
  };
  competitorPattern: {
    action: string; message: string;
    risingCount: number; fallingCount: number; stableCount: number;
    fastestResponder: { name: string; changeCount: number } | null;
  };
  oilWeekTrend: { trend: string; message: string; brentWeekChange: number };
  weeklyTrend: {
    action: string; message: string;
    risingCount: number; fallingCount: number; stableCount: number;
  };
  oilStory: string;
  benchmarkInsight: string;
  myPosition: "cheap" | "average" | "expensive";
  avgPrice: number | null;
  recommendation: { message: string; type: "hold" | "raise" | "lower" | "watch"; suggestedRange: { min: number; max: number } | null };
}

// ─── 스켈레톤 ───
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
      <Skeleton className="h-4 w-24 mb-4" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

// ─── 인사이트 배지 ───
function InsightBadge({ children, color = "slate" }: { children: React.ReactNode; color?: "slate" | "blue" | "red" | "emerald" | "amber" }) {
  const colors = {
    slate: "bg-slate-50 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className={`mt-3 rounded-lg px-3 py-2 text-[11px] leading-relaxed ${colors[color]}`}>
      {children}
    </div>
  );
}

// ─── 메인 ───
export default function DashboardPage() {
  const [competitors, setCompetitors] = useState<CompetitorData | null>(null);
  const [changes, setChanges] = useState<{ changes: CompetitorChange[]; noChangeCount: number } | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [oilPrices, setOilPrices] = useState<OilPriceData | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryData | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);

  const [loading, setLoading] = useState({
    competitors: true, changes: true, benchmark: true,
    detail: true, oilPrices: true, priceHistory: true, insights: true,
  });

  useEffect(() => {
    const base = `/api/stations/${STATION_ID}`;

    fetch(`${base}/competitors`)
      .then((r) => r.json())
      .then((d) => { setCompetitors(d); setLoading((p) => ({ ...p, competitors: false })); });

    fetch(`${base}/competitor-changes`)
      .then((r) => r.json())
      .then((d) => { setChanges(d); setLoading((p) => ({ ...p, changes: false })); });

    fetch(`${base}/benchmark?fuel=gasoline`)
      .then((r) => r.json())
      .then((d) => { setBenchmark(d); setLoading((p) => ({ ...p, benchmark: false })); });

    fetch(base)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading((p) => ({ ...p, detail: false })); });

    fetch("/api/oil-prices?days=30")
      .then((r) => r.json())
      .then((d) => { setOilPrices(d); setLoading((p) => ({ ...p, oilPrices: false })); });

    fetch(`/api/price-history/${STATION_ID}`)
      .then((r) => r.json())
      .then((d) => { setPriceHistory(d); setLoading((p) => ({ ...p, priceHistory: false })); });

    fetch(`${base}/dashboard-insights`)
      .then((r) => r.json())
      .then((d) => { setInsights(d); setLoading((p) => ({ ...p, insights: false })); });
  }, []);

  const recIcon = {
    hold: "✅", raise: "📈", lower: "📉", watch: "👀",
  };
  const recColor = {
    hold: "border-emerald bg-emerald-light",
    raise: "border-coral bg-coral-light",
    lower: "border-blue-500 bg-blue-50",
    watch: "border-amber-500 bg-amber-50",
  };

  // 2주 후 반영 시점 계산 (국제유가 차트용)
  const twoWeeksFromNowIdx = oilPrices?.prices
    ? Math.max(0, oilPrices.prices.length - 11)
    : 0;
  const twoWeeksDate = oilPrices?.prices?.[twoWeeksFromNowIdx]?.date?.slice(5) || "";

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      {/* 헤더 */}
      <header className="bg-navy text-white h-14 flex items-center px-5 sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C073" strokeWidth="2.5">
            <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
          </svg>
          <span className="font-bold text-sm hidden sm:inline">주유소맵</span>
        </Link>
        <div className="flex items-center gap-4 ml-6 text-[13px]">
          <Link href="/dashboard" className="text-white font-semibold no-underline">대시보드</Link>
          <Link href="/" className="text-white/60 no-underline hover:text-white/90">지도</Link>
          <Link href="/community" className="text-white/60 no-underline hover:text-white/90">커뮤니티</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 주유소 정보 헤더 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: BRAND_COLORS["SOL"] }} />
            <span className="text-[12px] font-medium text-text-secondary">{BRAND_LABELS["SOL"]}</span>
          </div>
          <h1 className="text-[22px] font-bold text-text-primary m-0">셀프광장주유소</h1>
          {!loading.detail && detail?.newAddress && (
            <p className="text-[13px] text-text-secondary m-0 mt-1">{detail.newAddress}</p>
          )}
        </div>

        {/* ⓪ 종합 추천 카드 — 최상단 */}
        {loading.insights ? (
          <div className="mb-5">
            <div className="rounded-2xl p-5 border-2 border-gray-200 bg-white">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton className="h-6 w-full mb-2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : insights && (
          <div className={`mb-5 rounded-2xl p-5 border-2 ${recColor[insights.recommendation.type]} shadow-sm`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[20px]">{recIcon[insights.recommendation.type]}</span>
              <span className="text-[13px] font-bold text-text-primary">오늘의 경영 브리핑</span>
            </div>
            <p className="text-[15px] font-semibold text-text-primary m-0 leading-relaxed">
              {insights.recommendation.message}
            </p>
            {insights.oilStory && (
              <p className="text-[12px] text-text-secondary m-0 mt-2 leading-relaxed">
                {insights.oilStory}
              </p>
            )}
            {insights.weeklyTrend.message && (
              <p className="text-[11px] text-text-tertiary m-0 mt-1.5">
                📊 {insights.weeklyTrend.message}
              </p>
            )}
            <p className="text-[10px] text-text-tertiary m-0 mt-3">
              * 본 분석은 데이터 기반 참고 정보이며, 최종 가격 결정은 사장님의 판단에 따릅니다.
            </p>
          </div>
        )}

        {/* 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* ① 가격 포지션 변화 */}
          {loading.competitors ? <CardSkeleton /> : competitors && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="text-[12px] font-semibold text-text-secondary mb-3">내 가격 · 포지션</div>
              <div className="space-y-3">
                {competitors.baseStation.gasoline_price && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[12px] text-text-secondary">휘발유</span>
                      <div className="text-[22px] font-extrabold text-text-primary">
                        {competitors.baseStation.gasoline_price.toLocaleString()}
                        <span className="text-[13px] font-normal text-text-secondary ml-0.5">원</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-1 bg-emerald-light text-emerald text-[13px] font-bold rounded-full">
                        {competitors.stats.total_count}개 중 {competitors.stats.my_gasoline_rank}위
                      </span>
                    </div>
                  </div>
                )}
                {competitors.baseStation.diesel_price && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[12px] text-text-secondary">경유</span>
                      <div className="text-[22px] font-extrabold text-text-primary">
                        {competitors.baseStation.diesel_price.toLocaleString()}
                        <span className="text-[13px] font-normal text-text-secondary ml-0.5">원</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-1 bg-emerald-light text-emerald text-[13px] font-bold rounded-full">
                        {competitors.stats.total_count}개 중 {competitors.stats.my_diesel_rank}위
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {/* 순위 변동 인사이트 */}
              {insights && insights.rankChange.gasoline.diff !== null && insights.rankChange.gasoline.diff !== 0 && (
                <InsightBadge color={insights.rankChange.gasoline.diff < 0 ? "emerald" : "red"}>
                  어제 {insights.rankChange.gasoline.yesterday?.rank}위 → 오늘 {insights.rankChange.gasoline.today?.rank}위
                  {insights.rankChange.gasoline.diff < 0 ? " 📈 상승" : " 📉 하락"}
                  {insights.rankChange.reason && <><br />{insights.rankChange.reason}</>}
                </InsightBadge>
              )}
              {insights && (insights.rankChange.gasoline.diff === null || insights.rankChange.gasoline.diff === 0) && (
                <div className="mt-3 pt-3 border-t border-border text-[11px] text-text-secondary">
                  반경 5km 평균: 휘발유 {competitors.stats.avg_gasoline?.toLocaleString()}원
                  {competitors.stats.avg_diesel && ` · 경유 ${competitors.stats.avg_diesel.toLocaleString()}원`}
                </div>
              )}
            </div>
          )}

          {/* ② 경쟁사 행동 패턴 */}
          {loading.changes ? <CardSkeleton /> : changes && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="text-[12px] font-semibold text-text-secondary mb-3">
                경쟁사 가격 변동
                <span className="text-[10px] font-normal text-text-tertiary ml-1">오늘</span>
              </div>
              {changes.changes.length === 0 ? (
                <div className="text-[13px] text-text-tertiary py-4 text-center">
                  오늘 경쟁사 가격 변동 없음
                </div>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {changes.changes.map((c) => (
                    <div key={c.id} className="rounded-lg bg-surface px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                          <span className="text-[12px] text-text-primary truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {c.gasoline_diff != null && c.gasoline_diff !== 0 && (
                            <span className={`text-[12px] font-bold ${c.gasoline_diff > 0 ? "text-coral" : "text-blue-600"}`}>
                              휘 {c.gasoline_diff > 0 ? "▲" : "▼"}{Math.abs(c.gasoline_diff)}
                            </span>
                          )}
                          {c.diesel_diff != null && c.diesel_diff !== 0 && (
                            <span className={`text-[12px] font-bold ${c.diesel_diff > 0 ? "text-coral" : "text-blue-600"}`}>
                              경 {c.diesel_diff > 0 ? "▲" : "▼"}{Math.abs(c.diesel_diff)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* 나와의 가격 차이 변화 */}
                      {c.gap_vs_me != null && (
                        <div className="text-[10px] text-text-secondary mt-1">
                          현재 나보다 {c.gap_vs_me > 0 ? `+${c.gap_vs_me}원 비쌈` : c.gap_vs_me < 0 ? `${c.gap_vs_me}원 저렴` : "동일"}
                          {c.gap_vs_me_yesterday != null && c.gap_vs_me !== c.gap_vs_me_yesterday && (
                            <span className="text-text-tertiary">
                              {" "}(어제 {c.gap_vs_me_yesterday > 0 ? `+${c.gap_vs_me_yesterday}` : c.gap_vs_me_yesterday}원)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* 경쟁사 패턴 인사이트 */}
              {insights && (
                <InsightBadge color={
                  insights.competitorPattern.action === "rising" ? "red"
                    : insights.competitorPattern.action === "falling" ? "blue"
                    : insights.competitorPattern.action === "mixed" ? "amber"
                    : "slate"
                }>
                  {insights.competitorPattern.message}
                  {insights.competitorPattern.fastestResponder && (
                    <><br />가격 변경 가장 잦은 곳: {insights.competitorPattern.fastestResponder.name} ({insights.competitorPattern.fastestResponder.changeCount}회/18일)</>
                  )}
                </InsightBadge>
              )}
            </div>
          )}

          {/* ③ 적정가 벤치마크 */}
          {loading.benchmark ? <CardSkeleton /> : benchmark && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="text-[12px] font-semibold text-text-secondary mb-3">적정가 벤치마크</div>
              <div className="space-y-3">
                {benchmark.benchmarks.district && (() => {
                  const diff = benchmark.station.price - benchmark.benchmarks.district.avg;
                  return (
                    <div>
                      <div className="text-[11px] text-text-secondary mb-1">{benchmark.benchmarks.district.label}</div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[18px] font-bold ${diff <= -30 ? "text-blue-600" : diff >= 30 ? "text-coral" : "text-emerald"}`}>
                          {diff > 0 ? "+" : ""}{diff}원
                        </span>
                        <span className="text-[12px] text-text-secondary">
                          {diff <= -30 ? "저렴한 편" : diff >= 30 ? "비싼 편" : "평균 수준"}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-tertiary mt-0.5">
                        {benchmark.benchmarks.district.count}개 중 {benchmark.benchmarks.district.rank}위
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const diff = benchmark.station.price - benchmark.benchmarks.overall.avg;
                  return (
                    <div className="pt-2 border-t border-border">
                      <div className="text-[11px] text-text-secondary mb-1">{benchmark.benchmarks.overall.label}</div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[18px] font-bold ${diff <= -30 ? "text-blue-600" : diff >= 30 ? "text-coral" : "text-emerald"}`}>
                          {diff > 0 ? "+" : ""}{diff}원
                        </span>
                        <span className="text-[12px] text-text-secondary">
                          {diff <= -30 ? "저렴한 편" : diff >= 30 ? "비싼 편" : "평균 수준"}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* 벤치마크 인사이트 */}
              {insights?.benchmarkInsight && (
                <InsightBadge color={insights.myPosition === "cheap" ? "blue" : insights.myPosition === "expensive" ? "red" : "emerald"}>
                  {insights.benchmarkInsight}
                </InsightBadge>
              )}
            </div>
          )}

          {/* ④ 유가→경쟁사→내 가격 스토리 (wide) */}
          {loading.detail ? (
            <div className="md:col-span-2"><CardSkeleton /></div>
          ) : detail?.oilReflection && (
            <div className="md:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="text-[12px] font-semibold text-text-secondary mb-3">유가 반영 분석</div>
              <div className={`rounded-xl px-4 py-3 ${
                detail.oilReflection.direction === "up" ? "bg-red-50"
                  : detail.oilReflection.direction === "down" ? "bg-blue-50"
                  : "bg-slate-50"
              }`}>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" stroke={
                    detail.oilReflection.direction === "up" ? "#ef4444"
                      : detail.oilReflection.direction === "down" ? "#3b82f6"
                      : "#64748b"
                  }>
                    <path d="M3 3v18h18" /><path d="m7 14 4-4 4 4 5-5" />
                  </svg>
                  <span className={`text-[14px] font-semibold ${
                    detail.oilReflection.direction === "up" ? "text-red-700"
                      : detail.oilReflection.direction === "down" ? "text-blue-700"
                      : "text-slate-700"
                  }`}>
                    {detail.oilReflection.message}
                  </span>
                </div>
                {detail.oilReflection.priceChange !== null && (
                  <div className="text-[12px] text-text-secondary mt-1.5 ml-[24px]">
                    소매가 2주간 {detail.oilReflection.priceChange >= 0 ? "+" : ""}{detail.oilReflection.priceChange}원
                  </div>
                )}
              </div>
              {/* 유가→경쟁사→내 가격 연결 스토리 */}
              {insights?.oilStory && (
                <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-medium text-text-secondary mb-1">흐름 분석</div>
                  <div className="text-[12px] text-text-primary leading-relaxed">{insights.oilStory}</div>
                </div>
              )}
            </div>
          )}

          {/* ⑤ 국제유가 + 향후 전망 */}
          {loading.oilPrices ? <CardSkeleton /> : oilPrices && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="text-[12px] font-semibold text-text-secondary mb-1">국제유가 · 전망</div>
              {oilPrices.summary && (
                <div className="flex gap-3 mb-3 text-[11px]">
                  <span className="text-text-primary font-medium">
                    WTI <span className="font-bold">${oilPrices.summary.wti}</span>
                    {oilPrices.summary.wtiChange != null && (
                      <span className={oilPrices.summary.wtiChange >= 0 ? "text-coral ml-1" : "text-blue-600 ml-1"}>
                        {oilPrices.summary.wtiChange >= 0 ? "▲" : "▼"}${Math.abs(oilPrices.summary.wtiChange).toFixed(1)}
                      </span>
                    )}
                  </span>
                  <span className="text-text-primary font-medium">
                    Brent <span className="font-bold">${oilPrices.summary.brent}</span>
                    {oilPrices.summary.brentChange != null && (
                      <span className={oilPrices.summary.brentChange >= 0 ? "text-coral ml-1" : "text-blue-600 ml-1"}>
                        {oilPrices.summary.brentChange >= 0 ? "▲" : "▼"}${Math.abs(oilPrices.summary.brentChange).toFixed(1)}
                      </span>
                    )}
                  </span>
                </div>
              )}
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={oilPrices.prices.map((p) => ({ ...p, date: p.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis domain={["dataMin - 3", "dataMax + 3"]} tick={{ fontSize: 9 }} tickFormatter={(v) => `$${v}`} width={40} />
                  <Tooltip formatter={(value, name) => [`$${value}`, name]} />
                  {twoWeeksDate && (
                    <ReferenceLine x={twoWeeksDate} stroke="#fca5a5" strokeDasharray="4 4" label={{ value: "2주 전", position: "top", fontSize: 9 }} />
                  )}
                  <Line type="monotone" dataKey="wti" stroke="#f97316" strokeWidth={1.5} dot={false} name="WTI" connectNulls />
                  <Line type="monotone" dataKey="brent" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Brent" connectNulls />
                </LineChart>
              </ResponsiveContainer>
              {/* 향후 전망 인사이트 */}
              {insights?.oilWeekTrend.message && (
                <InsightBadge color={
                  insights.oilWeekTrend.trend === "rising" ? "red"
                    : insights.oilWeekTrend.trend === "falling" ? "blue"
                    : "slate"
                }>
                  {insights.oilWeekTrend.message}
                </InsightBadge>
              )}
            </div>
          )}

          {/* ⑥ EV 충전소 요약 */}
          {loading.detail ? <CardSkeleton /> : detail?.evNearby && detail.evNearby.stations > 0 && (() => {
            const fs = detail.evNearby.fastStations;
            const threat = fs <= 5
              ? { label: "EV 전환 영향 적음", color: "text-emerald-600", bg: "bg-emerald-50" }
              : fs <= 20
                ? { label: "EV 인프라 확대 중", color: "text-amber-600", bg: "bg-amber-50" }
                : { label: "EV 충전 밀집 지역", color: "text-red-600", bg: "bg-red-50" };
            return (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
                <div className="text-[12px] font-semibold text-text-secondary mb-3">EV 충전소 현황</div>
                <div className={`rounded-xl px-4 py-3 ${threat.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={threat.color}>
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    <span className={`text-[13px] font-bold ${threat.color}`}>{threat.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[20px] font-extrabold text-text-primary">{fs}</span>
                    <span className="text-[12px] font-semibold text-text-secondary">급속 충전소</span>
                    <span className="text-[11px] text-text-secondary">(충전기 {detail.evNearby.fast}대)</span>
                  </div>
                  <div className="text-[11px] text-text-secondary mt-1">
                    완속 {detail.evNearby.stations - fs}개소 · 반경 3km
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ⑦ 내 가격 추이 (wide) */}
          {loading.priceHistory ? (
            <div className="md:col-span-2 lg:col-span-3"><CardSkeleton /></div>
          ) : priceHistory && priceHistory.history.length > 0 && (
            <div className="md:col-span-2 lg:col-span-3 bg-white rounded-2xl p-5 shadow-sm border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[12px] font-semibold text-text-secondary">내 가격 추이 (30일)</div>
                <div className="flex gap-3 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 rounded bg-coral inline-block" /> 휘발유
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 rounded bg-navy inline-block" /> 경유
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={priceHistory.history.map((h) => ({ ...h, date: h.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis domain={["dataMin - 20", "dataMax + 20"]} tick={{ fontSize: 10 }} tickFormatter={(v) => v.toLocaleString()} width={45} />
                  <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}원`, name]} />
                  <Line type="monotone" dataKey="gasoline" stroke="#FF5252" strokeWidth={2} dot={false} name="휘발유" connectNulls />
                  <Line type="monotone" dataKey="diesel" stroke="#1B2838" strokeWidth={2} dot={false} name="경유" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
