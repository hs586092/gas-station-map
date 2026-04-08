"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/app/components/SiteHeader";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
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

interface WeatherData {
  location: string;
  current: { temperature: number | null; weatherCode: number | null; precipitation: number | null };
  today: { date: string; weatherCode: number | null; tempMax: number | null; tempMin: number | null; precipProbMax: number | null; precipSum: number | null } | null;
  tomorrow: { date: string; weatherCode: number | null; tempMax: number | null; tempMin: number | null; precipProbMax: number | null; precipSum: number | null } | null;
}

// WMO weather code → 한글 라벨 + 이모지
function weatherCodeLabel(code: number | null): { label: string; icon: string } {
  if (code == null) return { label: "-", icon: "❓" };
  if (code === 0) return { label: "맑음", icon: "☀️" };
  if (code <= 2) return { label: "대체로 맑음", icon: "🌤️" };
  if (code === 3) return { label: "흐림", icon: "☁️" };
  if (code <= 48) return { label: "안개", icon: "🌫️" };
  if (code <= 57) return { label: "이슬비", icon: "🌦️" };
  if (code <= 65) return { label: "비", icon: "🌧️" };
  if (code <= 67) return { label: "진눈깨비", icon: "🌨️" };
  if (code <= 77) return { label: "눈", icon: "❄️" };
  if (code <= 82) return { label: "소나기", icon: "🌦️" };
  if (code <= 86) return { label: "눈 소나기", icon: "🌨️" };
  if (code <= 99) return { label: "뇌우", icon: "⛈️" };
  return { label: "-", icon: "❓" };
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
  competitorProfiles: Array<{
    id: string; name: string; brand: string; distance_km: number;
    type: "leader" | "follower" | "steady" | "unknown";
    typeLabel: string; changeCount: number; avgChangeSize: number;
    currentPrice: number | null;
  }>;
  correlationInsights: Array<{
    id: string; name: string; brand: string;
    correlation: number; label: string; insight: string;
  }>;
  recommendation: { message: string; type: "hold" | "raise" | "lower" | "watch"; suggestedRange: { min: number; max: number } | null };
  oilToRetailRatio: { avgWonPerDollar: number; minWon: number; maxWon: number; sampleCount: number } | null;
}

// ─── KST(Asia/Seoul) 기준 YYYY-MM-DD ───
// new Date().toISOString()은 UTC 기준이라 한국 새벽~오전에 "어제"로 표시되는 문제가 있어
// sv-SE 로케일(ISO 포맷)로 KST 타임존을 명시해 항상 한국 날짜를 얻는다.
function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

// ─── 데이터 신선도 배지 ───
function DataFreshness({ date, label }: { date: string | null; label?: string }) {
  if (!date) return null;
  // 모든 비교를 KST 기준 YYYY-MM-DD 문자열로 수행 (타임존 오차 원천 차단)
  const todayStr = todayKST();
  const [y, m, d] = date.split("-").map(Number);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  // 날짜 문자열을 UTC 자정으로 파싱해 일 단위 차이만 계산 (타임존 무관)
  const dataMs = Date.UTC(y, (m || 1) - 1, d || 1);
  const todayMs = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.max(0, Math.floor((todayMs - dataMs) / 86400000));
  const displayDate = `${m}/${d}`;
  const isStale = diffDays >= 3;

  return (
    <span className={`text-[12px] ${isStale ? "text-amber-600" : "text-text-tertiary"}`}>
      {isStale && "⚠️ "}
      {label || "최종"} {displayDate}
      {isStale && ` (${diffDays}일 전)`}
    </span>
  );
}

// ─── 스켈레톤 ───
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-100 rounded-lg ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="bg-surface-raised rounded-xl p-5 border border-border">
      <Skeleton className="h-4 w-24 mb-4" />
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

// ─── 인사이트 배지 (다크 테마) ───
function InsightBadge({ children, color = "slate" }: { children: React.ReactNode; color?: "slate" | "blue" | "red" | "emerald" | "amber" }) {
  const colors = {
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    red: "bg-red-50 text-red-700 border-red-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
  };
  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-[13px] leading-relaxed ${colors[color]}`}>
      {children}
    </div>
  );
}

// ─── 클릭 가능 카드 래퍼 ───
function ClickableCard({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <div
      onClick={() => router.push(href)}
      className={`cursor-pointer transition-all hover:border-border-strong hover:shadow-md ${className}`}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && router.push(href)}
    >
      {children}
      <div className="flex items-center justify-end mt-3 pt-2 border-t border-border/60 text-[11px] font-semibold text-text-tertiary gap-0.5 tracking-wider uppercase">
        <span>상세</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    </div>
  );
}

// ─── 순위 게이지 바 ───
function RankGauge({ rank, total, label }: { rank: number; total: number; label: string }) {
  const pct = total > 1 ? ((rank - 1) / (total - 1)) * 100 : 50;
  const color = pct <= 33 ? "#10b981" : pct <= 66 ? "#f59e0b" : "#ef4444";
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[11px] text-text-tertiary mb-0.5">
        <span>1위 (저렴)</span>
        <span>{total}위 (비쌈)</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-red-200">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow-md"
          style={{ left: `calc(${pct}% - 7px)`, background: color }}
        />
      </div>
      <div className="text-center mt-1">
        <span className="text-[12px] font-bold" style={{ color }}>{label} {rank}위</span>
        <span className="text-[11px] text-text-tertiary">/{total}</span>
      </div>
    </div>
  );
}

// ─── 가격 범위 바 (벤치마크용) ───
function PriceRangeBar({ myPrice, avg, label, rank, count }: { myPrice: number; avg: number; label: string; rank: number; count: number }) {
  const diff = myPrice - avg;
  // 범위: avg ± 100원으로 설정
  const rangeMin = avg - 100;
  const rangeMax = avg + 100;
  const myPct = Math.max(0, Math.min(100, ((myPrice - rangeMin) / (rangeMax - rangeMin)) * 100));
  const avgPct = 50; // avg는 항상 중앙
  const diffColor = diff <= -30 ? "#3b82f6" : diff >= 30 ? "#ef4444" : "#10b981";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-text-secondary">{label}</span>
        <span className="text-[12px] text-text-tertiary">{count}개 중 {rank}위</span>
      </div>
      <div className="relative h-3 rounded-full bg-slate-100">
        {/* 평균선 */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${avgPct}%` }} />
        <div className="absolute -top-4 text-[9px] text-text-tertiary whitespace-nowrap" style={{ left: `${avgPct}%`, transform: "translateX(-50%)" }}>
          평균
        </div>
        {/* 내 위치 마커 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md z-20"
          style={{ left: `calc(${myPct}% - 8px)`, background: diffColor }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-text-tertiary">저렴</span>
        <span className="text-[14px] font-bold" style={{ color: diffColor }}>
          {diff > 0 ? "+" : ""}{diff}원
        </span>
        <span className="text-[10px] text-text-tertiary">비쌈</span>
      </div>
    </div>
  );
}

// ─── 3단계 프로그레스 (유가 반영) ───
function OilReflectionProgress({ direction, brentChange, priceChange, competitorAction }: {
  direction: "up" | "down" | "flat";
  brentChange: number;
  priceChange: number | null;
  competitorAction: string;
}) {
  const isUp = direction === "up";
  const isDown = direction === "down";
  const step1Done = true; // 유가 변동은 항상 있음
  const step2Done = competitorAction !== "stable"; // 경쟁사가 반응했는지
  const step3Done = priceChange !== null && priceChange !== 0; // 내 가격이 변했는지

  const steps = [
    { label: "국제유가", sub: `${brentChange >= 0 ? "+" : ""}$${brentChange.toFixed(1)}`, done: step1Done },
    { label: "경쟁사 반영", sub: step2Done ? (competitorAction === "rising" ? "인상 중" : "인하 중") : "대기", done: step2Done },
    { label: "내 반영", sub: step3Done ? `${priceChange! >= 0 ? "+" : ""}${priceChange}원` : "미반영", done: step3Done },
  ];

  const activeColor = isUp ? "#ef4444" : isDown ? "#3b82f6" : "#64748b";

  return (
    <div className="flex items-start justify-between gap-1">
      {steps.map((s, i) => (
        <div key={i} className="flex-1 flex flex-col items-center text-center">
          <div className="flex items-center w-full">
            {i > 0 && <div className="flex-1 h-0.5" style={{ background: steps[i - 1].done ? activeColor : "#e5e7eb" }} />}
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[12px] font-bold"
              style={{ background: s.done ? activeColor : "#d1d5db" }}
            >
              {s.done ? "✓" : i + 1}
            </div>
            {i < steps.length - 1 && <div className="flex-1 h-0.5" style={{ background: s.done ? activeColor : "#e5e7eb" }} />}
          </div>
          <div className="text-[11px] font-semibold text-text-primary mt-1">{s.label}</div>
          <div className="text-[10px] text-text-tertiary">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 메인 ───
export default function DashboardPage() {
  const router = useRouter();
  const [competitors, setCompetitors] = useState<CompetitorData | null>(null);
  const [changes, setChanges] = useState<{ changes: CompetitorChange[]; noChangeCount: number } | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [oilPrices, setOilPrices] = useState<OilPriceData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherImpact, setWeatherImpact] = useState<{
    byIntensity: Array<{ key: string; label: string; n: number; adjustedDiffPct: number }>;
    tTest: { significant: boolean; label: string } | null;
    todayForecast: {
      intensity: "dry" | "light" | "heavy";
      intensityLabel: string;
      expectedVolume: number;
      diffVsDryPct: number;
      confidence: "high" | "medium" | "low";
      explanation: string;
    } | null;
  } | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryData | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);

  const [salesAnalysis, setSalesAnalysis] = useState<{
    summary: { avg30d: { gasoline: number; diesel: number }; totalEvents: number; elasticity: number | null; elasticityLabel: string };
    events: Array<{ date: string; priceChange: number; volumeChangeRate: number; recoveryRate: number | null; elasticity: number | null; isWeekend: boolean }>;
    splitElasticity: {
      weekday: { avg: number | null; count: number; avgVolumeChangeRate: number | null };
      weekend: { avg: number | null; count: number; avgVolumeChangeRate: number | null };
    };
  } | null>(null);

  const [aiBriefing, setAiBriefing] = useState<{
    aiBriefing: string | null;
    fallback: boolean;
    recommendationType: string;
  } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const [timingAnalysis, setTimingAnalysis] = useState<{
    currentSituation: { pendingReaction: boolean; message: string; urgency: "high" | "medium" | "low" | "none" };
    competitorSpeed: Array<{ name: string; avgDaysToReact: number | null; rank: number }>;
    dataStatus: { totalEvents: number; isReliable: boolean };
    timingImpact: {
      earlyResponse: { avgSalesChange: number; count: number };
      lateResponse: { avgSalesChange: number; count: number };
      optimalDays: number | null;
    } | null;
  } | null>(null);

  const [forecastReview, setForecastReview] = useState<{
    status: string;
    yesterday: {
      date: string; predicted: number; actual: number | null;
      error: number | null; errorPct: number | null;
      predictedCount: number | null; actualCount: number | null; countErrorPct: number | null;
      causes: Array<{ type: string; icon: string; message: string; impactL: number; impactPct: number; primary?: boolean }>;
      errorBreakdown: string | null;
    } | null;
    accuracy: {
      days7: { avgErrorPct: number; accuracy: number; count: number } | null;
      days30: { avgErrorPct: number; accuracy: number; count: number } | null;
      trend: "improving" | "declining" | "stable" | null;
    } | null;
  } | null>(null);

  const [correlationMatrix, setCorrelationMatrix] = useState<{
    dataRange: { totalDays: number };
    variables: Array<{
      id: string; label: string; group: string; color: string;
      metric: string; r: number | null; etaSq: number | null;
      p: number | null; n: number; significant: boolean; lowSample: boolean;
    }>;
    ranking: Array<{
      id: string; label: string; absEffect: number; r: number;
      metric: string; n: number; significant: boolean;
    }>;
  } | null>(null);

  const [loading, setLoading] = useState({
    competitors: true, changes: true, benchmark: true,
    detail: true, oilPrices: true, priceHistory: true, insights: true,
    salesAnalysis: true, timingAnalysis: true, forecastReview: true,
    correlationMatrix: true,
  });

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fetchAllData = (bustCache = false) => {
    const base = `/api/stations/${STATION_ID}`;
    const cb = bustCache ? `?t=${Date.now()}` : "";

    setLoading({
      competitors: true, changes: true, benchmark: true,
      detail: true, oilPrices: true, priceHistory: true, insights: true,
      salesAnalysis: true, timingAnalysis: true, forecastReview: true,
      correlationMatrix: true,
    });

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

    fetch("/api/weather")
      .then((r) => r.json())
      .then((d) => { if (!d.error) setWeather(d); })
      .catch(() => {});

    fetch(`${base}/weather-sales-analysis`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setWeatherImpact(d); })
      .catch(() => {});

    fetch(`/api/price-history/${STATION_ID}`)
      .then((r) => r.json())
      .then((d) => { setPriceHistory(d); setLoading((p) => ({ ...p, priceHistory: false })); });

    fetch(`${base}/dashboard-insights`)
      .then((r) => r.json())
      .then((d) => { setInsights(d); setLoading((p) => ({ ...p, insights: false })); });

    fetch(`${base}/sales-analysis${cb}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setSalesAnalysis(d);
        setLoading((p) => ({ ...p, salesAnalysis: false }));
      })
      .catch(() => setLoading((p) => ({ ...p, salesAnalysis: false })));

    fetch(`${base}/forecast-review${cb}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setForecastReview(d);
        setLoading((p) => ({ ...p, forecastReview: false }));
      })
      .catch(() => setLoading((p) => ({ ...p, forecastReview: false })));

    fetch(`${base}/timing-analysis`)
      .then((r) => r.json())
      .then((d) => {
        if (d.currentSituation) setTimingAnalysis(d);
        setLoading((p) => ({ ...p, timingAnalysis: false }));
      })
      .catch(() => setLoading((p) => ({ ...p, timingAnalysis: false })));

    fetch(`${base}/correlation-matrix`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setCorrelationMatrix(d);
        setLoading((p) => ({ ...p, correlationMatrix: false }));
      })
      .catch(() => setLoading((p) => ({ ...p, correlationMatrix: false })));
  };

  const handleSyncAndRefresh = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync-sales", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSyncResult({ ok: true, message: "판매 데이터 동기화 완료" });
        fetchAllData(true);
      } else {
        setSyncResult({ ok: false, message: data.error || "동기화 실패" });
      }
    } catch {
      setSyncResult({ ok: false, message: "서버 연결 실패" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  };

  useEffect(() => { fetchAllData(); }, []);

  const recIcon = {
    hold: "✅", raise: "📈", lower: "📉", watch: "👀",
  };
  const recColor = {
    hold: "border-border bg-surface-raised",
    raise: "border-border bg-surface-raised",
    lower: "border-border bg-surface-raised",
    watch: "border-border bg-surface-raised",
  };

  // 2주 후 반영 시점 계산 (국제유가 차트용)
  const twoWeeksFromNowIdx = oilPrices?.prices
    ? Math.max(0, oilPrices.prices.length - 11)
    : 0;
  const twoWeeksDate = oilPrices?.prices?.[twoWeeksFromNowIdx]?.date?.slice(5) || "";

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <SiteHeader />

      <main className="w-full max-w-[1280px] mx-auto px-6 py-7">
        {/* 주유소 정보 헤더 (다크 배경) */}
        <div className="mb-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-oil-yellow/40 text-[11px] font-bold text-oil-yellow tracking-wider uppercase" style={{ background: "rgba(255, 210, 0, 0.1)" }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BRAND_COLORS["SOL"] }} />
              {BRAND_LABELS["SOL"]}
            </span>
            <span className="text-[11px] font-semibold text-white/50 tracking-wider uppercase">ID · {STATION_ID}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-extrabold text-white tnum tracking-tight m-0">셀프광장주유소</h1>
            <button
              onClick={handleSyncAndRefresh}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-bold border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-surface-raised text-text-secondary border-border hover:bg-surface-overlay hover:text-text-primary"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={syncing ? "animate-spin" : ""}>
                <path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              {syncing ? "동기화 중..." : "데이터 새로고침"}
            </button>
            {syncResult && (
              <span className={`text-[12px] font-medium ${syncResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {syncResult.message}
              </span>
            )}
          </div>
          {!loading.detail && detail?.newAddress && (
            <p className="text-[13px] text-white/60 m-0 mt-1.5 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {detail.newAddress}
            </p>
          )}
        </div>

        {/* ⓪ 종합 추천 카드 — 최상단 */}
        {loading.insights ? (
          <div className="mb-5">
            <div className="rounded-xl p-5 border border-border bg-surface-raised">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton className="h-6 w-full mb-2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : insights && (
          <div className={`mb-6 rounded-xl p-6 pl-7 border ${recColor[insights.recommendation.type]} shadow-sm relative overflow-hidden text-text-primary`}>
            {/* 왼쪽 상태 색상 바 */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${
              insights.recommendation.type === "hold" ? "bg-emerald-500"
              : insights.recommendation.type === "raise" ? "bg-red-500"
              : insights.recommendation.type === "lower" ? "bg-blue-500"
              : "bg-amber-500"
            }`} />
            {/* 우상단 S-OIL 옐로우 액센트 글로우 */}
            <div className="absolute -top-12 -right-12 w-40 h-40 bg-oil-yellow/8 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-center gap-2 mb-3 relative">
              <span className="text-[20px]">{recIcon[insights.recommendation.type]}</span>
              <span className="text-[11px] font-bold text-text-tertiary tracking-[0.15em] uppercase">오늘의 경영 브리핑</span>
              {aiBriefing?.aiBriefing && !aiBriefing.fallback && (
                <span className="text-[10px] font-bold bg-oil-yellow-soft text-oil-yellow border border-oil-yellow/40 px-2 py-0.5 rounded tracking-wider uppercase">AI 분석</span>
              )}
            </div>

            {/* 핵심 팩터 태그 + 통합 판단 (항상 표시) */}
            {(() => {
              // ── 팩터 태그 수집 ──
              const tags: Array<{ label: string; color: string }> = [];
              // 경쟁사
              const rising = insights.competitorPattern.risingCount;
              const falling = insights.competitorPattern.fallingCount;
              if (rising > 0) tags.push({ label: `경쟁사 ${rising}곳↑`, color: "bg-red-100 text-red-700" });
              if (falling > 0) tags.push({ label: `경쟁사 ${falling}곳↓`, color: "bg-blue-100 text-blue-700" });
              if (rising === 0 && falling === 0) tags.push({ label: "경쟁사 변동 없음", color: "bg-slate-100 text-slate-600" });
              // 유가
              const bc = oilPrices?.summary?.brentChange;
              if (bc != null && Math.abs(bc) >= 0.5) {
                tags.push({ label: `유가 ${bc > 0 ? "+" : ""}$${bc.toFixed(1)}`, color: bc > 0 ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700" });
              }
              // 날씨
              if (weather?.today) {
                const todayRainy = (weather.today.precipProbMax ?? 0) >= 60 || (weather.today.precipSum ?? 0) >= 1;
                if (todayRainy) tags.push({ label: "비 예보", color: "bg-blue-100 text-blue-700" });
                else tags.push({ label: weatherCodeLabel(weather.today.weatherCode).label, color: "bg-emerald-100 text-emerald-700" });
              }
              // 요일
              const dowNames = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
              const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
              tags.push({ label: dowNames[nowKST.getDay()], color: [0, 6].includes(nowKST.getDay()) ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600" });
              // 판매 영향
              if (weatherImpact?.todayForecast && Math.abs(weatherImpact.todayForecast.diffVsDryPct) >= 2) {
                const d = weatherImpact.todayForecast.diffVsDryPct;
                tags.push({ label: `수요 ${d > 0 ? "+" : ""}${d}%`, color: d < 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700" });
              }
              // 타이밍 긴급도
              if (timingAnalysis?.currentSituation.urgency === "high") {
                tags.push({ label: "반응 긴급", color: "bg-red-100 text-red-700" });
              }

              // ── 통합 판단 1줄 생성 ──
              const parts: string[] = [];
              if (rising > 0) parts.push(`경쟁사 ${rising}곳 인상 중`);
              else if (falling > 0) parts.push(`경쟁사 ${falling}곳 인하 중`);
              if (bc != null && Math.abs(bc) >= 1) parts.push(`유가 ${bc > 0 ? "상승" : "하락"}세`);
              const todayRainy2 = weather?.today && ((weather.today.precipProbMax ?? 0) >= 60 || (weather.today.precipSum ?? 0) >= 1);
              if (todayRainy2) parts.push("비 예보로 수요 감소 예상");
              if (timingAnalysis?.currentSituation.urgency === "high") parts.push("유가 반영 시급");

              const recType = insights.recommendation.type;
              const actionMap = { hold: "현 가격 유지", raise: "인상 검토", lower: "인하 검토", watch: "관망 후 결정" };
              const judgment = parts.length > 0
                ? `${parts.join(" · ")} → ${actionMap[recType]}`
                : actionMap[recType];

              // 예상 판매량
              const expectedVol = weatherImpact?.todayForecast?.expectedVolume;

              return (
                <>
                  {/* 팩터 태그 */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {tags.map((t, i) => (
                      <span key={i} className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${t.color}`}>{t.label}</span>
                    ))}
                  </div>
                  {/* 통합 판단 */}
                  <p className="text-[15px] font-semibold text-text-primary m-0 leading-relaxed">
                    {judgment}
                  </p>
                  {expectedVol && (
                    <p className="text-[12px] text-text-secondary m-0 mt-1">
                      오늘 예상 판매량: {expectedVol.toLocaleString()}L
                      {insights.recommendation.suggestedRange && (
                        <span className="ml-2">· 추천 가격대: {insights.recommendation.suggestedRange.min.toLocaleString()}~{insights.recommendation.suggestedRange.max.toLocaleString()}원</span>
                      )}
                    </p>
                  )}
                </>
              );
            })()}

            {/* AI 브리핑 결과 (있으면 통합 판단 아래에) */}
            {aiBriefing?.aiBriefing && !aiBriefing.fallback ? (
              <div className="mt-3 rounded-lg bg-violet-50 border border-violet-100 px-4 py-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded">AI</span>
                  <span className="text-[11px] font-bold text-violet-700">심층 분석</span>
                </div>
                <div className="text-[13px] text-violet-900 leading-relaxed whitespace-pre-line">
                  {(() => {
                    const lines = aiBriefing.aiBriefing?.split("\n") ?? [];
                    const newsLines: string[] = [];
                    const bodyLines: string[] = [];
                    for (const line of lines) {
                      if (line.startsWith("[뉴스]") || line.startsWith("[영향]")) {
                        newsLines.push(line);
                      } else {
                        bodyLines.push(line);
                      }
                    }
                    return (
                      <>
                        {bodyLines.map((line, i) => <span key={i}>{line}{"\n"}</span>)}
                        {newsLines.length > 0 && (
                          <span className="block mt-1.5 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[12px] font-medium leading-relaxed">
                            📰{" "}
                            {newsLines.map((l, i) => (
                              <span key={i}>
                                {i > 0 && <br />}
                                {l.replace(/^\[(뉴스|영향)\]\s*/, "")}
                              </span>
                            ))}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : aiLoading ? (
              <div className="flex items-center gap-2 mt-3">
                <div className="w-3.5 h-3.5 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                <p className="text-[14px] text-violet-600 m-0 italic">AI가 분석 중입니다...</p>
              </div>
            ) : (
              /* oilStory (AI 없을 때 보조 설명) */
              insights.oilStory ? (
                <p className="text-[12px] text-text-tertiary m-0 mt-2 leading-relaxed">
                  {insights.oilStory}
                </p>
              ) : null
            )}

            <div className="flex items-center justify-between mt-3">
              {/* AI 분석 버튼 또는 근거 보기 */}
              <div className="flex items-center gap-2">
                {!aiBriefing?.aiBriefing && !aiLoading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAiLoading(true);
                      fetch(`/api/stations/${STATION_ID}/ai-briefing`)
                        .then((r) => r.json())
                        .then((d) => { setAiBriefing(d); setAiLoading(false); })
                        .catch(() => setAiLoading(false));
                    }}
                    className="text-[13px] font-bold text-black bg-oil-yellow hover:brightness-110 border border-oil-yellow-border px-3 py-1.5 rounded-md transition-colors cursor-pointer"
                  >
                    AI 분석 요청
                  </button>
                )}
                <p className="text-[12px] text-text-tertiary m-0">
                  * 참고 정보이며, 최종 판단은 사장님께 있습니다.
                </p>
              </div>
              <span
                onClick={() => router.push("/dashboard/briefing")}
                className="text-[14px] font-semibold text-text-secondary flex items-center gap-0.5 shrink-0 cursor-pointer hover:text-text-primary transition-colors"
              >
                근거 보기
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </span>
            </div>
          </div>
        )}

        {/* 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-text-primary">

          {/* 🌧️ 날씨 영향 (판매량 예측) */}
          {weatherImpact?.todayForecast && (() => {
            const f = weatherImpact.todayForecast!;
            const rainy = weatherImpact.byIntensity.find((b) => b.key === "heavy");
            const confColor = f.confidence === "high" ? "emerald" : f.confidence === "medium" ? "amber" : "slate";
            return (
              <ClickableCard href="/dashboard/weather-impact" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">날씨 영향 · 판매량</div>
                  <span className="text-[12px] text-text-tertiary">오늘 예측</span>
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[28px] font-extrabold text-text-primary tnum tracking-tight leading-none">
                    {f.expectedVolume.toLocaleString()}
                  </span>
                  <span className="text-[14px] text-text-secondary">L 예상</span>
                  {(f as Record<string, unknown>).expectedCount != null && (
                    <>
                      <span className="text-[28px] font-extrabold text-text-primary tnum tracking-tight leading-none ml-3">{((f as Record<string, unknown>).expectedCount as number).toLocaleString()}</span>
                      <span className="text-[14px] text-text-secondary">대</span>
                    </>
                  )}
                </div>
                <div className="text-[12px] text-text-tertiary mb-3">{f.explanation}</div>
                {rainy && weatherImpact.tTest && (
                  <div className="border-t border-border pt-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-secondary">본격 비 영향</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-bold text-red-500">판매 {rainy.adjustedDiffPct >= 0 ? "+" : ""}{rainy.adjustedDiffPct}%</span>
                        {(rainy as Record<string, unknown>).adjustedCountDiffPct != null && (
                          <span className="text-[14px] font-bold text-red-400">대수 {((rainy as Record<string, unknown>).adjustedCountDiffPct as number) >= 0 ? "+" : ""}{(rainy as Record<string, unknown>).adjustedCountDiffPct as number}%</span>
                        )}
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${weatherImpact.tTest.significant ? "bg-emerald/20 text-emerald" : "bg-slate-100 text-text-tertiary"}`}>{weatherImpact.tTest.label}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-text-tertiary">요일 효과 보정 · 과거 {rainy.n}일 기준</div>
                  </div>
                )}
                <InsightBadge color={confColor as "emerald" | "amber" | "slate"}>
                  {f.diffVsDryPct <= -5 ? "수요 감소 예상 → 가격 변동 보류 권장. 인하 시 회복 어려움"
                    : f.diffVsDryPct >= 5 ? "수요 증가 예상 → 소폭 인상 기회. 경쟁사 대비 가격 여력 확인"
                    : f.diffVsDryPct <= -2 ? "소폭 수요 감소 예상 → 가격 유지하며 관망 권장"
                    : "날씨 영향 미미 → 시장 상황 중심으로 판단"}
                  <span className="text-text-tertiary ml-1">(신뢰도 {f.confidence === "high" ? "높음" : f.confidence === "medium" ? "중간" : "낮음"})</span>
                </InsightBadge>
              </ClickableCard>
            );
          })()}

          {/* 📊 예측 복기 · 어제 */}
          {loading.forecastReview ? <CardSkeleton /> : forecastReview && (() => {
            const y = forecastReview.yesterday;
            const acc = forecastReview.accuracy;
            if (forecastReview.status === "no_data") {
              return (
                <div className="bg-surface-raised rounded-xl p-5 border border-border">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase mb-3">예측 복기</div>
                  <p className="text-[14px] text-text-tertiary m-0">예측 데이터 축적 중 — 내일부터 복기 시작</p>
                </div>
              );
            }
            return (
              <div className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">예측 복기 · 어제</div>
                  {y && <span className="text-[12px] text-text-tertiary">{y.date.slice(5)}</span>}
                </div>
                {y ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] text-text-secondary">
                        예측 <span className="font-bold text-text-primary">{y.predicted.toLocaleString()}L</span>
                        <span className="mx-1.5">→</span>
                        실제 <span className="font-bold text-text-primary">{y.actual != null ? `${y.actual.toLocaleString()}L` : "대기 중"}</span>
                      </div>
                      {y.errorPct != null && (
                        <span className={`text-[14px] font-bold ${Math.abs(y.errorPct) <= 5 ? "text-emerald-600" : Math.abs(y.errorPct) <= 15 ? "text-amber-500" : "text-red-500"}`}>
                          {y.errorPct > 0 ? "+" : ""}{y.errorPct}%
                        </span>
                      )}
                    </div>
                    {y.predictedCount != null && (
                      <div className="flex items-center justify-between">
                        <div className="text-[12px] text-text-secondary">
                          예측 <span className="font-bold text-text-primary">{y.predictedCount.toLocaleString()}대</span>
                          <span className="mx-1.5">→</span>
                          실제 <span className="font-bold text-text-primary">{y.actualCount != null ? `${y.actualCount.toLocaleString()}대` : "대기 중"}</span>
                        </div>
                        {y.countErrorPct != null && (
                          <span className={`text-[14px] font-bold ${Math.abs(y.countErrorPct) <= 5 ? "text-emerald-600" : Math.abs(y.countErrorPct) <= 15 ? "text-amber-500" : "text-red-500"}`}>
                            {y.countErrorPct > 0 ? "+" : ""}{y.countErrorPct}%
                          </span>
                        )}
                      </div>
                    )}
                    {y.causes.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-text-tertiary">오차 요인 분해</div>
                        {y.causes.map((c, i) => (
                          <div key={i} className={`text-[12px] flex items-start gap-1.5 rounded-md px-2 py-1 ${c.primary ? "bg-red-500/10 border border-red-500/20" : ""}`}>
                            <span className="shrink-0">{c.primary ? "🔴" : c.icon}</span>
                            <span className={`flex-1 ${c.primary ? "text-red-400 font-semibold" : "text-text-secondary"}`}>
                              {c.primary && <span className="text-[10px] font-bold uppercase mr-1">가장 큰 원인</span>}
                              {c.message}
                            </span>
                            <span className={`shrink-0 font-mono font-bold text-[11px] ${c.impactL >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                              {c.impactL >= 0 ? "+" : ""}{c.impactL.toLocaleString()}L
                            </span>
                          </div>
                        ))}
                        {y.errorBreakdown && (
                          <div className="text-[11px] text-text-tertiary mt-1 pt-1.5 border-t border-border font-mono">
                            {y.errorBreakdown}
                          </div>
                        )}
                      </div>
                    )}
                    {acc?.days7 && (
                      <div className="pt-2 border-t border-border flex items-center justify-between text-[12px]">
                        <span className="text-text-secondary">7일 평균 정확도</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`font-bold ${acc.days7.accuracy >= 90 ? "text-emerald-600" : acc.days7.accuracy >= 80 ? "text-amber-500" : "text-red-500"}`}>
                            {acc.days7.accuracy}%
                          </span>
                          <span className="text-text-tertiary">(±{acc.days7.avgErrorPct}%)</span>
                          {acc.trend && (
                            <span className={`text-[11px] font-bold ${acc.trend === "improving" ? "text-emerald-600" : acc.trend === "declining" ? "text-red-500" : "text-text-tertiary"}`}>
                              {acc.trend === "improving" ? "↗ 개선" : acc.trend === "declining" ? "↘ 악화" : "→ 유지"}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-text-tertiary/60 mt-2 mb-0 text-center">⚠️ 추정치 기반 분석 — 데이터 축적 시 정확도 향상</p>
                  </div>
                ) : (
                  <p className="text-[14px] text-text-tertiary m-0">어제 예측 데이터 없음</p>
                )}
              </div>
            );
          })()}

          {/* ⑪ 상관관계 네트워크 */}
          {loading.correlationMatrix ? <CardSkeleton /> : correlationMatrix && correlationMatrix.variables.length > 1 && (() => {
            const vars = correlationMatrix.variables.filter(v => v.id !== "sales");
            const CX = 160;
            const CY = 130;
            const ORBIT = 95;

            type NodePos = { x: number; y: number; v: typeof vars[0] };
            const nodes: NodePos[] = vars.map((v, i) => {
              const angle = -90 + (360 / vars.length) * i;
              const rad = (angle * Math.PI) / 180;
              return { x: CX + ORBIT * Math.cos(rad), y: CY + ORBIT * Math.sin(rad), v };
            });

            const top3 = correlationMatrix.ranking.slice(0, 3);

            return (
              <ClickableCard href="/dashboard/correlations" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">변수 상관관계</div>
                  <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                    {correlationMatrix.dataRange.totalDays}일 기준
                  </span>
                </div>
                <svg viewBox="0 0 320 260" className="w-full" style={{ maxHeight: 250 }}>
                  {/* 엣지 */}
                  {nodes.map((node) => {
                    const r = node.v.r ?? 0;
                    const absR = Math.abs(r);
                    const color = node.v.metric === "eta_squared" ? "#A78BFA"
                      : r > 0 ? "#10b981" : r < 0 ? "#ef4444" : "#9CA3AF";
                    return (
                      <line key={`e-${node.v.id}`}
                        x1={CX} y1={CY} x2={node.x} y2={node.y}
                        stroke={color}
                        strokeWidth={Math.max(0.5, absR * 4)}
                        strokeDasharray={node.v.significant ? "none" : "3,3"}
                        opacity={0.65}
                      />
                    );
                  })}
                  {/* 중심 */}
                  <circle cx={CX} cy={CY} r={22} fill="#D4A843" />
                  <circle cx={CX} cy={CY} r={22} fill="none" stroke="#B8922E" strokeWidth={1.5} />
                  <text x={CX} y={CY + 1} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#fff" fontWeight="bold">판매량</text>
                  {/* 노드 + 라벨 */}
                  {nodes.map((node) => {
                    const absR = node.v.r != null ? Math.abs(node.v.r) : 0;
                    const radius = Math.max(6, 4 + absR * 14);
                    const dx = node.x - CX;
                    const dy = node.y - CY;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const lx = node.x + (dx / len) * (radius + 6);
                    const ly = node.y + (dy / len) * (radius + 6);
                    const anchor = dx > 10 ? "start" : dx < -10 ? "end" : "middle";
                    return (
                      <g key={`n-${node.v.id}`}>
                        <circle cx={node.x} cy={node.y} r={radius}
                          fill={node.v.color} opacity={0.85}
                          stroke={node.v.lowSample ? "#fbbf24" : "none"}
                          strokeWidth={node.v.lowSample ? 1.5 : 0}
                          strokeDasharray={node.v.lowSample ? "2,2" : "none"}
                        />
                        <text x={lx} y={ly}
                          textAnchor={anchor} dominantBaseline="middle"
                          fontSize="7" fill="#374151" fontWeight="600"
                        >{node.v.label}</text>
                      </g>
                    );
                  })}
                </svg>
                <div className="flex items-center gap-3 mt-1 mb-2 text-[10px] text-text-tertiary">
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" /> 양의 상관</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block rounded" /> 음의 상관</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-purple-400 inline-block rounded" /> 요일 효과</span>
                </div>
                {top3.length > 0 && (
                  <div className="pt-2 border-t border-border">
                    <div className="text-[11px] text-text-tertiary mb-1">판매량 영향 Top 3</div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {top3.map((item, i) => (
                        <span key={item.id} className="text-[13px]">
                          <span className="text-text-tertiary">{i + 1}.</span>{" "}
                          <span className="font-bold text-text-primary">{item.label}</span>{" "}
                          <span className={`font-bold ${item.r >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {item.metric === "eta_squared"
                              ? `η²=${item.absEffect.toFixed(2)}`
                              : `${item.r >= 0 ? "+" : ""}${item.r.toFixed(2)}`}
                          </span>
                          {!item.significant && <span className="text-[10px] text-amber-500 ml-0.5">*</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </ClickableCard>
            );
          })()}

          {/* ⑧ 판매량·가격 분석 */}
          {loading.salesAnalysis ? <CardSkeleton /> : salesAnalysis && (
            <ClickableCard href="/dashboard/sales-analysis" className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase mb-3">판매량 · 가격 분석</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-secondary">일 평균 판매량</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[18px] font-extrabold text-text-primary tnum tracking-tight">{salesAnalysis.summary.avg30d.gasoline.toLocaleString()}L</span>
                    {salesAnalysis.events.length > 0 && (
                      <span className={`text-[16px] font-extrabold ${salesAnalysis.events[0].volumeChangeRate < 0 ? "text-red-500" : "text-emerald-500"}`}>
                        {salesAnalysis.events[0].volumeChangeRate >= 0 ? "↗" : "↘"}
                      </span>
                    )}
                  </div>
                </div>
                {salesAnalysis.events.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-secondary">최근 가격 변경</span>
                      <span className="text-[12px] font-semibold text-text-primary">{salesAnalysis.events[0].date.slice(5)} {salesAnalysis.events[0].priceChange > 0 ? "+" : ""}{salesAnalysis.events[0].priceChange}원</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-secondary">판매량 영향</span>
                      <span className={`text-[14px] font-bold ${salesAnalysis.events[0].volumeChangeRate < 0 ? "text-red-500" : "text-emerald-600"}`}>
                        {salesAnalysis.events[0].volumeChangeRate > 0 ? "+" : ""}{salesAnalysis.events[0].volumeChangeRate}%
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-[14px] text-text-tertiary m-0">가격 변경 이벤트 감지 대기 중</p>
                )}
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-[14px] text-text-secondary">가격 탄력성</span>
                  {salesAnalysis.summary.elasticity != null ? (
                    <span className={`text-[14px] font-bold ${salesAnalysis.summary.elasticityLabel === "민감" ? "text-red-500" : salesAnalysis.summary.elasticityLabel === "둔감" ? "text-emerald-600" : "text-amber-500"}`}>
                      {salesAnalysis.summary.elasticity} ({salesAnalysis.summary.elasticityLabel})
                    </span>
                  ) : (
                    <span className="text-[14px] text-text-tertiary">데이터 축적 중</span>
                  )}
                </div>
                {salesAnalysis.summary.elasticity != null && salesAnalysis.events.length > 0 && (() => {
                  const lastEvent = salesAnalysis.events[0];
                  const pctPer10 = lastEvent.priceChange !== 0 ? (lastEvent.volumeChangeRate / Math.abs(lastEvent.priceChange)) * 10 : null;
                  return pctPer10 != null ? (
                    <div className="mt-1.5 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-text-secondary">
                      10원 인상 시 예상 판매 변동: <span className={`font-bold ${pctPer10 <= 0 ? "text-red-500" : "text-emerald-600"}`}>{pctPer10 > 0 ? "+" : ""}{pctPer10.toFixed(1)}%</span>
                    </div>
                  ) : null;
                })()}
              </div>
            </ClickableCard>
          )}

          {/* 🌤️ 오늘 날씨 (하남시) */}
          {weather && weather.today && (() => {
            const todayW = weatherCodeLabel(weather.today.weatherCode);
            const tmrW = weather.tomorrow ? weatherCodeLabel(weather.tomorrow.weatherCode) : null;
            const todayRainy = (weather.today.precipProbMax ?? 0) >= 60 || (weather.today.precipSum ?? 0) >= 1;
            const tmrClear = weather.tomorrow && [0, 1].includes(weather.tomorrow.weatherCode ?? -1);
            const tmrRainy = weather.tomorrow && ((weather.tomorrow.precipProbMax ?? 0) >= 60 || (weather.tomorrow.precipSum ?? 0) >= 1);
            let insight: { msg: string; color: "blue" | "emerald" | "amber" | "slate" } | null = null;
            if (todayRainy) insight = { msg: "비 예보 · 주유 수요 감소 가능성, 가격 인하는 신중히", color: "blue" };
            else if (tmrRainy) insight = { msg: "내일 비 예보 · 오늘 중 수요 선확보 기회", color: "amber" };
            else if (tmrClear) insight = { msg: "내일 맑음 · 세차 수요 증가 예상", color: "emerald" };
            return (
              <div className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">오늘 날씨 · 하남시</div>
                  <span className="text-[12px] text-text-tertiary">실시간</span>
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <div className="text-[48px] leading-none">{todayW.icon}</div>
                  <div>
                    <div className="text-[14px] font-semibold text-text-primary">{todayW.label}</div>
                    {weather.current.temperature != null && (
                      <div className="text-[28px] font-extrabold text-text-primary tnum tracking-tight leading-tight">{Math.round(weather.current.temperature)}°</div>
                    )}
                    <div className="text-[12px] text-text-tertiary">
                      {weather.today.tempMin != null && weather.today.tempMax != null ? `${Math.round(weather.today.tempMin)}° / ${Math.round(weather.today.tempMax)}°` : "-"}
                      {weather.today.precipProbMax != null && ` · 강수 ${weather.today.precipProbMax}%`}
                    </div>
                  </div>
                </div>
                {weather.tomorrow && tmrW && (
                  <div className="flex items-center justify-between text-[12px] text-text-secondary border-t border-border pt-2">
                    <span>내일</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[16px]">{tmrW.icon}</span>
                      <span>{tmrW.label}</span>
                      {weather.tomorrow.tempMin != null && weather.tomorrow.tempMax != null && (
                        <span className="text-text-tertiary">{Math.round(weather.tomorrow.tempMin)}°/{Math.round(weather.tomorrow.tempMax)}°</span>
                      )}
                      {weather.tomorrow.precipProbMax != null && weather.tomorrow.precipProbMax > 0 && (
                        <span className="text-blue-500">{weather.tomorrow.precipProbMax}%</span>
                      )}
                    </span>
                  </div>
                )}
                {weatherImpact?.todayForecast && (
                  <div className={`mt-2 text-[12px] font-semibold ${weatherImpact.todayForecast.diffVsDryPct < -3 ? "text-red-500" : weatherImpact.todayForecast.diffVsDryPct > 3 ? "text-emerald-600" : "text-text-secondary"}`}>
                    예상 판매 영향: {weatherImpact.todayForecast.diffVsDryPct > 0 ? "+" : ""}{weatherImpact.todayForecast.diffVsDryPct}% (맑은날 대비)
                  </div>
                )}
                {insight && <InsightBadge color={insight.color}>{insight.msg}</InsightBadge>}
              </div>
            );
          })()}

          {/* ② 경쟁사 행동 패턴 */}
          {loading.changes ? <CardSkeleton /> : changes && (
            <ClickableCard href="/dashboard/competitors" className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">
                  경쟁사 가격 변동
                  <span className="text-[12px] font-normal text-text-tertiary ml-1">오늘</span>
                </div>
                <DataFreshness date={todayKST()} label="기준" />
              </div>
              {changes.changes.length === 0 ? (
                <div className="text-[14px] text-text-tertiary py-4 text-center">
                  오늘 경쟁사 가격 변동 없음
                </div>
              ) : (() => {
                const rising = changes.changes.filter(c => (c.gasoline_diff ?? 0) > 0).length;
                const falling = changes.changes.filter(c => (c.gasoline_diff ?? 0) < 0).length;
                const total = changes.changes.length;
                const maxDiff = Math.max(...changes.changes.map(c => Math.abs(c.gasoline_diff ?? 0)), 1);
                return (
                  <>
                    {/* 인상/인하 비율 바 */}
                    {(rising > 0 || falling > 0) && (
                      <div className="mb-3">
                        <div className="flex rounded-full overflow-hidden h-5">
                          {rising > 0 && (
                            <div className="bg-red-400 flex items-center justify-center text-white text-[11px] font-bold" style={{ width: `${(rising / total) * 100}%` }}>
                              인상 {rising}
                            </div>
                          )}
                          {falling > 0 && (
                            <div className="bg-blue-400 flex items-center justify-center text-white text-[11px] font-bold" style={{ width: `${(falling / total) * 100}%` }}>
                              인하 {falling}
                            </div>
                          )}
                          {total - rising - falling > 0 && (
                            <div className="bg-slate-200 flex items-center justify-center text-text-tertiary text-[11px] font-bold" style={{ width: `${((total - rising - falling) / total) * 100}%` }}>
                              유지 {total - rising - falling}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* 수평 바 차트 */}
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {changes.changes.map((c) => {
                        const diff = c.gasoline_diff ?? 0;
                        const barWidth = Math.max(Math.abs(diff) / maxDiff * 45, 2);
                        return (
                          <div key={c.id} className="flex items-center gap-2 h-6">
                            <div className="flex items-center gap-1 w-[140px] shrink-0 min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                              <span className="text-[11px] text-text-primary truncate shrink-1 min-w-[40px]">{c.name}</span>
                              {(() => { const prof = insights?.competitorProfiles.find(p => p.id === c.id); return prof && prof.type !== "unknown" ? (
                                <span className={`text-[8px] font-bold px-1 py-0 rounded-full shrink-0 whitespace-nowrap ${prof.type === "leader" ? "bg-red-100 text-red-600" : prof.type === "follower" ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"}`}>{prof.type === "leader" ? "선제" : prof.type === "follower" ? "추종" : "안정"}</span>
                              ) : null; })()}
                            </div>
                            <div className="flex-1 flex items-center">
                              {/* 0 기준선 중앙 배치 */}
                              <div className="flex-1 flex items-center relative h-4">
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
                                {diff !== 0 && (
                                  <div
                                    className={`absolute h-3 rounded-sm ${diff > 0 ? "bg-red-400" : "bg-blue-400"}`}
                                    style={{
                                      left: diff > 0 ? "50%" : `${50 - barWidth}%`,
                                      width: `${barWidth}%`,
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                            <span className={`text-[11px] font-bold w-[40px] text-right shrink-0 ${diff > 0 ? "text-coral" : diff < 0 ? "text-blue-600" : "text-text-tertiary"}`}>
                              {diff > 0 ? "+" : ""}{diff}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
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
                  {(() => {
                    const movedLeaders = changes.changes.filter(ch => {
                      const prof = insights!.competitorProfiles.find(p => p.id === ch.id);
                      return prof?.type === "leader" && (ch.gasoline_diff ?? 0) !== 0;
                    });
                    const followerCount = insights!.competitorProfiles.filter(p => p.type === "follower").length;
                    return movedLeaders.length > 0 && followerCount > 0 ? (
                      <><br />→ 선제형 {movedLeaders.map(l => l.name).join(", ")} 변동 · 추종형 {followerCount}곳 1~2일 내 반응 예상</>
                    ) : null;
                  })()}
                </InsightBadge>
              )}
            </ClickableCard>
          )}

          {/* ① 가격 포지션 변화 */}
          {loading.competitors ? <CardSkeleton /> : competitors && (
            <ClickableCard href="/dashboard/price-position" className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">내 가격 · 포지션</div>
                <DataFreshness date={priceHistory?.history?.[priceHistory.history.length - 1]?.date ?? null} label="업데이트" />
              </div>
              <div className="space-y-3">
                {competitors.baseStation.gasoline_price && competitors.stats.my_gasoline_rank && (() => {
                  const cheapestGas = Math.min(...competitors.competitors.map(c => c.gasoline_price).filter((p): p is number => p != null && p > 0));
                  const gapToFirst = competitors.baseStation.gasoline_price! - cheapestGas;
                  return (
                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[12px] text-text-secondary">휘발유</span>
                        <div className="text-[22px] font-extrabold text-text-primary tnum tracking-tight">
                          {competitors.baseStation.gasoline_price!.toLocaleString()}
                          <span className="text-[14px] font-normal text-text-secondary ml-0.5">원</span>
                        </div>
                      </div>
                      {insights && insights.rankChange.gasoline.diff != null && insights.rankChange.gasoline.diff !== 0 && (
                        <div className={`text-[20px] font-extrabold ${insights.rankChange.gasoline.diff < 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {insights.rankChange.gasoline.diff < 0 ? "▲" : "▼"}{Math.abs(insights.rankChange.gasoline.diff)}
                        </div>
                      )}
                    </div>
                    <RankGauge rank={competitors.stats.my_gasoline_rank} total={competitors.stats.total_count} label="휘발유" />
                    {gapToFirst > 0 && competitors.stats.my_gasoline_rank > 1 && (
                      <div className="text-[12px] font-semibold text-blue-600 mt-0.5 text-center">1위까지 -{gapToFirst}원</div>
                    )}
                  </div>
                  );
                })()}
                {competitors.baseStation.diesel_price && competitors.stats.my_diesel_rank && (
                  <div>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[12px] text-text-secondary">경유</span>
                        <div className="text-[22px] font-extrabold text-text-primary tnum tracking-tight">
                          {competitors.baseStation.diesel_price.toLocaleString()}
                          <span className="text-[14px] font-normal text-text-secondary ml-0.5">원</span>
                        </div>
                      </div>
                      {insights && insights.rankChange.diesel.diff != null && insights.rankChange.diesel.diff !== 0 && (
                        <div className={`text-[20px] font-extrabold ${insights.rankChange.diesel.diff < 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {insights.rankChange.diesel.diff < 0 ? "▲" : "▼"}{Math.abs(insights.rankChange.diesel.diff)}
                        </div>
                      )}
                    </div>
                    <RankGauge rank={competitors.stats.my_diesel_rank} total={competitors.stats.total_count} label="경유" />
                  </div>
                )}
              </div>
              {/* 순위 변동 인사이트 */}
              {insights && insights.rankChange.reason && (
                <InsightBadge color={
                  insights.rankChange.gasoline.diff != null && insights.rankChange.gasoline.diff < 0 ? "emerald"
                  : insights.rankChange.gasoline.diff != null && insights.rankChange.gasoline.diff > 0 ? "red"
                  : "slate"
                }>
                  {insights.rankChange.gasoline.diff != null && insights.rankChange.gasoline.diff !== 0
                    ? `어제 ${insights.rankChange.gasoline.yesterday?.rank}위 → 오늘 ${insights.rankChange.gasoline.today?.rank}위 · `
                    : ""}
                  {insights.rankChange.reason || `반경 5km 평균: 휘발유 ${competitors.stats.avg_gasoline?.toLocaleString()}원`}
                </InsightBadge>
              )}
            </ClickableCard>
          )}

          {/* ③ 적정가 벤치마크 */}
          {loading.benchmark ? <CardSkeleton /> : benchmark && (
            <ClickableCard href="/dashboard/benchmark" className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">적정가 벤치마크</div>
                <DataFreshness date={priceHistory?.history?.[priceHistory.history.length - 1]?.date ?? null} label="업데이트" />
              </div>
              <div className="space-y-4">
                {benchmark.benchmarks.district && (
                  <PriceRangeBar
                    myPrice={benchmark.station.price}
                    avg={benchmark.benchmarks.district.avg}
                    label={benchmark.benchmarks.district.label}
                    rank={benchmark.benchmarks.district.rank}
                    count={benchmark.benchmarks.district.count}
                  />
                )}
                <div className="border-t border-border pt-3">
                  <PriceRangeBar
                    myPrice={benchmark.station.price}
                    avg={benchmark.benchmarks.overall.avg}
                    label={benchmark.benchmarks.overall.label}
                    rank={benchmark.benchmarks.overall.rank}
                    count={benchmark.benchmarks.overall.count}
                  />
                </div>
              </div>
              {/* 벤치마크 인사이트 */}
              {insights?.benchmarkInsight && (
                <InsightBadge color={insights.myPosition === "cheap" ? "blue" : insights.myPosition === "expensive" ? "red" : "emerald"}>
                  {insights.benchmarkInsight}
                  {(() => {
                    if (!salesAnalysis?.events.length || salesAnalysis.events.length < 2) return null;
                    const validEvts = salesAnalysis.events.filter(e => e.priceChange !== 0);
                    if (validEvts.length < 2) return null;
                    let sumW = 0, sumWV = 0;
                    for (const e of validEvts) { const w = Math.abs(e.priceChange); sumW += w; sumWV += e.volumeChangeRate * w; }
                    const avgAbsChg = sumW / validEvts.length;
                    const pctPer10 = +((sumWV / sumW / avgAbsChg) * -10).toFixed(1); // -10 = 10원 인하
                    if (pctPer10 <= 0) return null;
                    return <><br />10원 인하 시 예상 판매량 +{pctPer10}% (탄력성 기반)</>;
                  })()}
                </InsightBadge>
              )}
            </ClickableCard>
          )}

          {/* ⑨ 타이밍 분석 */}
          {loading.timingAnalysis ? <CardSkeleton /> : timingAnalysis && (
            <ClickableCard href="/dashboard/timing-analysis" className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">타이밍 분석</div>
                {timingAnalysis.currentSituation.urgency !== "none" && (
                  <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-full ${
                    timingAnalysis.currentSituation.urgency === "high" ? "bg-red-900/50 text-red-700 border border-red-200" :
                    timingAnalysis.currentSituation.urgency === "medium" ? "bg-amber-900/50 text-amber-700 border border-amber-200" :
                    "bg-blue-900/50 text-blue-700 border border-blue-200"
                  }`}>
                    {timingAnalysis.currentSituation.urgency === "high" ? "긴급" :
                     timingAnalysis.currentSituation.urgency === "medium" ? "주의" : "참고"}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-text-primary m-0 leading-relaxed mb-3">
                {timingAnalysis.currentSituation.message}
              </p>
              <div className="space-y-1.5">
                {timingAnalysis.competitorSpeed.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[14px]">
                    <span className="text-text-secondary">{c.rank}위 {c.name}</span>
                    <span className="font-semibold text-text-primary">
                      {c.avgDaysToReact != null ? `${c.avgDaysToReact}일` : "—"}
                    </span>
                  </div>
                ))}
              </div>
              {timingAnalysis.timingImpact?.optimalDays && (
                <div className="mt-2 pt-2 border-t border-border text-[14px] text-text-secondary">
                  최적 대응: 경쟁사 반응 후 <span className="font-bold text-text-primary">{timingAnalysis.timingImpact.optimalDays}일 이내</span>
                </div>
              )}
              {timingAnalysis.timingImpact?.earlyResponse && timingAnalysis.timingImpact?.lateResponse && (
                <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-text-secondary">빠른 반응 시 판매량</span>
                    <span className={`font-bold ${timingAnalysis.timingImpact.earlyResponse.avgSalesChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {timingAnalysis.timingImpact.earlyResponse.avgSalesChange > 0 ? "+" : ""}{timingAnalysis.timingImpact.earlyResponse.avgSalesChange.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-text-secondary">느린 반응 시 판매량</span>
                    <span className={`font-bold ${timingAnalysis.timingImpact.lateResponse.avgSalesChange >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {timingAnalysis.timingImpact.lateResponse.avgSalesChange > 0 ? "+" : ""}{timingAnalysis.timingImpact.lateResponse.avgSalesChange.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </ClickableCard>
          )}

          {/* ⑨ 가격 연동성 인사이트 */}
          {!loading.insights && insights && insights.correlationInsights.length > 0 && (
            <div className="bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">가격 연동성</div>
                <DataFreshness date={priceHistory?.history?.[priceHistory.history.length - 1]?.date ?? null} label="분석 기준" />
              </div>
              <div className="space-y-2.5">
                {insights.correlationInsights.slice(0, 4).map((c) => {
                  const absCorr = Math.abs(c.correlation);
                  const barColor = c.correlation >= 0.7 ? "bg-emerald-500"
                    : c.correlation >= 0.3 ? "bg-amber-400"
                    : c.correlation >= -0.3 ? "bg-slate-300"
                    : "bg-red-400";
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                          <span className="text-[14px] text-text-primary truncate">{c.name}</span>
                          {(() => { const prof = insights.competitorProfiles.find(p => p.id === c.id); return prof && prof.type !== "unknown" ? (
                            <span className={`text-[8px] font-bold px-1 py-0 rounded-full shrink-0 ${prof.type === "leader" ? "bg-red-100 text-red-600" : prof.type === "follower" ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"}`}>{prof.typeLabel}</span>
                          ) : null; })()}
                          {(() => { const prof = insights.competitorProfiles.find(p => p.id === c.id); return c.correlation >= 0.7 && prof?.type === "leader" ? (
                            <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1 py-0 rounded-full">핵심 추적</span>
                          ) : null; })()}
                        </div>
                        <span className="text-[14px] font-bold text-text-primary shrink-0 ml-2">{c.correlation.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(absCorr * 100, 8)}%` }} />
                      </div>
                      <div className="text-[12px] text-text-secondary">{c.label} — {c.insight}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[12px] text-text-tertiary">
                * 18일간 일별 가격 변동 방향의 상관계수 (1.0 = 완전 동조, -1.0 = 완전 역방향)
              </div>
            </div>
          )}

          {/* ⑦ 내 가격 추이 (wide) */}
          {loading.priceHistory ? (
            <div className="md:col-span-2 lg:col-span-3"><CardSkeleton /></div>
          ) : priceHistory && priceHistory.history.length > 0 && (
            <ClickableCard href="/dashboard/price-history" className="md:col-span-2 lg:col-span-3 bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">내 가격 추이 (30일)</div>
                  <DataFreshness date={priceHistory.history[priceHistory.history.length - 1]?.date ?? null} label="최종" />
                </div>
                <div className="flex gap-3 text-[12px]">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 rounded bg-coral inline-block" /> 휘발유
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 rounded bg-text-primary inline-block" /> 경유
                  </span>
                </div>
              </div>
              {(() => {
                const hist = priceHistory.history;
                const recent14 = hist.slice(-14);
                let chgCnt = 0, totalChg = 0;
                for (let i = 1; i < recent14.length; i++) {
                  const prev = recent14[i - 1].gasoline, curr = recent14[i].gasoline;
                  if (prev && curr && prev !== curr) { chgCnt++; totalChg += Math.abs(curr - prev); }
                }
                const avgChg = chgCnt > 0 ? Math.round(totalChg / chgCnt) : 0;
                const first = recent14[0]?.gasoline, last = recent14[recent14.length - 1]?.gasoline;
                const trend = first && last ? (last > first ? "상승" : last < first ? "하락" : "보합") : null;
                const trendIcon = trend === "상승" ? "↗" : trend === "하락" ? "↘" : "→";
                const trendColor = trend === "상승" ? "text-red-500" : trend === "하락" ? "text-blue-500" : "text-slate-400";
                return (
                  <div className="text-[12px] text-text-secondary mb-2">
                    최근 2주: 변경 {chgCnt}회{avgChg > 0 && <>, 평균 ±{avgChg}원</>}
                    {trend && <span className={`font-bold ml-1.5 ${trendColor}`}>{trendIcon} {trend}</span>}
                  </div>
                );
              })()}
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={priceHistory.history.map((h) => ({ ...h, date: h.date.slice(5) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#9CA3AF" }} interval="preserveStartEnd" />
                  <YAxis domain={["dataMin - 20", "dataMax + 20"]} tick={{ fontSize: 12, fill: "#9CA3AF" }} tickFormatter={(v) => v.toLocaleString()} width={45} />
                  <Tooltip
                    formatter={(value, name) => [`${Number(value).toLocaleString()}원`, name]}
                    contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: "#1A1A1A" }}
                    itemStyle={{ color: "#1A1A1A" }}
                  />
                  <Line type="monotone" dataKey="gasoline" stroke="#FF5252" strokeWidth={2} dot={false} name="휘발유" connectNulls />
                  <Line type="monotone" dataKey="diesel" stroke="#1A1A1A" strokeWidth={2} dot={false} name="경유" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </ClickableCard>
          )}

          {/* ⑧ 경쟁사 프로파일링 */}
          {!loading.insights && insights && insights.competitorProfiles.length > 0 && (
            <div className="md:col-span-2 bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">경쟁사 프로파일</div>
                <DataFreshness date={priceHistory?.history?.[priceHistory.history.length - 1]?.date ?? null} label="분석 기준" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {insights.competitorProfiles.slice(0, 6).map((p) => {
                  const typeColors = {
                    leader: { bg: "bg-red-50 border border-red-100", text: "text-red-700", badge: "bg-red-900/50 text-red-700" },
                    follower: { bg: "bg-amber-50 border border-amber-100", text: "text-amber-700", badge: "bg-amber-900/50 text-amber-700" },
                    steady: { bg: "bg-slate-50 border border-slate-200", text: "text-slate-600", badge: "bg-slate-100 text-slate-700" },
                    unknown: { bg: "bg-slate-50 border border-slate-200", text: "text-slate-500", badge: "bg-slate-100 text-slate-600" },
                  };
                  const tc = typeColors[p.type];
                  return (
                    <div key={p.id} className={`rounded-lg px-3 py-2.5 ${tc.bg}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[p.brand] || "#9BA8B7" }} />
                          <span className="text-[12px] font-medium text-text-primary truncate">{p.name}</span>
                        </div>
                        <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${tc.badge}`}>
                          {p.type === "leader" ? "선제형" : p.type === "follower" ? "추종형" : "안정형"}
                        </span>
                        {(() => { const ch = changes?.changes.find(c => c.id === p.id); const diff = ch?.gasoline_diff ?? 0; return diff !== 0 ? (
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full shrink-0 ${diff > 0 ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                            오늘 {diff > 0 ? "↑" : "↓"}{Math.abs(diff)}원
                          </span>
                        ) : null; })()}
                      </div>
                      <div className="text-[12px] text-text-secondary">
                        {p.changeCount}회 변경 · 평균 {p.avgChangeSize}원폭
                        {p.currentPrice && <span className="ml-1">· 현재 {p.currentPrice.toLocaleString()}원</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-[12px] text-text-tertiary">
                * 최근 18일 가격 변경 빈도 기반 분류 (5회 이상: 선제형, 3~4회: 추종형, 2회 이하: 안정형)
              </div>
            </div>
          )}

          {/* ⑩ 가격 시뮬레이터 */}
          {!loading.competitors && competitors && competitors.competitors.length > 0 && (() => {
            const myGas = competitors.baseStation.gasoline_price;
            if (!myGas) return null;
            const allPrices = [myGas, ...competitors.competitors.map((c) => c.gasoline_price).filter((p): p is number => p != null && p > 0)].sort((a, b) => a - b);
            const currentRank = allPrices.indexOf(myGas) + 1;

            // 가중평균 탄력성 계산 (가격 변동폭으로 가중)
            let weightedElasticity: number | null = null;
            if (salesAnalysis && salesAnalysis.events.length >= 2) {
              const validEvents = salesAnalysis.events.filter(e => e.priceChange !== 0);
              if (validEvents.length >= 2) {
                let sumWeightedVol = 0, sumWeight = 0;
                for (const e of validEvents) {
                  const weight = Math.abs(e.priceChange);
                  sumWeightedVol += e.volumeChangeRate * weight;
                  sumWeight += weight;
                }
                if (sumWeight > 0) {
                  // volumeChangeRate per 가격변동원 → 10원 기준 환산
                  weightedElasticity = (sumWeightedVol / sumWeight);
                }
              }
            }

            // 주중/주말 보정
            const todayDow = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Seoul", weekday: "short" });
            const isWeekendNow = todayDow === "Sat" || todayDow === "Sun";
            let dowElasticity = weightedElasticity;
            if (salesAnalysis?.splitElasticity) {
              const split = isWeekendNow ? salesAnalysis.splitElasticity.weekend : salesAnalysis.splitElasticity.weekday;
              if (split.avgVolumeChangeRate != null && split.count >= 2) {
                dowElasticity = split.avgVolumeChangeRate;
              }
            }

            // 날씨 보정 계수
            const weatherAdj = weatherImpact?.todayForecast?.diffVsDryPct ?? 0;

            const simulations = [10, 20, 30, -10, -20].map((delta) => {
              const simPrice = myGas + delta;
              const simPrices = [simPrice, ...competitors.competitors.map((c) => c.gasoline_price).filter((p): p is number => p != null && p > 0)].sort((a, b) => a - b);
              const simRank = simPrices.indexOf(simPrice) + 1;
              // 예상 판매 변동: (가중탄력성 / 실제평균변동원) × delta원 + 날씨보정
              let salesImpact: number | null = null;
              if (dowElasticity != null && salesAnalysis) {
                const validEvents = salesAnalysis.events.filter(e => e.priceChange !== 0);
                const avgAbsChange = validEvents.length > 0
                  ? validEvents.reduce((s, e) => s + Math.abs(e.priceChange), 0) / validEvents.length
                  : 10;
                salesImpact = +(((dowElasticity / avgAbsChange) * delta) + weatherAdj).toFixed(1);
              }
              return { delta, simPrice, simRank, total: simPrices.length, rankChange: simRank - currentRank, salesImpact };
            });

            // 오늘 컨텍스트 라벨
            const dowLabel = isWeekendNow ? "주말" : "주중";
            const weatherLabel = weatherImpact?.todayForecast
              ? (weatherImpact.todayForecast.intensity === "heavy" ? "비" : weatherImpact.todayForecast.intensity === "light" ? "약한 비" : "맑음")
              : null;
            const contextLabel = weatherLabel ? `${dowLabel} · ${weatherLabel}` : dowLabel;

            return (
              <div className="md:col-span-2 lg:col-span-3 bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">가격 시뮬레이터</div>
                  {dowElasticity != null && (
                    <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                      오늘 기준: {contextLabel}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-text-tertiary mb-3">현재 휘발유 {myGas.toLocaleString()}원 · {allPrices.length}개 중 {currentRank}위 — 가격 변경 시 순위·판매량 변화 예측</div>
                <div className="grid grid-cols-5 gap-2">
                  {simulations.map(({ delta, simPrice, simRank, total, rankChange, salesImpact }) => {
                    const isUp = delta > 0;
                    return (
                      <div key={delta} className={`rounded-lg p-3 text-center border ${isUp ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"}`}>
                        <div className={`text-[12px] font-bold ${isUp ? "text-red-600" : "text-blue-600"}`}>
                          {delta > 0 ? "+" : ""}{delta}원
                        </div>
                        <div className="text-[16px] font-extrabold text-text-primary tnum tracking-tight mt-1">{simPrice.toLocaleString()}</div>
                        <div className="text-[14px] text-text-secondary mt-1">
                          {total}개 중 <span className="font-bold">{simRank}위</span>
                        </div>
                        {rankChange !== 0 && (
                          <div className={`text-[12px] font-medium mt-0.5 ${rankChange > 0 ? "text-coral" : "text-blue-600"}`}>
                            {rankChange > 0 ? `▼${rankChange}단계` : `▲${Math.abs(rankChange)}단계`}
                          </div>
                        )}
                        {rankChange === 0 && (
                          <div className="text-[12px] text-text-tertiary mt-0.5">변동 없음</div>
                        )}
                        {salesImpact != null && (
                          <div className={`text-[11px] font-bold mt-1 pt-1 border-t ${
                            isUp ? "border-red-200" : "border-blue-200"
                          } ${salesImpact <= -3 ? "text-red-600" : salesImpact >= 3 ? "text-emerald-600" : "text-text-secondary"}`}>
                            판매 {salesImpact > 0 ? "+" : ""}{salesImpact}%
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {dowElasticity != null && (
                  <div className="mt-2 text-[10px] text-text-tertiary">
                    * 과거 가격변경 {salesAnalysis?.events.length ?? 0}건의 가중평균 탄력성 기반
                    {salesAnalysis?.splitElasticity && isWeekendNow !== undefined && ` · ${dowLabel} 보정`}
                    {weatherAdj !== 0 && ` · 날씨 영향 ${weatherAdj > 0 ? "+" : ""}${weatherAdj}% 반영`}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ⑤ 국제유가 + 향후 전망 */}
          {loading.oilPrices ? <CardSkeleton /> : oilPrices && (() => {
            const oilTrend = oilPrices.summary?.brentChange;
            const isOilUp = (oilTrend ?? 0) > 0;
            const isOilDown = (oilTrend ?? 0) < 0;
            const oilChartData = oilPrices.prices.map((p) => ({ ...p, date: p.date.slice(5) }));
            const refStartDate = oilChartData[twoWeeksFromNowIdx]?.date;
            const refEndDate = oilChartData[oilChartData.length - 1]?.date;
            return (
            <ClickableCard href="/dashboard/oil-prices" className="rounded-2xl p-5 shadow-sm border border-border bg-surface-raised">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">국제유가 · 전망</div>
                  {oilTrend != null && oilTrend !== 0 && (
                    <span className={`text-[18px] font-extrabold ${isOilUp ? "text-red-500" : "text-blue-500"}`}>
                      {isOilUp ? "↗" : "↘"}
                    </span>
                  )}
                </div>
                <DataFreshness date={oilPrices.prices?.[oilPrices.prices.length - 1]?.date ?? null} label="최종 데이터" />
              </div>
              {oilPrices.summary && (
                <div className="flex gap-3 mb-3 text-[14px]">
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
                <LineChart data={oilChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#9CA3AF" }} interval="preserveStartEnd" />
                  <YAxis domain={["dataMin - 3", "dataMax + 3"]} tick={{ fontSize: 9, fill: "#9CA3AF" }} tickFormatter={(v) => `$${v}`} width={40} />
                  <Tooltip
                    formatter={(value, name) => [`$${value}`, name]}
                    contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E5E5", borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: "#1A1A1A" }}
                    itemStyle={{ color: "#1A1A1A" }}
                  />
                  {refStartDate && refEndDate && (
                    <ReferenceArea x1={refStartDate} x2={refEndDate} fill={isOilUp ? "#fecaca" : isOilDown ? "#bfdbfe" : "#e2e8f0"} fillOpacity={0.3} label={{ value: "반영 중", position: "insideTop", fontSize: 9, fill: "#94a3b8" }} />
                  )}
                  <Line type="monotone" dataKey="wti" stroke="#f97316" strokeWidth={1.5} dot={false} name="WTI" connectNulls />
                  <Line type="monotone" dataKey="brent" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Brent" connectNulls />
                </LineChart>
              </ResponsiveContainer>
              {insights?.oilWeekTrend.message && (
                <InsightBadge color={
                  insights.oilWeekTrend.trend === "rising" ? "red"
                    : insights.oilWeekTrend.trend === "falling" ? "blue"
                    : "slate"
                }>
                  {insights.oilWeekTrend.message}
                  {insights.oilToRetailRatio && oilPrices?.summary?.brentChange != null && Math.abs(oilPrices.summary.brentChange) >= 1 && (() => {
                    const r = insights.oilToRetailRatio!;
                    const bc = oilPrices.summary!.brentChange!;
                    const estMin = Math.round(bc * r.minWon);
                    const estMax = Math.round(bc * r.maxWon);
                    const [lo, hi] = estMin <= estMax ? [estMin, estMax] : [estMax, estMin];
                    return (
                      <><br />예상 소매가 영향: {lo > 0 ? "+" : ""}{lo}~{hi > 0 ? "+" : ""}{hi}원 (과거 {r.sampleCount}건 기반)</>
                    );
                  })()}
                </InsightBadge>
              )}
            </ClickableCard>
            );
          })()}

          {/* ④ 유가 반영 분석 (wide) */}
          {loading.detail ? (
            <div className="md:col-span-2"><CardSkeleton /></div>
          ) : detail?.oilReflection && (
            <ClickableCard href="/dashboard/oil-reflection" className="md:col-span-2 bg-surface-raised rounded-xl p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">유가 반영 분석</div>
                <DataFreshness date={oilPrices?.prices?.[oilPrices.prices.length - 1]?.date ?? null} label="유가 데이터" />
              </div>
              <OilReflectionProgress
                direction={detail.oilReflection.direction}
                brentChange={detail.oilReflection.brentChange}
                priceChange={detail.oilReflection.priceChange}
                competitorAction={insights?.competitorPattern.action ?? "stable"}
              />
              <div className={`rounded-lg px-4 py-2.5 mt-3 border ${
                detail.oilReflection.direction === "up" ? "bg-red-50 border-red-100"
                  : detail.oilReflection.direction === "down" ? "bg-blue-50 border-blue-100"
                  : "bg-slate-50 border-slate-200"
              }`}>
                <span className={`text-[14px] font-semibold ${
                  detail.oilReflection.direction === "up" ? "text-red-700"
                    : detail.oilReflection.direction === "down" ? "text-blue-700"
                    : "text-slate-700"
                }`}>
                  {detail.oilReflection.message}
                </span>
              </div>
              {timingAnalysis?.timingImpact?.optimalDays != null && timingAnalysis.currentSituation.pendingReaction && (
                <div className={`rounded-lg px-3 py-2 mt-2 border text-[12px] ${
                  timingAnalysis.currentSituation.urgency === "high" ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"
                }`}>
                  <span className={`font-bold ${timingAnalysis.currentSituation.urgency === "high" ? "text-red-700" : "text-amber-700"}`}>
                    ⏱ 최적 반응 시점: {timingAnalysis.timingImpact.optimalDays}일 이내
                  </span>
                  {timingAnalysis.currentSituation.urgency === "high" && <span className="text-red-600 font-bold ml-1">· 긴급</span>}
                </div>
              )}
              {insights?.oilStory && (
                <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                  <div className="text-[14px] font-medium text-text-secondary mb-1">흐름 분석</div>
                  <div className="text-[12px] text-text-primary leading-relaxed">{insights.oilStory}</div>
                </div>
              )}
            </ClickableCard>
          )}

          {/* ⑥ EV 충전소 요약 (장기 전략 — 최하단) */}
          {loading.detail ? <CardSkeleton /> : detail?.evNearby && detail.evNearby.stations > 0 && (() => {
            const fs = detail.evNearby.fastStations;
            const threat = fs <= 5
              ? { label: "EV 전환 영향 적음", color: "text-emerald-600", bg: "bg-emerald-50 border border-emerald-100", signal: "🟢", barColor: "bg-emerald-500" }
              : fs <= 20
                ? { label: "EV 인프라 확대 중", color: "text-amber-600", bg: "bg-amber-50 border border-amber-100", signal: "🟡", barColor: "bg-amber-500" }
                : { label: "EV 충전 밀집 지역", color: "text-red-600", bg: "bg-red-50 border border-red-100", signal: "🔴", barColor: "bg-red-500" };
            return (
              <ClickableCard href="/dashboard/ev-threat" className="bg-surface-raised rounded-xl p-5 border border-border relative overflow-hidden">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${threat.barColor}`} />
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px]">{threat.signal}</span>
                    <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">EV 충전소 현황</div>
                  </div>
                  <DataFreshness date={todayKST()} label="기준" />
                </div>
                <div className={`rounded-xl px-4 py-3 ${threat.bg}`}>
                  <div className={`text-[14px] font-bold ${threat.color} mb-2`}>{threat.label}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-extrabold text-text-primary tnum tracking-tight">{fs}</span>
                    <span className="text-[12px] font-semibold text-text-secondary">급속 충전소</span>
                    <span className="text-[14px] text-text-secondary">(충전기 {detail.evNearby.fast}대)</span>
                  </div>
                  <div className="text-[14px] text-text-secondary mt-1">
                    완속 {detail.evNearby.stations - fs}개소 · 반경 3km
                  </div>
                </div>
              </ClickableCard>
            );
          })()}

        </div>
      </main>
    </div>
  );
}
