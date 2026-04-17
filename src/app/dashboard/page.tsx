"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/app/components/SiteHeader";
import type { SelfDiagnosisResult } from "@/lib/dashboard/forecast-self-diagnosis";
import type { ShadowEvaluationResult } from "@/lib/dashboard/forecast-correction-evaluate";
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

// ─── 자동 보정 verdict 변화 알림 (localStorage) ───
type ShadowVerdict = ShadowEvaluationResult["goNoGo"]["verdict"];
type VerdictNotice = {
  verdict: ShadowVerdict;
  changedAt: string;
  dismissed: boolean;
};
const VERDICT_NOTICE_KEY = (stationId: string) => `shadow-verdict-notice:${stationId}`;
const NOTICE_WINDOW_DAYS = 7;

function loadVerdictNotice(stationId: string): VerdictNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VERDICT_NOTICE_KEY(stationId));
    return raw ? (JSON.parse(raw) as VerdictNotice) : null;
  } catch {
    return null;
  }
}

function saveVerdictNotice(stationId: string, n: VerdictNotice): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VERDICT_NOTICE_KEY(stationId), JSON.stringify(n));
  } catch {
    // localStorage 접근 실패 시 무시 (사파리 프라이빗 모드 등)
  }
}

type BaselineEntry = { avgErrorPct: number; accuracy: number; count: number } | null;
type BaselineComparisonWindow = {
  window: "7d" | "30d";
  model: BaselineEntry;
  dowMean: BaselineEntry;
  sevenDayMA: BaselineEntry;
  improvementOverBestBaselinePct: number | null;
  commonSampleCount: number;
  droppedCount: number;
};

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

// ─── 섹션 구분선 ───
function SectionDivider({ title, description }: { title: string; description?: string }) {
  return (
    <div className="md:col-span-2 lg:col-span-3 flex items-center gap-3 pt-4 pb-1">
      <div>
        <div className="text-[18px] font-extrabold text-white">{title}</div>
        {description && <div className="text-[13px] text-white/60">{description}</div>}
      </div>
      <div className="flex-1 h-px bg-border" />
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
      <div className="flex items-center justify-end mt-3 pt-2 border-t border-border/60 text-[11px] font-semibold text-blue-600 gap-0.5 tracking-wider uppercase">
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

// ─── 시뮬레이터 자동 인사이트 ───
// 시뮬 데이터(splitElasticityByFuel.{fuel}) 에서 4가지 패턴 자동 감지.
// 우선순위: 비대칭(1) > 둔감(2) > 주중주말차(3) > 데이터부족(4)
// 명세: memory/spec_simulator_auto_insights.md
type SimSplitDir = { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null | undefined;
type SimSplit = { up?: SimSplitDir; down?: SimSplitDir } | null | undefined;
type SimInsight = { priority: number; tag: string; text: string };

function detectSimulatorInsights(split: { weekday: SimSplit; weekend: SimSplit }): SimInsight[] {
  const RATIO_CAP = 10;
  const INSENSITIVE_PCT = 0.5;     // |10원당 %| < 0.5 → 둔감
  const LOW_N_THRESHOLD = 5;       // n < 5 → 후보 제외 (데이터부족 인사이트는 발동)
  const OUTLIER_PCT = 100;         // |10원당 %| > 100 → outlier 제외
  const ASYM_RATIO = 2;            // 비대칭 비율 임계
  const DOW_RATIO = 2;             // 주중/주말 비율 임계

  // 10원당 % = (avgVolumeChangeRate / |avgPriceChange|) × 10
  const per10 = (d: SimSplitDir): number | null => {
    if (!d || d.count < 1 || !d.avgPriceChange) return null;
    return (d.avgVolumeChangeRate / Math.abs(d.avgPriceChange)) * 10;
  };
  // outlier·표본 가드 통과한 방향만 비교용으로 반환
  const validDir = (d: SimSplitDir): SimSplitDir => {
    if (!d || d.count < LOW_N_THRESHOLD) return null;
    const p = per10(d);
    if (p == null || Math.abs(p) > OUTLIER_PCT) return null;
    return d;
  };

  const wkUp = validDir(split.weekday?.up);
  const wkDown = validDir(split.weekday?.down);
  const weUp = validDir(split.weekend?.up);
  const weDown = validDir(split.weekend?.down);
  // 비교용 통합 방향: 주중 우선, 없으면 주말
  const upAny = wkUp ?? weUp;
  const downAny = wkDown ?? weDown;

  const candidates: SimInsight[] = [];

  // (1) 비대칭 — 인상 vs 인하 |10원당 %| 비율
  if (upAny && downAny) {
    const upP = Math.abs(per10(upAny)!);
    const downP = Math.abs(per10(downAny)!);
    if (upP > 0 && downP > 0) {
      const ratio = Math.max(upP, downP) / Math.min(upP, downP);
      if (ratio >= ASYM_RATIO) {
        const bigger = downP > upP ? "인하" : "인상";
        const smaller = bigger === "인하" ? "인상" : "인하";
        const text = ratio >= RATIO_CAP
          ? `${bigger} 반응이 ${smaller}보다 압도적으로 큼`
          : `${bigger} 반응이 ${smaller}의 ${ratio.toFixed(1)}배`;
        candidates.push({ priority: 1, tag: "비대칭", text });
      }
    }
  }

  // (2) 둔감 — 인상 또는 인하 |10원당 %| < 0.5
  for (const [d, label] of [[upAny, "인상"], [downAny, "인하"]] as const) {
    if (!d) continue;
    const p = per10(d)!;
    if (Math.abs(p) < INSENSITIVE_PCT) {
      const sign = p >= 0 ? "+" : "";
      const note = label === "인상"
        ? "가격 외 요인 영향"
        : "가격 인하로 판매 회복 어려움";
      candidates.push({
        priority: 2,
        tag: "둔감",
        text: `${label}에 둔감 (10원 ${label} 시 ${sign}${p.toFixed(2)}%) — ${note}`,
      });
      break; // 둔감은 하나만 (인상·인하 둘 다 둔감하면 인상 우선)
    }
  }

  // (3) 주중주말차 — 인상 기준 (인하는 주말 표본 적은 경우 多)
  if (wkUp && weUp) {
    const wkP = Math.abs(per10(wkUp)!);
    const weP = Math.abs(per10(weUp)!);
    if (wkP > 0 && weP > 0) {
      const ratio = Math.max(wkP, weP) / Math.min(wkP, weP);
      if (ratio >= DOW_RATIO) {
        const bigger = weP > wkP ? "주말" : "주중";
        const smaller = bigger === "주말" ? "주중" : "주말";
        const text = ratio >= RATIO_CAP
          ? `${bigger} 반응이 ${smaller}보다 압도적으로 큼`
          : `${bigger} 반응이 ${smaller}의 ${ratio.toFixed(1)}배`;
        candidates.push({ priority: 3, tag: "주중주말", text });
      }
    }
  }

  // (4) 데이터부족 — 방향별 n < 5 (raw split, validDir 거치기 전)
  const rawUpN = split.weekday?.up?.count ?? split.weekend?.up?.count ?? 0;
  const rawDownN = split.weekday?.down?.count ?? split.weekend?.down?.count ?? 0;
  const lowDirs: string[] = [];
  if (rawUpN > 0 && rawUpN < LOW_N_THRESHOLD) lowDirs.push(`인상 n=${rawUpN}`);
  if (rawDownN > 0 && rawDownN < LOW_N_THRESHOLD) lowDirs.push(`인하 n=${rawDownN}`);
  if (lowDirs.length > 0) {
    candidates.push({
      priority: 4,
      tag: "데이터부족",
      text: `${lowDirs.join(" / ")} — 축적 필요`,
    });
  }

  // 우선순위 sort (낮은 숫자 먼저)
  return candidates.sort((a, b) => a.priority - b.priority);
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
    summary: {
      avg30d: { gasoline: number; diesel: number };
      totalEvents: number;
      elasticity: number | null;           // 휘발유 전용 (backward-compat)
      elasticityLabel: string;              // 휘발유 전용
      elasticityByFuel?: {                  // 신규 — 유종별 독립
        gasoline: { avg: number | null; label: string };
        diesel: { avg: number | null; label: string };
      };
    };
    events: Array<{ date: string; fuel?: "gasoline" | "diesel"; priceChange: number; volumeChangeRate: number; recoveryRate: number | null; elasticity: number | null; isWeekend: boolean }>;
    splitElasticity: {                      // 휘발유 전용 (backward-compat)
      weekday: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
      weekend: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
    };
    splitElasticityByFuel?: {               // 신규 — 유종별 독립
      gasoline: {
        weekday: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
        weekend: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
      };
      diesel: {
        weekday: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
        weekend: { avg: number | null; count: number; avgVolumeChangeRate: number | null; up?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null; down?: { count: number; avgPriceChange: number; avgVolumeChangeRate: number } | null };
      };
    };
  } | null>(null);

  const [aiBriefing, setAiBriefing] = useState<{
    aiBriefing: string | null;
    aiBriefingOverridden?: string | null;
    fallback: boolean;
    recommendationType: string;
    validation?: {
      passed: boolean;
      warnings: Array<{
        rule: "structure" | "direction" | "range" | "timing" | "competitor" | "number";
        severity: "error" | "warning";
        line: number;
        detail: string;
      }>;
    };
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
      causes: Array<{ type: string; icon: string; message: string; impactL: number; impactPct: number; primary?: boolean; tooltipHint?: string }>;
      errorBreakdown: string | null;
      carwashCount: number | null;
      carwashRevenue: number | null;
      fuelTypeBreakdown?: {
        gasoline: {
          predictedVolume: number; actualVolume: number;
          predictedCount: number; actualCount: number;
          volumeErrorPct: number | null; countErrorPct: number | null;
        };
        diesel: {
          predictedVolume: number; actualVolume: number;
          predictedCount: number; actualCount: number;
          volumeErrorPct: number | null; countErrorPct: number | null;
        };
        source: "ratio_inference" | "unavailable";
      };
    } | null;
    accuracy: {
      days7: { avgErrorPct: number; accuracy: number; count: number } | null;
      days30: { avgErrorPct: number; accuracy: number; count: number } | null;
      trend: "improving" | "declining" | "stable" | null;
    } | null;
    baselineComparison?: {
      days7: BaselineComparisonWindow | null;
      days30: BaselineComparisonWindow | null;
    } | null;
  } | null>(null);

  const [selfDiagnosis, setSelfDiagnosis] = useState<SelfDiagnosisResult | null>(null);
  const [correctionShadow, setCorrectionShadow] = useState<ShadowEvaluationResult | null>(null);
  // accordion 펼침 상태 (사장님 지시 — 기본 펼침)
  const [shadowOpen, setShadowOpen] = useState(true);
  // verdict 변화 알림 배너 상태
  const [verdictNotice, setVerdictNotice] = useState<VerdictNotice | null>(null);

  // correctionShadow 가 갱신될 때마다 verdict 변화 감지 → localStorage 기록
  useEffect(() => {
    if (!correctionShadow) return;
    const current = correctionShadow.goNoGo.verdict;
    const stored = loadVerdictNotice(STATION_ID);

    if (!stored) {
      // 첫 관측 — insufficient 면 조용히 기록만(dismissed=true), 다른 verdict 면 바로 알림
      const next: VerdictNotice = {
        verdict: current,
        changedAt: new Date().toISOString(),
        dismissed: current === "insufficient",
      };
      saveVerdictNotice(STATION_ID, next);
      setVerdictNotice(next);
      return;
    }

    if (stored.verdict !== current) {
      // verdict 변화 — 새로 기록, dismissed 초기화 (단 insufficient로 역행 시에는 숨김)
      const next: VerdictNotice = {
        verdict: current,
        changedAt: new Date().toISOString(),
        dismissed: current === "insufficient",
      };
      saveVerdictNotice(STATION_ID, next);
      setVerdictNotice(next);
    } else {
      setVerdictNotice(stored);
    }
  }, [correctionShadow]);

  function dismissVerdictNotice(): void {
    if (!verdictNotice) return;
    const next = { ...verdictNotice, dismissed: true };
    saveVerdictNotice(STATION_ID, next);
    setVerdictNotice(next);
  }

  const [correlationMatrix, setCorrelationMatrix] = useState<{
    // commonDays: 경쟁사 페어 평균 일수 (구형 스냅샷에는 없을 수 있어 optional)
    dataRange: { totalDays: number; commonDays?: number };
    variables: Array<{
      id: string; label: string; group: string; color: string;
      metric: string; r: number | null; etaSq: number | null;
      p: number | null; n: number; significant: boolean; lowSample: boolean;
      distance_km?: number; // 경쟁사 변수에만 채워짐
    }>;
    ranking: Array<{
      id: string; label: string; absEffect: number; r: number;
      metric: string; n: number; significant: boolean;
    }>;
  } | null>(null);

  const [carwashSummary, setCarwashSummary] = useState<{
    today: { expectedCount: number; expectedRevenue: number; dowLabel: string; weatherAdjustment: string | null };
    yesterday: { date: string; count: number; revenue: number; vsLastWeekPct: number | null } | null;
    typeRatio: { basic: { count: number; pct: number }; premium: { count: number; pct: number }; taxi: { count: number; pct: number }; free: { count: number; pct: number } } | null;
    weatherInsight: string | null;
    review: { predicted: number; actual: number | null; errorPct: number | null } | null;
    accuracy7: { avgErrorPct: number; accuracy: number; count: number } | null;
    conversionRate: { fuelCount: number; carwashCount: number; pct: number } | null;
  } | null>(null);

  const [crossInsights, setCrossInsights] = useState<{
    weatherTriple: { carwashDrivenFuel: boolean; insight: string; heavySameDay: { fuelCount: number; carwashCount: number; conversionPct: number | null; n: number } | null; heavyNextDay: { fuelCount: number; carwashCount: number; conversionPct: number | null; n: number } | null };
    competitorCascade: { dataStatus: string; daysCollected: number; daysNeeded: number; insight: string };
    dowHighlight: { bestConversionDay: { label: string; conversionPct: number }; bestPremiumDay: { label: string; premiumPct: number } };
    similarDays: { count: number; avgFuelCount: number | null; avgCarwashCount: number | null; avgConversionPct: number | null; confidence: string; insight: string };
  } | null>(null);

  const [integratedForecast, setIntegratedForecast] = useState<{
    forecast: {
      expectedVolume: number;
      expectedCount: number;
      confidence: "high" | "medium" | "low";
      explanation: string;
      baseline: number;
      diffVsDryPct: number;
      weatherOnly: number;
      modelVersion: string;
      totalDataDays: number;
      contributions: Array<{
        name: string; label: string; value: number; pct: number;
        n: number; reliable: boolean; badge: string;
        method: "measured" | "estimated" | "fallback";
      }>;
      fuelTypeBreakdown?: {
        gasolineVolume: number;
        gasolineCount: number;
        dieselVolume: number;
        dieselCount: number;
        gasolineRatio: number;
        dieselRatio: number;
        sampleDays: number;
        windowDays: number;
      };
    } | null;
  } | null>(null);

  const [loading, setLoading] = useState({
    competitors: true, changes: true, benchmark: true,
    detail: true, oilPrices: true, priceHistory: true, insights: true,
    salesAnalysis: true, timingAnalysis: true, forecastReview: true,
    correlationMatrix: true, weather: true, weatherImpact: true, carwash: true, crossInsights: true,
    integratedForecast: true, selfDiagnosis: true,
  });

  const [dataIntegrityWarnings, setDataIntegrityWarnings] = useState<Array<{
    type: string; date: string; message: string; recoverable: boolean;
  }>>([]);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const fetchAllData = (bustCache = false) => {
    const base = `/api/stations/${STATION_ID}`;
    const cb = bustCache ? `?t=${Date.now()}` : "";

    setLoading({
      competitors: true, changes: true, benchmark: true,
      detail: true, oilPrices: true, priceHistory: true, insights: true,
      salesAnalysis: true, timingAnalysis: true, forecastReview: true,
      correlationMatrix: true, weather: true, weatherImpact: true, carwash: true, crossInsights: true,
      integratedForecast: true, selfDiagnosis: true,
    });

    // ── 빠른 개별 API (가격, 경쟁사 등 — 카드별 독립 로딩) ──
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
      .then((d) => { if (!d.error) setWeather(d); setLoading((p) => ({ ...p, weather: false })); })
      .catch(() => setLoading((p) => ({ ...p, weather: false })));

    fetch(`/api/price-history/${STATION_ID}`)
      .then((r) => r.json())
      .then((d) => { setPriceHistory(d); setLoading((p) => ({ ...p, priceHistory: false })); });

    // ── 복기의 복기 (자기진단) ── snapshot 과 분리된 독립 fetch
    fetch(`${base}/self-diagnosis`)
      .then((r) => r.json())
      .then((d: SelfDiagnosisResult) => { setSelfDiagnosis(d); setLoading((p) => ({ ...p, selfDiagnosis: false })); })
      .catch(() => setLoading((p) => ({ ...p, selfDiagnosis: false })));

    // ── Phase 1 Shadow Mode (자동 보정 실험) ── 별도 fetch, 실패는 graceful (null 유지)
    fetch(`${base}/correction-shadow${cb}`)
      .then((r) => r.json())
      .then((d: ShadowEvaluationResult) => setCorrectionShadow(d))
      .catch(() => {});

    // ── 스냅샷 기반 로딩 (1 쿼리로 전체 분석 데이터 로드) ──
    fetch(`/api/snapshot/${STATION_ID}`)
      .then((r) => {
        if (!r.ok) throw new Error("NO_SNAPSHOT");
        return r.json();
      })
      .then((data) => {
        if (data._snapshot?.updatedAt) setSnapshotUpdatedAt(data._snapshot.updatedAt);

        if (data.insights) setInsights(data.insights);
        setLoading((p) => ({ ...p, insights: false }));

        if (data.salesAnalysis && !data.salesAnalysis.error) setSalesAnalysis(data.salesAnalysis);
        setLoading((p) => ({ ...p, salesAnalysis: false }));

        if (data.weatherSales && !data.weatherSales.error) setWeatherImpact(data.weatherSales);
        setLoading((p) => ({ ...p, weatherImpact: false }));

        if (data.forecast && !data.forecast.error) setForecastReview(data.forecast);
        setLoading((p) => ({ ...p, forecastReview: false }));

        if (data.carwash && !data.carwash.error) setCarwashSummary(data.carwash);
        setLoading((p) => ({ ...p, carwash: false }));

        if (data.correlation && !data.correlation.error) setCorrelationMatrix(data.correlation);
        setLoading((p) => ({ ...p, correlationMatrix: false }));

        if (data.timing && data.timing.currentSituation) setTimingAnalysis(data.timing);
        setLoading((p) => ({ ...p, timingAnalysis: false }));

        if (data.crossInsights && !data.crossInsights.error) setCrossInsights(data.crossInsights);
        setLoading((p) => ({ ...p, crossInsights: false }));

        if (data.integratedForecast && !data.integratedForecast.error) setIntegratedForecast(data.integratedForecast);
        setLoading((p) => ({ ...p, integratedForecast: false }));

        if (Array.isArray(data.dataIntegrityWarnings)) setDataIntegrityWarnings(data.dataIntegrityWarnings);

        // ── 스냅샷 스키마 갱신 감지: 필수 필드 누락 시 자동 리빌드 ──
        const REQUIRED_KEYS = ["integratedForecast"] as const;
        const missing = REQUIRED_KEYS.filter((k) => !(k in data) || data[k] == null);
        if (missing.length > 0) {
          console.log(`[snapshot] 누락 필드 감지 (${missing.join(",")}), 리빌드 트리거`);
          // 누락된 데이터만 실시간 fetch
          fetch(`${base}/dashboard-all?tier=essential${cb ? "&" + cb.slice(1) : ""}`)
            .then((r) => r.json())
            .then((fresh) => {
              if (fresh.integratedForecast && !fresh.integratedForecast.error) {
                setIntegratedForecast(fresh.integratedForecast);
              }
              setLoading((p) => ({ ...p, integratedForecast: false }));
            })
            .catch(() => setLoading((p) => ({ ...p, integratedForecast: false })));
          // 백그라운드 리빌드 (다음 로드부터 스냅샷에 포함)
          fetch("/api/snapshot/rebuild", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stationId: STATION_ID }),
          }).catch(() => {});
        }
      })
      .catch(() => {
        // 스냅샷 없음 → fallback: dashboard-all 실시간 호출 + 스냅샷 자동 생성
        fetch(`${base}/dashboard-all?tier=all${cb ? "&" + cb.slice(1) : ""}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.insights) setInsights(data.insights);
            setLoading((p) => ({ ...p, insights: false }));
            if (data.salesAnalysis && !data.salesAnalysis.error) setSalesAnalysis(data.salesAnalysis);
            setLoading((p) => ({ ...p, salesAnalysis: false }));
            if (data.weatherSales && !data.weatherSales.error) setWeatherImpact(data.weatherSales);
            setLoading((p) => ({ ...p, weatherImpact: false }));
            if (data.forecast && !data.forecast.error) setForecastReview(data.forecast);
            setLoading((p) => ({ ...p, forecastReview: false }));
            if (data.carwash && !data.carwash.error) setCarwashSummary(data.carwash);
            setLoading((p) => ({ ...p, carwash: false }));
            if (data.correlation && !data.correlation.error) setCorrelationMatrix(data.correlation);
            setLoading((p) => ({ ...p, correlationMatrix: false }));
            if (data.timing && data.timing.currentSituation) setTimingAnalysis(data.timing);
            setLoading((p) => ({ ...p, timingAnalysis: false }));
            if (data.crossInsights && !data.crossInsights.error) setCrossInsights(data.crossInsights);
            setLoading((p) => ({ ...p, crossInsights: false }));
            if (data.integratedForecast && !data.integratedForecast.error) setIntegratedForecast(data.integratedForecast);
            setLoading((p) => ({ ...p, integratedForecast: false }));
            if (Array.isArray(data.dataIntegrityWarnings)) setDataIntegrityWarnings(data.dataIntegrityWarnings);
          })
          .catch(() => {
            setLoading((p) => ({
              ...p, insights: false, salesAnalysis: false, weatherImpact: false,
              forecastReview: false, carwash: false, correlationMatrix: false,
              timingAnalysis: false, crossInsights: false, integratedForecast: false,
            }));
          });
        // 백그라운드에서 스냅샷 생성 (다음 로드부터 빠르게)
        fetch("/api/snapshot/rebuild", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationId: STATION_ID }),
        }).catch(() => {});
      });
  };

  const handleSyncAndRefresh = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync-sales", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSyncResult({ ok: true, message: "동기화 완료, 스냅샷 갱신 중..." });
        // 스냅샷 재생성 후 데이터 리로드
        setRebuilding(true);
        try {
          await fetch("/api/snapshot/rebuild", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stationId: STATION_ID }),
          });
          setSyncResult({ ok: true, message: "스냅샷 갱신 완료" });
        } catch {
          setSyncResult({ ok: true, message: "동기화 완료 (스냅샷 갱신 실패)" });
        }
        setRebuilding(false);
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
              {syncing ? (rebuilding ? "스냅샷 갱신 중..." : "동기화 중...") : "데이터 새로고침"}
            </button>
            {syncResult && (
              <span className={`text-[12px] font-medium ${syncResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {syncResult.message}
              </span>
            )}
            {!syncResult && snapshotUpdatedAt && (() => {
              const mins = Math.round((Date.now() - new Date(snapshotUpdatedAt).getTime()) / 60000);
              const label = mins < 1 ? "방금 갱신" : mins < 60 ? `${mins}분 전 갱신` : mins < 1440 ? `${Math.round(mins / 60)}시간 전 갱신` : `${Math.round(mins / 1440)}일 전 갱신`;
              return <span className="text-[11px] text-white/40">{label}</span>;
            })()}
          </div>
          {!loading.detail && detail?.newAddress && (
            <p className="text-[13px] text-white/60 m-0 mt-1.5 flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {detail.newAddress}
            </p>
          )}
        </div>

        {/* 데이터 정합성 배지 — 이상 시에만 표시 */}
        {dataIntegrityWarnings.length > 0 && (() => {
          const isMulti = dataIntegrityWarnings.length >= 2;
          const hasCritical = dataIntegrityWarnings.some((w) => !w.recoverable);
          const icon = isMulti || hasCritical ? "⚠️" : "ℹ️";
          const borderColor = isMulti || hasCritical ? "border-amber-500/40" : "border-blue-500/30";
          const bgColor = isMulti || hasCritical ? "bg-amber-500/5" : "bg-blue-500/5";
          const textColor = isMulti || hasCritical ? "text-amber-400" : "text-blue-400";

          return (
            <div className={`mb-4 rounded-lg px-4 py-3 border ${borderColor} ${bgColor} flex items-start gap-2.5`}>
              <span className="text-[16px] shrink-0 mt-0.5">{icon}</span>
              <div className="flex-1 min-w-0">
                <span className={`text-[12px] font-bold ${textColor} tracking-wider uppercase`}>데이터 점검</span>
                <div className="mt-1 space-y-0.5">
                  {dataIntegrityWarnings.map((w, i) => (
                    <p key={i} className="text-[13px] text-text-secondary m-0">
                      {w.message}
                      {w.recoverable && (
                        <span className="text-text-tertiary"> · 새로고침 버튼을 누르면 해소됩니다</span>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

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
              // 판매 영향 (통합 모델 우선)
              const forecastDiff = integratedForecast?.forecast?.diffVsDryPct ?? weatherImpact?.todayForecast?.diffVsDryPct;
              if (forecastDiff != null && Math.abs(forecastDiff) >= 2) {
                tags.push({ label: `수요 ${forecastDiff > 0 ? "+" : ""}${forecastDiff}%`, color: forecastDiff < 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700" });
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
              const expectedVol = integratedForecast?.forecast?.expectedVolume ?? weatherImpact?.todayForecast?.expectedVolume;

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
            {aiBriefing?.aiBriefing && !aiBriefing.fallback ? (() => {
              const warnings = aiBriefing.validation?.warnings ?? [];
              const hasError = warnings.some((w) => w.severity === "error");
              const displayText = aiBriefing.aiBriefingOverridden ?? aiBriefing.aiBriefing;
              return (
                <div className="mt-3 rounded-lg bg-violet-50 border border-violet-100 px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded">AI</span>
                      <span className="text-[11px] font-bold text-violet-700">심층 분석</span>
                    </div>
                    {warnings.length > 0 && (
                      <div
                        className={`group relative text-[10px] font-bold px-1.5 py-0.5 rounded cursor-help ${
                          hasError
                            ? "bg-red-500 text-white"
                            : "bg-amber-400 text-amber-950"
                        }`}
                        title={warnings.map((w) => `[${w.rule}] ${w.detail}`).join("\n")}
                      >
                        {hasError
                          ? `🚫 검증자: ${warnings.filter((w) => w.severity === "error").length}건 차단`
                          : `⚠️ 검증자: ${warnings.length}건 경고`}
                        <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-10 w-72 rounded-lg border border-border bg-surface-raised p-2 text-left text-[11px] text-text-primary shadow-lg">
                          {warnings.map((w, i) => (
                            <div key={i} className="mb-1 last:mb-0">
                              <span className={`inline-block px-1 mr-1 rounded text-[9px] font-bold ${w.severity === "error" ? "bg-red-500 text-white" : "bg-amber-400 text-amber-950"}`}>
                                {w.rule}
                              </span>
                              <span className="text-text-secondary">L{w.line}</span>
                              <div className="text-text-primary mt-0.5">{w.detail}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {warnings.length === 0 && (
                      <span
                        className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded"
                        title="3-Guard 통과: 구조/방향/범위/타이밍/경쟁사명/숫자 모두 OK"
                      >
                        ✓ 검증 통과
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-violet-900 leading-relaxed whitespace-pre-line">
                    {displayText}
                  </div>
                </div>
              );
            })() : aiLoading ? (
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
                className="text-[14px] font-semibold text-blue-600 flex items-center gap-0.5 shrink-0 cursor-pointer hover:text-blue-800 transition-colors"
              >
                상세
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
              </span>
            </div>
          </div>
        )}

        {/* 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-text-primary">

          <SectionDivider title="오늘의 판단" description="예측 · 시뮬레이션 · 복기" />

          {/* 🌧️ 통합 판매량 예측 (날씨 + 가격 + 경쟁사) */}
          {/* 두 데이터 소스(weatherImpact, integratedForecast)에 의존하므로
              둘 중 하나라도 로딩 중이면 스켈레톤. && → || (week3 P0 fix). */}
          {(loading.weatherImpact || loading.integratedForecast) ? <CardSkeleton /> : (() => {
            const ig = integratedForecast?.forecast;
            const f = weatherImpact?.todayForecast;
            // 방어: 스켈레톤 분기를 빠져나왔는데도 데이터가 없으면 null 대신 스켈레톤 반환
            // (카드 슬롯이 화면에서 사라지지 않게)
            if (!ig && !f) return <CardSkeleton />;

            // 통합 모델 우선, fallback → 날씨 모델
            const vol = ig?.expectedVolume ?? f?.expectedVolume ?? 0;
            const cnt = ig?.expectedCount ?? (f as Record<string, unknown>)?.expectedCount as number | undefined;
            const conf = ig?.confidence ?? f?.confidence ?? "low";
            const expl = ig?.explanation ?? f?.explanation ?? "";
            const diff = ig?.diffVsDryPct ?? f?.diffVsDryPct ?? 0;
            const confColor = conf === "high" ? "emerald" : conf === "medium" ? "amber" : "slate";
            const isIntegrated = !!ig;
            const rainy = weatherImpact?.byIntensity?.find((b) => b.key === "heavy");
            const activeContribs = ig?.contributions.filter((c) => Math.abs(c.value) >= 10) ?? [];

            return (
              <ClickableCard href="/dashboard/weather-impact" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">
                      {isIntegrated ? "통합 판매 예측" : "날씨 영향 · 판매량"}
                    </div>
                    {isIntegrated && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">
                        v1 · {ig!.totalDataDays}일
                      </span>
                    )}
                  </div>
                  <span className="text-[12px] text-text-tertiary">오늘 예측</span>
                </div>
                {ig?.fuelTypeBreakdown &&
                 ig.fuelTypeBreakdown.gasolineVolume >= 0 &&
                 ig.fuelTypeBreakdown.dieselVolume >= 0 ? (
                  // 유종 분리 표시
                  <div className="mb-2 space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[12px] text-text-secondary">휘발유</span>
                      <div className="flex items-baseline gap-2 tnum">
                        <span className="text-[16px] font-semibold text-text-primary">
                          {ig.fuelTypeBreakdown.gasolineVolume.toLocaleString()}L
                        </span>
                        <span className="text-[12px] text-text-tertiary">{ig.fuelTypeBreakdown.gasolineCount.toLocaleString()}대</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[12px] text-text-secondary">경유</span>
                      <div className="flex items-baseline gap-2 tnum">
                        <span className="text-[16px] font-semibold text-text-primary">
                          {ig.fuelTypeBreakdown.dieselVolume.toLocaleString()}L
                        </span>
                        <span className="text-[12px] text-text-tertiary">{ig.fuelTypeBreakdown.dieselCount.toLocaleString()}대</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-baseline border-t border-border pt-1.5 mt-1">
                      <span className="text-[12px] text-text-tertiary">합계</span>
                      <div className="flex items-baseline gap-2 tnum">
                        <span className="text-[22px] font-extrabold text-text-primary tracking-tight">
                          {vol.toLocaleString()}L
                        </span>
                        {cnt != null && (
                          <span className="text-[14px] text-text-secondary">{cnt.toLocaleString()}대</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  // 기존 통합 표시 (breakdown 없음 — 구형 snapshot / 샘플 부족)
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-[28px] font-extrabold text-text-primary tnum tracking-tight leading-none">
                      {vol.toLocaleString()}
                    </span>
                    <span className="text-[14px] text-text-secondary">L 예상</span>
                    {cnt != null && (
                      <>
                        <span className="text-[28px] font-extrabold text-text-primary tnum tracking-tight leading-none ml-3">{cnt.toLocaleString()}</span>
                        <span className="text-[14px] text-text-secondary">대</span>
                      </>
                    )}
                  </div>
                )}
                <div className="text-[12px] text-text-tertiary mb-3">{expl}</div>

                {/* 통합 모델: 변수 분해 */}
                {isIntegrated && activeContribs.length > 0 && (
                  <div className="border-t border-border pt-3 mb-3 space-y-1.5">
                    <div className="text-[11px] font-bold text-text-tertiary">변수별 기여</div>
                    {activeContribs.map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-[12px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-text-secondary">{c.label}</span>
                          {!c.reliable && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-600">⚠️ {c.badge}</span>
                          )}
                        </div>
                        <span className={`font-bold tnum ${c.value > 0 ? "text-emerald-600" : c.value < 0 ? "text-red-500" : "text-text-tertiary"}`}>
                          {c.value > 0 ? "+" : ""}{c.value.toLocaleString()}L ({c.pct > 0 ? "+" : ""}{c.pct}%)
                        </span>
                      </div>
                    ))}
                    {ig!.weatherOnly !== ig!.expectedVolume && (
                      <div className="text-[10px] text-text-tertiary mt-1">
                        날씨-only: {ig!.weatherOnly.toLocaleString()}L · 차이 {ig!.expectedVolume - ig!.weatherOnly > 0 ? "+" : ""}{(ig!.expectedVolume - ig!.weatherOnly).toLocaleString()}L
                      </div>
                    )}
                  </div>
                )}

                {/* fallback: 비 영향 (날씨-only 모델) */}
                {!isIntegrated && rainy && weatherImpact?.tTest && (
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
                  {diff <= -5 ? "수요 감소 예상 → 가격 변동 보류 권장. 인하 시 회복 어려움"
                    : diff >= 5 ? "수요 증가 예상 → 소폭 인상 기회. 경쟁사 대비 가격 여력 확인"
                    : diff <= -2 ? "소폭 수요 감소 예상 → 가격 유지하며 관망 권장"
                    : "날씨 영향 미미 → 시장 상황 중심으로 판단"}
                  <span className="text-text-tertiary ml-1">(신뢰도 {conf === "high" ? "높음" : conf === "medium" ? "중간" : "낮음"})</span>
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
                    {(() => {
                      // graceful fallback: fuelTypeBreakdown 존재 + 8개 대칭 음수 가드
                      // (forecast-review.ts 에서 이미 검사하지만 구형 snapshot + 신형 FE 방어선)
                      const ftb = y.fuelTypeBreakdown;
                      const showBreakdown = !!ftb &&
                        ftb.gasoline.predictedVolume >= 0 && ftb.diesel.predictedVolume >= 0 &&
                        ftb.gasoline.predictedCount >= 0 && ftb.diesel.predictedCount >= 0 &&
                        ftb.gasoline.actualVolume >= 0 && ftb.diesel.actualVolume >= 0 &&
                        ftb.gasoline.actualCount >= 0 && ftb.diesel.actualCount >= 0;

                      const pctColor = (p: number | null) =>
                        p == null ? "text-text-tertiary"
                        : Math.abs(p) <= 5 ? "text-emerald-600"
                        : Math.abs(p) <= 15 ? "text-amber-500" : "text-red-500";
                      const pctLabel = (p: number | null) =>
                        p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`;

                      if (!showBreakdown) {
                        // 기존 통합 2줄 렌더 (구형 snapshot / 샘플 부족 / unavailable)
                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="text-[12px] text-text-secondary">
                                예측 <span className="font-bold text-text-primary">{y.predicted.toLocaleString()}L</span>
                                <span className="mx-1.5">→</span>
                                실제 <span className="font-bold text-text-primary">{y.actual != null ? `${y.actual.toLocaleString()}L` : "대기 중"}</span>
                              </div>
                              {y.errorPct != null && (
                                <span className={`text-[14px] font-bold ${pctColor(y.errorPct)}`}>
                                  {pctLabel(y.errorPct)}
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
                                  <span className={`text-[14px] font-bold ${pctColor(y.countErrorPct)}`}>
                                    {pctLabel(y.countErrorPct)}
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        );
                      }

                      // 유종 분리 렌더: 휘발유 2줄 + 경유 2줄 + 합계 2줄
                      const g = ftb!.gasoline;
                      const d = ftb!.diesel;
                      const row = (
                        label: string,
                        pred: number,
                        act: number,
                        err: number | null,
                        unit: "L" | "대",
                        isTotal = false,
                      ) => (
                        <div className={`flex items-center justify-between ${isTotal ? "" : ""}`}>
                          <div className={`${isTotal ? "text-[13px]" : "text-[13px]"} text-text-secondary`}>
                            <span className={`inline-block w-[44px] ${isTotal ? "text-text-primary font-bold" : "text-text-tertiary"}`}>{label}</span>
                            예측 <span className={`${isTotal ? "font-bold text-[15px]" : "font-semibold text-[13px]"} text-text-primary tnum`}>{pred.toLocaleString()}{unit}</span>
                            <span className="mx-1.5">→</span>
                            실제 <span className={`${isTotal ? "font-bold text-[15px]" : "font-semibold text-[13px]"} text-text-primary tnum`}>{act.toLocaleString()}{unit}</span>
                          </div>
                          {err != null && (
                            <span className={`${isTotal ? "text-[14px]" : "text-[12px]"} font-bold ${pctColor(err)}`}>
                              {pctLabel(err)}
                            </span>
                          )}
                        </div>
                      );

                      // 합계 표시는 기존 통합값 사용 (실측 소수점 차이 방지):
                      //  - 합계 vol: y.actual (DB 원본 합), y.predicted (forecast_history 통합 예측값)
                      //  - 합계 cnt: y.actualCount, y.predictedCount
                      const totalActVol = y.actual ?? (g.actualVolume + d.actualVolume);
                      const totalPredVol = y.predicted;
                      const totalActCnt = y.actualCount ?? (g.actualCount + d.actualCount);
                      const totalPredCnt = y.predictedCount ?? (g.predictedCount + d.predictedCount);

                      return (
                        <div className="space-y-1.5">
                          {row("휘발유", g.predictedVolume, g.actualVolume, g.volumeErrorPct, "L")}
                          {row("휘발유", g.predictedCount, g.actualCount, g.countErrorPct, "대")}
                          {row("경유", d.predictedVolume, d.actualVolume, d.volumeErrorPct, "L")}
                          {row("경유", d.predictedCount, d.actualCount, d.countErrorPct, "대")}
                          <div className="border-t border-border pt-1.5 space-y-1">
                            {row("합계", Math.round(totalPredVol), Math.round(totalActVol), y.errorPct, "L", true)}
                            {row("합계", Math.round(totalPredCnt), Math.round(totalActCnt), y.countErrorPct, "대", true)}
                          </div>
                        </div>
                      );
                    })()}
                    {y.carwashCount != null && (
                      <div className="flex items-center justify-between">
                        <div className="text-[12px] text-text-secondary">
                          🚿 세차 <span className="font-bold text-purple-500">{y.carwashCount.toLocaleString()}대</span>
                        </div>
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
                              {c.tooltipHint && (
                                <span
                                  className="ml-1 text-[10px] text-text-tertiary cursor-help"
                                  title={c.tooltipHint}
                                  aria-label={c.tooltipHint}
                                >ⓘ</span>
                              )}
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
                    {(() => {
                      const bc = forecastReview.baselineComparison?.days30;
                      if (!bc || !bc.model) return null;
                      const imp = bc.improvementOverBestBaselinePct;
                      const impColor =
                        imp == null
                          ? "text-text-tertiary"
                          : imp > 0
                            ? "text-emerald-500"
                            : imp < 0
                              ? "text-red-500"
                              : "text-text-tertiary";
                      const fmt = (e: BaselineEntry) =>
                        e ? `±${e.avgErrorPct}%` : "측정 불가";
                      return (
                        <div className="pt-2 border-t border-border">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold text-text-tertiary">
                              지난 {bc.commonSampleCount}일 오차율 비교 (30일 윈도우)
                            </span>
                            {imp != null && (
                              <span className={`text-[11px] font-bold font-mono ${impColor}`}>
                                {imp >= 0 ? "+" : ""}
                                {imp}%p
                              </span>
                            )}
                          </div>
                          <div className="space-y-0.5 font-mono text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="text-text-secondary">우리 모델</span>
                              <span className="font-bold text-text-primary">{fmt(bc.model)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-text-tertiary">요일 평균</span>
                              <span className="text-text-secondary">{fmt(bc.dowMean)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-text-tertiary">7일 이동평균</span>
                              <span className="text-text-secondary">{fmt(bc.sevenDayMA)}</span>
                            </div>
                          </div>
                          {bc.droppedCount > 0 && (
                            <div className="text-[10px] text-text-tertiary mt-1">
                              * 베이스라인 데이터 부족으로 {bc.droppedCount}일 비교 제외
                            </div>
                          )}
                          {imp != null && imp < 0 && (
                            <div className="text-[10px] text-red-400 mt-1">
                              * 현재 베이스라인이 더 정확 — 모델 개선 필요
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <p className="text-[11px] text-text-primary mt-2 mb-0 text-center">⚠️ 추정치 기반 분석 — 데이터 축적 시 정확도 향상</p>
                  </div>
                ) : (
                  <p className="text-[14px] text-text-tertiary m-0">어제 예측 데이터 없음</p>
                )}
              </div>
            );
          })()}

          {/* 📊 복기의 복기 — 모델 자기진단 */}
          {loading.selfDiagnosis ? <CardSkeleton /> : selfDiagnosis && (() => {
            const sd = selfDiagnosis;
            const n = sd.sampleCount;
            const isNoData = sd.status === "no_data";
            const isInsufficient = sd.status === "insufficient";
            const isPartial = sd.status === "partial";
            const isReady = sd.status === "ready";

            // ── 진행 막대 계산 ──
            // no_data         : 분모 3, 회색 트랙만 (채움 없음)
            // insufficient    : 분모 3, amber
            // partial         : 분모 7, amber
            // ready           : 막대 자체 숨김
            //
            // 채움 너비 최소 보장: n ≥ 1 일 때 8% 하한선 (너무 얇아
            // 안 보이는 것 방지). n = 0 은 아예 채움을 렌더 안 함.
            let progressDenom = 0;
            let progressFilled = false;
            let progressWidthPct = 0;
            if (isNoData) {
              progressDenom = 3;
              progressFilled = false;
              progressWidthPct = 0;
            } else if (isInsufficient) {
              progressDenom = 3;
              progressFilled = n >= 1;
              progressWidthPct = Math.max(8, (n / 3) * 100);
            } else if (isPartial) {
              progressDenom = 7;
              progressFilled = true;
              progressWidthPct = Math.max(8, (n / 7) * 100);
            }

            return (
              <div className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">
                    📊 복기의 복기 · 자기진단
                  </div>
                  <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                    {n > 0 ? `최근 ${n}일 분석` : "데이터 대기"}
                  </span>
                </div>

                {/* N < 3 — 전체 플레이스홀더 (no_data / insufficient) */}
                {(isNoData || isInsufficient) && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-4 text-center">
                    <div className="text-[13px] text-text-secondary font-semibold mb-2">
                      {sd.message ?? `데이터 누적 중 (현재 N=${n}/3)`}
                    </div>
                    {/* 진행 막대 (no_data/insufficient) */}
                    <div className="flex items-center gap-2 max-w-[80%] mx-auto my-2">
                      <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-200">
                        {progressFilled && (
                          <div
                            className="h-full rounded-full bg-slate-400 transition-all duration-500"
                            style={{ width: `${progressWidthPct}%` }}
                          />
                        )}
                      </div>
                      <span className="text-[12px] font-mono text-text-tertiary tabular-nums shrink-0">
                        {n}/{progressDenom}
                      </span>
                    </div>
                    <div className="text-[12px] text-text-tertiary">
                      예측·실측 데이터가 3일 이상 쌓이면 자기진단이 시작됩니다
                    </div>
                  </div>
                )}

                {/* N ≥ 3 — 섹션 B 작동 (Bias), 섹션 A 는 partial 에서 진행 막대 */}
                {(isPartial || isReady) && sd.bias && (
                  <div className="space-y-3">
                    {/* ── 섹션 A: 패턴 발견 (노랑/amber) ── */}
                    {isPartial && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3">
                        <div className="text-[12px] font-bold text-amber-700 uppercase tracking-wide mb-2">
                          🔍 패턴 발견
                        </div>
                        <div className="text-[12px] text-amber-900 font-semibold mb-2">
                          패턴 분석 중
                        </div>
                        {/* 진행 막대 (partial) */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-2 rounded-full overflow-hidden bg-amber-200">
                            <div
                              className="h-full rounded-full bg-amber-500 transition-all duration-500"
                              style={{ width: `${progressWidthPct}%` }}
                            />
                          </div>
                          <span className="text-[12px] font-mono text-amber-700 tabular-nums shrink-0">
                            {n}/{progressDenom}
                          </span>
                        </div>
                        <div className="text-[11px] text-amber-700">
                          N≥7이 되면 요일·날씨·방향 패턴이 자동으로 활성화됩니다
                        </div>
                      </div>
                    )}

                    {isReady && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3">
                        <div className="text-[12px] font-bold text-amber-700 uppercase tracking-wide mb-2">
                          🔍 패턴 발견
                        </div>
                        {sd.patterns.length === 0 ? (
                          <div className="text-[12px] text-amber-900">
                            유의미한 반복 패턴 발견 안 됨
                            <div className="text-[11px] text-amber-700 mt-0.5">
                              (그룹당 ≥3회 AND 전체 평균의 ≥1.5배 AND +3%p 이상 조건 미충족)
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {sd.patterns.map((p, i) => (
                              <div key={i} className="text-[12px]">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-amber-900">{p.label}</span>
                                  <span className="font-mono text-[12px] text-amber-700">
                                    {p.frequencyText}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className="text-[12px] text-amber-800">
                                    평균 오차 <span className="font-bold">{p.avgAbsErrorPct}%</span>
                                    <span className="text-amber-600 ml-1">
                                      (전체 {p.overallAvgAbsErrorPct}%)
                                    </span>
                                  </span>
                                </div>
                                <div className="text-[12px] text-amber-700 italic mt-0.5">
                                  {p.interpretation}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── 섹션 B: Bias 분석 (청록/teal) ── */}
                    <div className="rounded-lg bg-teal-50 border border-teal-200 px-3 py-3">
                      <div className="text-[12px] font-bold text-teal-700 uppercase tracking-wide mb-2">
                        ⚖️ Bias 분석
                      </div>
                      <div className="text-[12px] text-teal-900 font-semibold">
                        {sd.bias.diagnosis}
                      </div>

                      {sd.bias.correction && (
                        <div className="mt-2 pt-2 border-t border-teal-200 space-y-1">
                          {sd.bias.correction.tooSmall ? (
                            <>
                              <div className="text-[12px] text-teal-800 font-semibold">
                                {sd.bias.correction.rangeText}
                              </div>
                              <div className="text-[11px] text-teal-700 italic">
                                {sd.bias.correction.interpretation}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between text-[12px] text-teal-800">
                                <span>현재 평균 오차율</span>
                                <span className="font-mono font-bold">
                                  {sd.bias.correction.beforeAvgAbsErrorPct}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[12px] text-teal-800">
                                <span>보정 후 (in-sample 추정)</span>
                                <span className="font-mono font-bold text-emerald-700">
                                  ~{sd.bias.correction.afterAvgAbsErrorPct}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[12px] text-teal-900 font-semibold">
                                <span>개선 여지</span>
                                <span className="font-mono">{sd.bias.correction.rangeText}</span>
                              </div>
                              <div className="text-[11px] text-teal-700 italic mt-1">
                                {sd.bias.correction.interpretation}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      <div className="mt-2 pt-2 border-t border-teal-200 text-[11px] text-teal-600 font-mono">
                        * 샘플 {sd.bias.sampleCount}개 · 잔차 평균 {sd.bias.meanResidualL >= 0 ? "+" : ""}
                        {sd.bias.meanResidualL.toLocaleString()}L · 표준편차 ±
                        {sd.bias.stdResidualL.toLocaleString()}L
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 🤖 자동 보정 실험 (3번째 섹션, accordion) ──
                    복기의 복기 카드 안으로 통합. 패턴/편향 분석 아래에 위치하며
                    상단 구분선으로 시각적 분리. 기본 펼침. */}
                {correctionShadow && (() => {
                  const cs = correctionShadow;
                  const verdict = cs.goNoGo.verdict;
                  const N_TARGET = 30;

                  const styleByVerdict = {
                    insufficient: {
                      badge: "🌑 데이터 축적 중",
                      badgeBg: "bg-slate-100 border-slate-300 text-slate-700",
                      accent: "border-slate-200 bg-slate-50",
                      accentText: "text-slate-700",
                    },
                    inconclusive: {
                      badge: "🟡 관찰 중 · 판정 대기",
                      badgeBg: "bg-amber-100 border-amber-300 text-amber-800",
                      accent: "border-amber-200 bg-amber-50",
                      accentText: "text-amber-800",
                    },
                    go: {
                      badge: "🟢 효과 확인됨",
                      badgeBg: "bg-emerald-100 border-emerald-300 text-emerald-800",
                      accent: "border-emerald-200 bg-emerald-50",
                      accentText: "text-emerald-800",
                    },
                    no_go: {
                      badge: "🔴 효과 없음",
                      badgeBg: "bg-rose-100 border-rose-300 text-rose-800",
                      accent: "border-rose-200 bg-rose-50",
                      accentText: "text-rose-800",
                    },
                  } as const;
                  const style = styleByVerdict[verdict];

                  const sampleN = cs.evaluated?.sampleN ?? 0;
                  const obsDays = cs.observationDays;
                  const meanDiffL = cs.policy.meanResidualL;

                  return (
                    <div className="mt-4 pt-4 border-t border-border">
                      {/* 헤더 — 클릭하면 펼침/접힘 */}
                      <button
                        type="button"
                        onClick={() => setShadowOpen((v) => !v)}
                        className="w-full flex items-center justify-between gap-3 text-left"
                        aria-expanded={shadowOpen}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">
                            🤖 자동 보정 실험
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${style.badgeBg}`}>
                            {style.badge}
                          </span>
                        </div>
                        <span className="text-[14px] text-text-tertiary tabular-nums shrink-0">
                          {shadowOpen ? "▼" : "▶"}
                        </span>
                      </button>

                      {/* verdict 변화 알림 배너 (7일간 표시, 닫기 가능) */}
                      {(() => {
                        if (!verdictNotice || verdictNotice.dismissed) return null;
                        if (verdictNotice.verdict === "insufficient") return null;
                        const daysSince =
                          (Date.now() - new Date(verdictNotice.changedAt).getTime()) / 86400000;
                        if (daysSince > NOTICE_WINDOW_DAYS) return null;

                        const bannerStyle = {
                          go: {
                            bg: "bg-emerald-500",
                            msg: "🎉 자동 보정 효과 확인됨! Phase 2 진입을 검토하세요.",
                          },
                          no_go: {
                            bg: "bg-rose-500",
                            msg: "⚠️ 자동 보정 효과 없음. 재설계가 필요합니다.",
                          },
                          inconclusive: {
                            bg: "bg-amber-500",
                            msg: "🔍 판정이 애매합니다. 2주 더 관찰을 권장합니다.",
                          },
                        }[verdictNotice.verdict as "go" | "no_go" | "inconclusive"];

                        return (
                          <div
                            className={`mt-3 rounded-lg px-3 py-2.5 flex items-center gap-2 shadow-sm text-white ${bannerStyle.bg}`}
                            role="status"
                          >
                            <span className="text-[13px] font-bold leading-snug flex-1">
                              {bannerStyle.msg}
                            </span>
                            <button
                              type="button"
                              onClick={dismissVerdictNotice}
                              className="text-white/80 hover:text-white text-[18px] leading-none shrink-0 px-1"
                              aria-label="알림 닫기"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })()}

                      {shadowOpen && (
                        <div className="mt-3 space-y-3">
                          {/* 한 줄 설명 — 비전공자 대상 */}
                          <div className="text-[12px] text-text-secondary leading-relaxed">
                            <span className="font-bold text-text-primary">스스로 오차를 발견하고, 자동으로 학습해 매일 더 정확해집니다.</span>
                            {" "}사장님이 따로 할 일은 없습니다.
                          </div>

                          {/* 진행 상태 박스 */}
                          <div className={`rounded-lg border px-3 py-3 ${style.accent}`}>
                            {/* ── insufficient — 데이터 축적 중 ── */}
                            {verdict === "insufficient" && (
                              <>
                                <div className={`text-[12px] font-bold ${style.accentText} mb-2`}>
                                  데이터 축적 중 (관찰 {obsDays}일째)
                                </div>
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-200">
                                    <div
                                      className="h-full rounded-full bg-slate-500 transition-all duration-500"
                                      style={{
                                        width: `${Math.min(100, Math.max(4, (sampleN / N_TARGET) * 100))}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-[12px] font-mono text-slate-700 tabular-nums shrink-0">
                                    {sampleN}/{N_TARGET}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-600 leading-relaxed">
                                  평가 가능한 샘플이 {N_TARGET}개 모이면 자동으로 효과 판정을 시작합니다.
                                  {meanDiffL != null && (
                                    <span className="block mt-1">
                                      현재 계산된 평균 차이:{" "}
                                      <span className="font-mono font-bold text-slate-800">
                                        {meanDiffL >= 0 ? "+" : ""}{meanDiffL.toLocaleString()}L
                                      </span>
                                      {" "}(예측값에 적용 안 됨)
                                    </span>
                                  )}
                                </div>
                              </>
                            )}

                            {/* ── inconclusive — 관찰 중, 판정 대기 ── */}
                            {verdict === "inconclusive" && cs.evaluated && (
                              <>
                                <div className={`text-[12px] font-bold ${style.accentText} mb-2`}>
                                  관찰 중 · 판정 대기 (관찰 {obsDays}일째 · 샘플 {sampleN}개)
                                </div>
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[12px] text-amber-900">
                                    <span>현재 평균 오차</span>
                                    <span className="font-mono font-bold">{cs.evaluated.beforeMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-amber-900">
                                    <span>가상 보정 후 오차</span>
                                    <span className="font-mono font-bold">{cs.evaluated.afterMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-amber-900 font-semibold pt-1 border-t border-amber-200">
                                    <span>차이</span>
                                    <span className="font-mono">
                                      {cs.evaluated.improvementPp >= 0 ? "−" : "+"}
                                      {Math.abs(cs.evaluated.improvementPp)}%p
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-amber-700 italic mt-1">
                                    개선됐던 날 {cs.evaluated.betterDays}일 · 비슷했던 날 {cs.evaluated.sameDays}일 · 오히려 나빴던 날 {cs.evaluated.worseDays}일
                                  </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-amber-200 text-[11px] text-amber-700 leading-relaxed">
                                  {cs.goNoGo.reasons.join(" · ")}
                                </div>
                              </>
                            )}

                            {/* ── go — 효과 확인됨 ── */}
                            {verdict === "go" && cs.evaluated && (
                              <>
                                <div className={`text-[12px] font-bold ${style.accentText} mb-2`}>
                                  효과 확인됨 — Phase 2 진입 권장
                                </div>
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[12px] text-emerald-900">
                                    <span>현재 평균 오차</span>
                                    <span className="font-mono font-bold">{cs.evaluated.beforeMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-emerald-900">
                                    <span>가상 보정 후 오차</span>
                                    <span className="font-mono font-bold text-emerald-700">{cs.evaluated.afterMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-emerald-900 font-semibold pt-1 border-t border-emerald-200">
                                    <span>개선폭</span>
                                    <span className="font-mono text-emerald-700">
                                      −{cs.evaluated.improvementPp}%p
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-emerald-700 italic mt-1">
                                    개선된 날 {cs.evaluated.betterDays}일 / 전체 {sampleN}일 · 악화일 비율 {(cs.evaluated.worseDaysRatio * 100).toFixed(0)}%
                                  </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-emerald-200 text-[11px] text-emerald-700 leading-relaxed">
                                  ✅ {cs.goNoGo.reasons.join(" · ")}
                                  <div className="mt-1 font-semibold text-emerald-800">
                                    → Phase 2 (실제 예측에 보정 적용) 진입을 검토하세요
                                  </div>
                                </div>
                              </>
                            )}

                            {/* ── no_go — 효과 없음 ── */}
                            {verdict === "no_go" && cs.evaluated && (
                              <>
                                <div className={`text-[12px] font-bold ${style.accentText} mb-2`}>
                                  효과 없음 — 보정 방식 재검토 필요
                                </div>
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[12px] text-rose-900">
                                    <span>현재 평균 오차</span>
                                    <span className="font-mono font-bold">{cs.evaluated.beforeMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-rose-900">
                                    <span>가상 보정 후 오차</span>
                                    <span className="font-mono font-bold text-rose-700">{cs.evaluated.afterMape}%</span>
                                  </div>
                                  <div className="flex items-center justify-between text-[12px] text-rose-900 font-semibold pt-1 border-t border-rose-200">
                                    <span>변화</span>
                                    <span className="font-mono">
                                      {cs.evaluated.improvementPp >= 0 ? "−" : "+"}
                                      {Math.abs(cs.evaluated.improvementPp)}%p
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-rose-700 italic mt-1">
                                    개선된 날 {cs.evaluated.betterDays}일 · 오히려 나빴던 날 {cs.evaluated.worseDays}일 (비율 {(cs.evaluated.worseDaysRatio * 100).toFixed(0)}%)
                                  </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-rose-200 text-[11px] text-rose-700 leading-relaxed">
                                  ❌ {cs.goNoGo.reasons.join(" · ")}
                                  <div className="mt-1 font-semibold text-rose-800">
                                    → 평균 차이 보정만으로는 부족. 요일·날씨별 세분화 보정 검토 필요
                                  </div>
                                </div>
                              </>
                            )}
                          </div>

                          {/* 타임라인 (있을 때만, 최근 7개) */}
                          {cs.evaluated && cs.evaluated.timeline.length > 0 && verdict !== "insufficient" && (
                            <div className="rounded-lg border border-border bg-surface px-3 py-3">
                              <div className="text-[11px] font-bold text-text-tertiary uppercase tracking-wide mb-2">
                                📈 최근 일별 효과
                              </div>
                              <div className="space-y-1">
                                {cs.evaluated.timeline.slice(-7).map((t) => {
                                  const improved = t.delta < -0.05;
                                  const worse = t.delta > 0.05;
                                  return (
                                    <div key={t.date} className="flex items-center justify-between text-[11px] font-mono">
                                      <span className="text-text-tertiary">{t.date.slice(5)}</span>
                                      <span className="text-text-secondary">
                                        {t.beforeAbsErrPct}% → <span className={improved ? "text-emerald-700 font-bold" : worse ? "text-rose-700 font-bold" : "text-text-secondary"}>{t.afterAbsErrPct}%</span>
                                      </span>
                                      <span className={`tabular-nums shrink-0 ${improved ? "text-emerald-600" : worse ? "text-rose-600" : "text-text-tertiary"}`}>
                                        {improved ? "▼" : worse ? "▲" : "─"} {Math.abs(t.delta).toFixed(2)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 하단 면책 문구 */}
                          <p className="text-[11px] text-text-tertiary text-center mb-0">
                            ⚠️ 이 실험은 예측값에 영향을 주지 않습니다 (Shadow Mode = 관찰 전용)
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>
            );
          })()}

          {/* ⑩ 가격 시뮬레이터 — 휘발유 / 경유 카드 분리 (B4-진짜독립)
              sales-analysis.ts 확장으로 유종별 독립 탄성도 계산. 각 카드는 해당
              유종의 이벤트 기반 탄성도만 사용. "추정" 차용 배지 제거. */}
          {!loading.competitors && competitors && competitors.competitors.length > 0 && (() => {
            const todayDow = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Seoul", weekday: "short" });
            const isWeekendNow = todayDow === "Sat" || todayDow === "Sun";
            const dowLabel = isWeekendNow ? "주말" : "주중";
            const weatherLabel = weatherImpact?.todayForecast
              ? (weatherImpact.todayForecast.intensity === "heavy" ? "비" : weatherImpact.todayForecast.intensity === "light" ? "약한 비" : "맑음")
              : null;
            const contextLabel = weatherLabel ? `${dowLabel} · ${weatherLabel}` : dowLabel;

            const renderCard = (fuelType: "gasoline" | "diesel") => {
              const isDiesel = fuelType === "diesel";
              const myPrice = isDiesel ? competitors.baseStation.diesel_price : competitors.baseStation.gasoline_price;
              if (!myPrice) return null;

              const compPrices = competitors.competitors
                .map((c) => (isDiesel ? c.diesel_price : c.gasoline_price))
                .filter((p): p is number => p != null && p > 0);
              const allPrices = [myPrice, ...compPrices].sort((a, b) => a - b);
              const currentRank = allPrices.indexOf(myPrice) + 1;

              // 유종별 독립 탄성도: salesAnalysis.events 를 fuel 로 필터
              // 없으면 (구형 snapshot) 전체 events 사용 → 기존 동작 보존 (graceful fallback)
              const fuelEvents = salesAnalysis
                ? salesAnalysis.events.filter((e) => (e.fuel ?? "gasoline") === fuelType)
                : [];

              let weightedElasticity: number | null = null;
              if (fuelEvents.length >= 2) {
                const validEvents = fuelEvents.filter((e) => e.priceChange !== 0);
                if (validEvents.length >= 2) {
                  let sumWeightedVol = 0, sumWeight = 0;
                  for (const e of validEvents) {
                    const weight = Math.abs(e.priceChange);
                    sumWeightedVol += e.volumeChangeRate * weight;
                    sumWeight += weight;
                  }
                  if (sumWeight > 0) weightedElasticity = sumWeightedVol / sumWeight;
                }
              }

              // 주중/주말 보정: 유종별 splitElasticityByFuel 우선, 없으면 기존 splitElasticity(휘발유)
              let dowElasticity = weightedElasticity;
              const byFuel = salesAnalysis?.splitElasticityByFuel?.[fuelType];
              const split = byFuel ? (isWeekendNow ? byFuel.weekend : byFuel.weekday) : null;
              if (split && split.avgVolumeChangeRate != null && split.count >= 2) {
                dowElasticity = split.avgVolumeChangeRate;
              } else if (!isDiesel && salesAnalysis?.splitElasticity) {
                // 구형 snapshot + 휘발유 경로만 기존 splitElasticity 사용
                const legacySplit = isWeekendNow ? salesAnalysis.splitElasticity.weekend : salesAnalysis.splitElasticity.weekday;
                if (legacySplit.avgVolumeChangeRate != null && legacySplit.count >= 2) {
                  dowElasticity = legacySplit.avgVolumeChangeRate;
                }
              }

              // 옵션 3: 인상/인하 분리 계수 (splitElasticityByFuel 신규 경로에만 존재)
              const upInfo = split?.up ?? null;
              const downInfo = split?.down ?? null;

              const avgAbsChange = (() => {
                const v = fuelEvents.filter((e) => e.priceChange !== 0);
                return v.length > 0 ? v.reduce((s, e) => s + Math.abs(e.priceChange), 0) / v.length : 10;
              })();

              const simulations = [10, 20, 30, -10, -20].map((delta) => {
                const simPrice = myPrice + delta;
                const simPrices = [simPrice, ...compPrices].sort((a, b) => a - b);
                const simRank = simPrices.indexOf(simPrice) + 1;
                let salesImpact: number | null = null;
                // 옵션 3: 방향별 실측 계수. 대칭 공식 폐기. 반올림은 렌더 시점(formatImpact)에서만.
                if (delta > 0 && upInfo && upInfo.count >= 3 && upInfo.avgPriceChange > 0) {
                  const perWon = upInfo.avgVolumeChangeRate / upInfo.avgPriceChange;
                  salesImpact = perWon * delta;
                } else if (delta < 0 && downInfo && downInfo.count >= 3 && downInfo.avgPriceChange < 0) {
                  const perWon = downInfo.avgVolumeChangeRate / Math.abs(downInfo.avgPriceChange);
                  salesImpact = perWon * Math.abs(delta);
                } else if (dowElasticity != null) {
                  // 레거시 fallback: 신규 필드 없거나 n<3 인 경우. 기존 대칭 공식.
                  const absElast = Math.abs(dowElasticity / avgAbsChange);
                  salesImpact = -absElast * delta;
                }
                return { delta, simPrice, simRank, total: simPrices.length, rankChange: simRank - currentRank, salesImpact };
              });

              // 동적 정밀도: |v|>=1 → 소수 1자리 / <1 → 소수 2자리. 작은 값 정보 보존.
              const formatImpact = (v: number): string => {
                const abs = Math.abs(v);
                const digits = abs >= 1 ? 1 : 2;
                return v.toFixed(digits);
              };

              const fuelLabel = isDiesel ? "경유" : "휘발유";
              const sampleCount = fuelEvents.length;
              // 샘플 부족 경고 (유종별 이벤트 < 3) — 탄성도 계산 자체를 안 했을 것이므로 dowElasticity null 이면 주석도 숨김

              return (
                <div key={fuelType} className="bg-surface-raised rounded-xl p-5 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">
                      가격 시뮬레이터 · {fuelLabel}
                    </div>
                    {dowElasticity != null && (
                      <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                        오늘 기준: {contextLabel}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] text-text-tertiary mb-3">
                    현재 {fuelLabel} {myPrice.toLocaleString()}원 · {allPrices.length}개 중 {currentRank}위
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {simulations.map(({ delta, simPrice, simRank, total, rankChange, salesImpact }) => {
                      const isUp = delta > 0;
                      return (
                        <div key={delta} className={`rounded-lg px-4 py-2.5 border flex items-center justify-between ${isUp ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"}`}>
                          <div className="flex items-center gap-3">
                            <div className={`text-[13px] font-bold w-12 ${isUp ? "text-red-600" : "text-blue-600"}`}>
                              {delta > 0 ? "+" : ""}{delta}원
                            </div>
                            <div className="text-[15px] font-extrabold text-text-primary tnum tracking-tight">{simPrice.toLocaleString()}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-[12px] text-text-secondary">
                              {total}개 중 <span className="font-bold">{simRank}위</span>
                            </div>
                            {rankChange !== 0 ? (
                              <div className={`text-[11px] font-medium ${rankChange > 0 ? "text-coral" : "text-blue-600"}`}>
                                {rankChange > 0 ? `▼${rankChange}` : `▲${Math.abs(rankChange)}`}
                              </div>
                            ) : (
                              <div className="text-[11px] text-text-tertiary">-</div>
                            )}
                            {salesImpact != null && (
                              <div className={`text-[11px] font-bold pl-2 border-l tabular-nums text-right min-w-[72px] ${isUp ? "border-red-200" : "border-blue-200"} ${salesImpact <= -3 ? "text-red-600" : salesImpact >= 3 ? "text-emerald-600" : "text-text-secondary"}`}>
                                판매 {salesImpact > 0 ? "+" : ""}{formatImpact(salesImpact)}%
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {dowElasticity != null && (
                    <div className="mt-2 text-[10px] text-text-tertiary leading-relaxed">
                      {upInfo && downInfo
                        ? <>* 단변수 모델 (내 가격) · 인상 n={upInfo.count}건 / 인하 n={downInfo.count}건 실측 반응 · {dowLabel}</>
                        : <>* 단변수 모델 (내 가격) · {fuelLabel} 가격변경 {sampleCount}건 가중평균{((isDiesel ? salesAnalysis?.splitElasticityByFuel?.diesel : salesAnalysis?.splitElasticity) && ` · ${dowLabel} 보정`)}</>}
                      <br />
                      &nbsp;&nbsp;다변수 예측(경쟁사·날씨 포함)은 위 통합 판매 예측 참고
                    </div>
                  )}

                  {/* 데이터 축적 진행도 — 인상+인하 이벤트 합계 / 60.
                      시뮬레이터가 실제 사용하는 그룹의 표본 = 주중·주말 양쪽 up+down 합.
                      60건 도달 시 자동 숨김. integrated compGapElasticity.reliable 임계와 통일.
                      자기진단 카드 패턴 (h-1.5 + 모노 카운터). 명세: spec_simulator_data_progress.md */}
                  {(() => {
                    const SIMULATOR_DATA_TARGET = 60;
                    const byFuelAll = salesAnalysis?.splitElasticityByFuel?.[fuelType];
                    const wkUp = byFuelAll?.weekday?.up?.count ?? 0;
                    const wkDown = byFuelAll?.weekday?.down?.count ?? 0;
                    const weUp = byFuelAll?.weekend?.up?.count ?? 0;
                    const weDown = byFuelAll?.weekend?.down?.count ?? 0;
                    const totalEvents = wkUp + wkDown + weUp + weDown;
                    if (totalEvents <= 0 || totalEvents >= SIMULATOR_DATA_TARGET) return null;
                    const widthPct = Math.min(100, Math.max(4, (totalEvents / SIMULATOR_DATA_TARGET) * 100));
                    return (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-200">
                            <div
                              className="h-full rounded-full bg-slate-400 transition-all duration-500"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-text-tertiary tabular-nums shrink-0">
                            {totalEvents}/{SIMULATOR_DATA_TARGET}
                          </span>
                        </div>
                        <div className="text-[10px] text-text-tertiary">
                          가격 변경 데이터 축적 중 — {SIMULATOR_DATA_TARGET}건 도달 시 정확도 향상
                        </div>
                      </div>
                    );
                  })()}

                  {/* 자동 인사이트 — splitElasticityByFuel 에서 4가지 패턴 감지 (최대 2개)
                      우선순위: 비대칭 > 둔감 > 주중주말차 > 데이터부족
                      sanity: n<5 제외, |10원당 %|>100 제외, 비율 cap 10
                      명세: memory/spec_simulator_auto_insights.md */}
                  {(() => {
                    const byFuelAll = salesAnalysis?.splitElasticityByFuel?.[fuelType];
                    if (!byFuelAll) return null;
                    const insights = detectSimulatorInsights({
                      weekday: byFuelAll.weekday,
                      weekend: byFuelAll.weekend,
                    });
                    if (insights.length === 0) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        {insights.slice(0, 2).map((ins, i) => (
                          <div key={i} className="text-[11px] text-text-secondary leading-relaxed flex items-start gap-1">
                            <span className="shrink-0">💡</span>
                            <span>{ins.text}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            };

            return (
              <>
                {renderCard("gasoline")}
                {renderCard("diesel")}
              </>
            );
          })()}

          {/* ⑩-a 개발 로드맵 카드 — Phase 2 예고편 (가격 시뮬레이터 옆, 3번째 칸) */}
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 border border-sky-200 text-sky-700">
                  🔬 개발 중
                </span>
                <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                  다음 단계 미리보기
                </span>
              </div>
            </div>
            <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase mt-2 mb-2">
              가격 시뮬레이터 자가 학습
            </div>
            <div className="text-[12px] text-text-secondary leading-relaxed mb-3">
              가격을 바꿨을 때 실제 판매량이 예측과 얼마나 달랐는지 매일 학습하여,
              가격 탄력성 공식을 스스로 보정하는 엔진.
            </div>

            {/* 진척도 바 */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-2 rounded-full overflow-hidden bg-slate-200">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all duration-500"
                    style={{ width: "10%" }}
                  />
                </div>
                <span className="text-[12px] font-mono font-bold text-sky-700 tabular-nums shrink-0">
                  10%
                </span>
              </div>
              <div className="text-[11px] text-text-tertiary">
                선행 검증 대기 중
              </div>
            </div>

            {/* 상세 정보 */}
            <div className="pt-3 border-t border-border space-y-1.5 text-[12px] text-text-secondary leading-relaxed">
              <div>
                <span className="shrink-0">📅</span>
                {" "}<span className="font-semibold text-text-primary">2026년 Q3 ~ Q4</span>
                {" "}(약 3~4개월)
              </div>
              <div>
                <span className="shrink-0">✅</span>
                {" "}착수 조건: 위 자동 보정 실험에서
                {" "}<span className="font-semibold text-text-primary">&lsquo;효과 확인됨&rsquo;</span>
                {" "}결과
              </div>
              <div>
                <span className="shrink-0">🎯</span>
                {" "}기대 효과: 가격 변경 시 판매 예측 정확도 자동 개선
              </div>
              <div>
                <span className="shrink-0">⚙️</span>
                {" "}방식: Shadow → Active 단계적 배포 (자동 보정 실험과 동일)
              </div>
            </div>

            <p className="mt-3 pt-3 border-t border-border text-[11px] text-text-tertiary text-center mb-0">
              ⓘ 완성 전까지는 현재 시뮬레이터 결과에 영향 없음
            </p>
          </div>

          <SectionDivider title="매출 영향 요인" description="영향 변수 · 세차 · 환경" />

          {/* 카드 ⑧ 판매량·가격 분석 — 2026-04-17 삭제 (1건 raw vs 시뮬 다건 평균 모순 정리).
              미니 섹션으로 흡수 시도 (75c0dc8) 했으나 같은 모순 재발 → 미니 섹션도 제거.
              상세 페이지(/dashboard/sales-analysis) 진입점은 발표 후 별도 검토.
              백엔드 sales-analysis.ts 데이터는 그대로 유지 (AI 브리핑이 사용). */}

          {/* ⑪ 영향력 순위 바 차트
              - 경쟁사: |r| ≥ 0.10 필터 + 상위 8 (5km 내 cap=15 중에서)
              - 비경쟁사(날씨/유가/세차/요일): 항상 노출
              - 라벨: 경쟁사만 "(N km)" 거리 병기 */}
          {loading.correlationMatrix ? <CardSkeleton /> : correlationMatrix && correlationMatrix.variables.length > 1 && (() => {
            const TOP_N_COMPETITORS = 8;
            const COMPETITOR_R_FLOOR = 0.10;

            const vars = correlationMatrix.variables
              .filter(v => v.id !== "sales")
              .map(v => {
                const absEffect = v.metric === "eta_squared" ? (v.etaSq ?? 0) : Math.abs(v.r ?? 0);
                return { ...v, absEffect };
              })
              .sort((a, b) => b.absEffect - a.absEffect);

            // 경쟁사만 |r| 필터 + 상위 N. 비경쟁사는 변동 없이 모두 표시.
            const competitorVars = vars
              .filter(v => v.group === "competitor" && v.absEffect >= COMPETITOR_R_FLOOR)
              .slice(0, TOP_N_COMPETITORS);
            const otherVars = vars.filter(v => v.group !== "competitor");
            const displayVars = [...otherVars, ...competitorVars]
              .sort((a, b) => b.absEffect - a.absEffect);

            const maxEffect = Math.max(...displayVars.map(v => v.absEffect), 0.01);

            type InfluenceGroup = "strong" | "moderate" | "weak";
            const getGroup = (abs: number): InfluenceGroup =>
              abs > 0.4 ? "strong" : abs > 0.2 ? "moderate" : "weak";

            const groupMeta: Record<InfluenceGroup, { label: string; borderColor: string }> = {
              strong: { label: "강한 영향 |r| > 0.4", borderColor: "#639922" },
              moderate: { label: "보통 영향 0.2 < |r| < 0.4", borderColor: "#378ADD" },
              weak: { label: "약한/없음 |r| < 0.2", borderColor: "#888" },
            };

            const grouped: Record<InfluenceGroup, typeof displayVars> = { strong: [], moderate: [], weak: [] };
            displayVars.forEach(v => grouped[getGroup(v.absEffect)].push(v));

            const getBarColor = (v: typeof displayVars[0]) =>
              v.metric === "eta_squared" ? "#7F77DD"
                : (v.r ?? 0) > 0 ? "#1D9E75" : (v.r ?? 0) < 0 ? "#E24B4A" : "#6B7280";

            // "최근 N일 기준" — 경쟁사 페어 평균 일수 우선, 없으면 totalDays(구형 스냅샷 fallback)
            const dayLabel = correlationMatrix.dataRange.commonDays != null && correlationMatrix.dataRange.commonDays > 0
              ? `최근 ${correlationMatrix.dataRange.commonDays}일 기준`
              : `${correlationMatrix.dataRange.totalDays}일 기준`;

            // 5km 내 전체 경쟁사 중 |r|<0.10 으로 모두 절단된 경우 fallback 메시지
            const allCompetitors = vars.filter(v => v.group === "competitor");
            const noCompetitorPasses = allCompetitors.length > 0 && competitorVars.length === 0;

            return (
              <ClickableCard href="/dashboard/correlations" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">영향력 순위</div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-tertiary">5km 내 영향 큰 순</span>
                    <span className="text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                      {dayLabel}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-600/20 border border-amber-500/30">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-[12px] font-bold text-amber-400">판매량</span>
                  </span>
                  <span className="text-[11px] text-text-tertiary">← 중심 변수</span>
                </div>
                <div className="space-y-2">
                  {(["strong", "moderate", "weak"] as InfluenceGroup[]).map(group => {
                    const items = grouped[group];
                    if (items.length === 0) return null;
                    const meta = groupMeta[group];
                    return (
                      <div key={group} className="rounded-md py-2 pr-2.5 pl-3" style={{ borderLeft: `3px solid ${meta.borderColor}` }}>
                        <div className="text-[10px] text-text-tertiary mb-1.5 font-medium">{meta.label}</div>
                        <div className="space-y-1">
                          {items.map(v => {
                            const barWidth = Math.max(4, (v.absEffect / maxEffect) * 100);
                            const barColor = getBarColor(v);
                            const displayValue = v.metric === "eta_squared"
                              ? `η²=${v.absEffect.toFixed(2)}`
                              : `${(v.r ?? 0) >= 0 ? "+" : ""}${(v.r ?? 0).toFixed(2)}`;
                            // 경쟁사는 라벨에 거리 병기 → truncate 시 hover로 풀네임 확인
                            const labelText = v.group === "competitor" && v.distance_km != null
                              ? `${v.label} (${v.distance_km}km)`
                              : v.label;
                            return (
                              <div key={v.id} className="flex items-center gap-2">
                                <span className="text-[11px] text-text-secondary w-[110px] truncate text-right flex-shrink-0" title={labelText}>{labelText}</span>
                                <div className="flex-1 h-[14px] rounded-sm overflow-hidden relative" style={{ backgroundColor: "#f0f0f0" }}>
                                  <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${barWidth}%`, backgroundColor: barColor }} />
                                </div>
                                <span className="text-[12px] w-[52px] text-right flex-shrink-0" style={{ color: barColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                                  {displayValue}
                                </span>
                                {!v.significant && <span className="text-[9px] text-amber-500">*</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* 경쟁사 전부가 |r|<0.10 으로 절단된 경우 안내 */}
                {noCompetitorPasses && (
                  <div className="mt-2 text-[11px] text-text-tertiary bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
                    5km 내 경쟁사 {allCompetitors.length}곳 모두 약한 영향(|r|&lt;0.10) — 가격은 다른 요인이 더 결정적
                  </div>
                )}
                <div className="flex items-center gap-3 mt-2 text-[10px] text-text-tertiary">
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#1D9E75" }} /> 양의 상관</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#E24B4A" }} /> 음의 상관</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#7F77DD" }} /> 요일 효과</span>
                </div>
              </ClickableCard>
            );
          })()}

          {/* 📅 이번 주 판매 현황 */}
          {forecastReview && (() => {
            const history = ((forecastReview as Record<string, any>).history as Array<{ date: string; predicted: number; actual: number }> | undefined) ?? [];
            const dowMean = (integratedForecast as Record<string, any>)?.coefficients?.dowMean as Record<number, number> | undefined;
            if (history.length < 2 && !dowMean) return null;

            const nowKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
            const todayStr = nowKST.toISOString().slice(0, 10);
            const kstDow = nowKST.getDay();
            const mondayOffset = kstDow === 0 ? -6 : 1 - kstDow;
            const monday = new Date(nowKST);
            monday.setDate(monday.getDate() + mondayOffset);
            const mondayStr = monday.toISOString().slice(0, 10);

            const lastMonday = new Date(monday);
            lastMonday.setDate(lastMonday.getDate() - 7);
            const lastMondayStr = lastMonday.toISOString().slice(0, 10);

            const thisWeek = history.filter(h => h.date >= mondayStr && h.date <= todayStr && h.actual > 0);
            const lastWeek = history.filter(h => h.date >= lastMondayStr && h.date < mondayStr && h.actual > 0);

            const thisWeekTotal = thisWeek.reduce((s, h) => s + h.actual, 0);
            const lastWeekSameDays = lastWeek.slice(0, thisWeek.length);
            const lastWeekSameTotal = lastWeekSameDays.reduce((s, h) => s + h.actual, 0);
            const weekDiffPct = lastWeekSameTotal > 0 ? +((thisWeekTotal - lastWeekSameTotal) / lastWeekSameTotal * 100).toFixed(1) : null;

            const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
            const DOW_MAP = [1, 2, 3, 4, 5, 6, 0];
            const bars = DOW_MAP.map((jsDow, i) => {
              const avg = dowMean?.[jsDow] ?? 0;
              const dayData = thisWeek.find(h => {
                const d = new Date(h.date + "T00:00:00Z");
                return d.getUTCDay() === jsDow;
              });
              const targetDate = new Date(monday);
              targetDate.setDate(targetDate.getDate() + i);
              const dateStr = targetDate.toISOString().slice(0, 10);
              const isToday = dateStr === todayStr;
              const isFuture = dateStr > todayStr;
              return { label: DOW_LABELS[i], avg: Math.round(avg), actual: dayData?.actual ?? null, isToday, isPast: dateStr < todayStr, isFuture };
            });
            const maxVol = Math.max(...bars.map(b => Math.max(b.avg, b.actual ?? 0)), 1);

            return (
              <ClickableCard href="/dashboard/weekly-sales" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase mb-2">이번 주 판매</div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[24px] font-extrabold text-text-primary tnum tracking-tight">
                    {thisWeekTotal > 0 ? thisWeekTotal.toLocaleString() : "-"}
                  </span>
                  <span className="text-[12px] text-text-secondary">L 누적</span>
                  {weekDiffPct != null && (
                    <span className={`text-[13px] font-bold ${weekDiffPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {weekDiffPct >= 0 ? "+" : ""}{weekDiffPct}%
                    </span>
                  )}
                </div>
                {weekDiffPct != null && (
                  <div className="text-[11px] text-text-tertiary mb-3">지난주 같은 기간({lastWeekSameDays.length}일) 대비</div>
                )}
                <div className="flex items-end gap-1 h-20">
                  {bars.map((b) => {
                    const avgH = maxVol > 0 ? (b.avg / maxVol) * 100 : 0;
                    const actH = b.actual != null && maxVol > 0 ? (b.actual / maxVol) * 100 : 0;
                    return (
                      <div key={b.label} className="flex-1 flex flex-col items-center gap-0.5">
                        <div className="w-full flex flex-col items-center justify-end h-16 relative">
                          <div className="w-full rounded-t bg-slate-200 absolute bottom-0" style={{ height: `${Math.max(avgH, 4)}%` }} />
                          {b.actual != null && (
                            <div className={`w-3/4 rounded-t absolute bottom-0 z-10 ${b.isToday ? "bg-blue-500" : b.actual >= b.avg ? "bg-emerald-500" : "bg-red-400"}`} style={{ height: `${Math.max(actH, 4)}%` }} />
                          )}
                        </div>
                        <span className={`text-[10px] ${b.isToday ? "font-bold text-blue-600" : b.isFuture ? "text-text-tertiary" : "text-text-secondary"}`}>{b.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-text-tertiary">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-200 inline-block" /> 요일 평균</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> 실제(평균 이상)</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400 inline-block" /> 실제(평균 이하)</span>
                </div>
              </ClickableCard>
            );
          })()}

          {/* 🚿 세차장 현황 */}
          {loading.carwash ? <CardSkeleton /> : carwashSummary ? (() => {
            const t = carwashSummary.today;
            const y = carwashSummary.yesterday;
            const tr = carwashSummary.typeRatio;
            const rv = carwashSummary.review;
            const acc = carwashSummary.accuracy7;
            const cv = carwashSummary.conversionRate;
            return (
              <ClickableCard href="/dashboard/carwash" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">세차장 현황</div>
                  <span className="text-[11px] text-purple-500 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full font-medium">{t.dowLabel}요일</span>
                </div>
                {/* 오늘 예상 */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] text-text-secondary">오늘 예상</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[22px] font-extrabold text-purple-500" style={{ fontVariantNumeric: "tabular-nums" }}>{t.expectedCount.toLocaleString()}</span>
                    <span className="text-[12px] text-text-tertiary">대</span>
                  </div>
                </div>
                {t.weatherAdjustment && (
                  <div className="text-[11px] text-amber-500 mb-2">⚡ {t.weatherAdjustment}</div>
                )}
                {/* 어제 복기: 예측 vs 실제 */}
                {y && (
                  <div className="pt-2 border-t border-border space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-secondary">어제 {y.date.slice(5)}</span>
                      <div className="flex items-center gap-2">
                        {rv ? (
                          <>
                            <span className="text-[12px] text-text-tertiary">예측 {rv.predicted}대 →</span>
                            <span className="text-[14px] font-bold text-text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>{rv.actual != null ? `${rv.actual.toLocaleString()}대` : "대기 중"}</span>
                            {rv.errorPct != null && (
                              <span className={`text-[12px] font-bold ${Math.abs(rv.errorPct) <= 10 ? "text-emerald-600" : Math.abs(rv.errorPct) <= 25 ? "text-amber-500" : "text-red-500"}`}>
                                {rv.errorPct > 0 ? "+" : ""}{rv.errorPct}%
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="text-[14px] font-bold text-text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>{y.count.toLocaleString()}대</span>
                            {y.vsLastWeekPct != null && (
                              <span className={`text-[12px] font-bold ${y.vsLastWeekPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {y.vsLastWeekPct >= 0 ? "+" : ""}{y.vsLastWeekPct}%
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {/* 세차 전환율 + 7일 정확도 */}
                {(cv || acc) && (
                  <div className="pt-2 mt-2 border-t border-border flex items-center justify-between">
                    {cv && (
                      <span className="text-[11px] text-text-secondary">
                        전환율 <span className="font-bold text-purple-500">{cv.pct}%</span>
                        <span className="text-text-tertiary ml-1">({cv.carwashCount}/{cv.fuelCount}대)</span>
                      </span>
                    )}
                    {acc && (
                      <span className="text-[11px] text-text-secondary">
                        7일 정확도 <span className={`font-bold ${acc.accuracy >= 80 ? "text-emerald-600" : acc.accuracy >= 60 ? "text-amber-500" : "text-red-500"}`}>{acc.accuracy}%</span>
                      </span>
                    )}
                  </div>
                )}
                {/* 종류별 비율 */}
                {tr && (tr.basic.count + tr.premium.count > 0) && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden">
                      {tr.basic.pct > 0 && <div className="h-full bg-blue-400 rounded-l-full" style={{ width: `${tr.basic.pct}%` }} />}
                      {tr.premium.pct > 0 && <div className="h-full bg-purple-500" style={{ width: `${tr.premium.pct}%` }} />}
                      {tr.taxi.pct > 0 && <div className="h-full bg-amber-400" style={{ width: `${tr.taxi.pct}%` }} />}
                      {tr.free.pct > 0 && <div className="h-full bg-slate-300 rounded-r-full" style={{ width: `${tr.free.pct}%` }} />}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-tertiary">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" />기본 {tr.basic.pct}%</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />프리미엄 {tr.premium.pct}%</span>
                      {tr.taxi.pct > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />택시</span>}
                      {tr.free.pct > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" />무료</span>}
                    </div>
                  </div>
                )}
                {/* 날씨 인사이트 */}
                {carwashSummary.weatherInsight && (
                  <div className="mt-2 pt-2 border-t border-border text-[12px] text-text-secondary">
                    🌧️ {carwashSummary.weatherInsight}
                  </div>
                )}
              </ClickableCard>
            );
          })() : null}

          {/* 🔀 크로스 인사이트 */}
          {loading.crossInsights ? <CardSkeleton /> : crossInsights ? (() => {
            const wt = crossInsights.weatherTriple;
            const dh = crossInsights.dowHighlight;
            const sd = crossInsights.similarDays;
            const cc = crossInsights.competitorCascade;
            return (
              <ClickableCard href="/dashboard/cross-insights" className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase mb-3">크로스 인사이트</div>
                <div className="space-y-2.5">
                  {/* 세차 드리븐 주유 */}
                  <div className="text-[12px]">
                    <span className={`font-bold ${wt.carwashDrivenFuel ? "text-emerald-600" : "text-text-secondary"}`}>
                      {wt.carwashDrivenFuel ? "✓ 세차 드리븐 주유 확인" : "세차·주유 독립적"}
                    </span>
                    <div className="text-[11px] text-text-tertiary mt-0.5">{wt.insight}</div>
                  </div>
                  {/* 요일 프로파일 */}
                  <div className="text-[12px] pt-2 border-t border-border">
                    <span className="text-text-secondary">전환율 최고</span>{" "}
                    <span className="font-bold text-purple-500">{dh.bestConversionDay.label} {dh.bestConversionDay.conversionPct}%</span>
                    <span className="text-text-tertiary mx-1.5">·</span>
                    <span className="text-text-secondary">프리미엄 최고</span>{" "}
                    <span className="font-bold text-purple-500">{dh.bestPremiumDay.label} {dh.bestPremiumDay.premiumPct}%</span>
                  </div>
                  {/* 유사 사례 */}
                  {sd.count >= 3 && sd.avgFuelCount && sd.avgCarwashCount && (
                    <div className="text-[12px] pt-2 border-t border-border">
                      <div className="text-text-secondary">
                        오늘 유사 과거 <span className="font-bold text-text-primary">{sd.count}일</span>
                        <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sd.confidence === "high" ? "text-emerald-600 bg-emerald-50" : sd.confidence === "medium" ? "text-amber-600 bg-amber-50" : "text-slate-500 bg-slate-100"}`}>
                          {sd.confidence === "high" ? "신뢰↑" : sd.confidence === "medium" ? "보통" : "참고"}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-tertiary mt-0.5">
                        평균 주유 {sd.avgFuelCount}대 · 세차 {sd.avgCarwashCount}대 · 전환율 {sd.avgConversionPct}%
                      </div>
                    </div>
                  )}
                  {/* 경쟁사 데이터 상태 */}
                  {cc.dataStatus === "accumulating" && (
                    <div className="text-[11px] text-text-tertiary pt-2 border-t border-border">
                      ⏳ 경쟁사 연쇄 효과: {cc.insight}
                    </div>
                  )}
                </div>
              </ClickableCard>
            );
          })() : null}

          {/* 🌤️ 오늘 날씨 (하남시) */}
          {loading.weather ? <CardSkeleton /> : weather && weather.today && (() => {
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

          <SectionDivider title="경쟁 환경" description="경쟁사 동향 · 포지션 · 벤치마크" />

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
                    // 휘발유 기준 — 벤치마크 카드는 휘발유 맥락
                    const gasEvts = (salesAnalysis?.events ?? []).filter((e) => (e.fuel ?? "gasoline") === "gasoline");
                    if (gasEvts.length < 2) return null;
                    const validEvts = gasEvts.filter(e => e.priceChange !== 0);
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

          {/* 타이밍 · 연동성 · 프로파일 (3열 나란히) */}
          <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
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

          {/* ⑧ 경쟁사 프로파일 — 다양성 슬라이스 (변동 잦음 2 + 보통 2 + 적음 2)
              정렬: 타입별 |r| desc → 빈 슬롯은 다른 타입에서 |r| desc 로 채움
              데이터 join: insights.competitorProfiles + correlationMatrix.variables (id="comp_<id>")
              correlation 누락 시 absR=0 으로 graceful degrade */}
          {!loading.insights && insights && insights.competitorProfiles.length > 0 && (() => {
            const SLOTS_PER_TYPE = 2;
            const TOTAL_SLOTS = 6;

            // |r| join: correlation-matrix variables 에서 같은 station id 매칭
            type ProfileWithR = (typeof insights.competitorProfiles)[number] & {
              absR: number;
              r: number | null;
            };
            const profilesWithR: ProfileWithR[] = insights.competitorProfiles
              .filter((p) => p.type !== "unknown")
              .map((p) => {
                const corrVar = correlationMatrix?.variables.find((v) => v.id === `comp_${p.id}`);
                const r = corrVar?.r ?? null;
                return { ...p, r, absR: r != null ? Math.abs(r) : 0 };
              });

            // 타입별 |r| desc 상위 SLOTS_PER_TYPE 곳
            const pickByType = (type: "leader" | "follower" | "steady") =>
              profilesWithR
                .filter((p) => p.type === type)
                .sort((a, b) => b.absR - a.absR)
                .slice(0, SLOTS_PER_TYPE);
            const leaders = pickByType("leader");
            const followers = pickByType("follower");
            const steadies = pickByType("steady");

            // 빈 슬롯 fillers: 미선택 + |r| desc
            const used = new Set([...leaders, ...followers, ...steadies].map((p) => p.id));
            const fillers = profilesWithR
              .filter((p) => !used.has(p.id))
              .sort((a, b) => b.absR - a.absR)
              .slice(0, TOTAL_SLOTS - leaders.length - followers.length - steadies.length);

            // 표시 순서: 타입 그룹 → 그룹 내 |r| desc, fillers 는 마지막에 같은 타입 옆이 아닌 끝에 두어도 OK.
            // 사장 가독성을 위해 leader→follower→steady 순으로 묶고 fillers 는 끝.
            const display = [...leaders, ...followers, ...steadies, ...fillers];

            const typeColors = {
              leader: { bg: "bg-red-50 border border-red-100", badge: "bg-red-900/50 text-red-700" },
              follower: { bg: "bg-amber-50 border border-amber-100", badge: "bg-amber-900/50 text-amber-700" },
              steady: { bg: "bg-slate-50 border border-slate-200", badge: "bg-slate-100 text-slate-700" },
              unknown: { bg: "bg-slate-50 border border-slate-200", badge: "bg-slate-100 text-slate-600" },
            } as const;

            // "선제/추종/안정" → "변동 잦음/보통/적음" (이 카드만 새 라벨, 발표 후 일괄 변경 예정)
            const variabilityLabel = (type: "leader" | "follower" | "steady" | "unknown"): string =>
              type === "leader"
                ? "변동 잦음"
                : type === "follower"
                ? "변동 보통"
                : type === "steady"
                ? "변동 적음"
                : "분류 없음";

            return (
              <div className="bg-surface-raised rounded-xl p-5 border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[13px] font-bold text-text-tertiary tracking-wider uppercase">경쟁사 프로파일</div>
                  <DataFreshness date={priceHistory?.history?.[priceHistory.history.length - 1]?.date ?? null} label="분석 기준" />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {display.map((p) => {
                    const tc = typeColors[p.type];
                    return (
                      <div key={p.id} className={`rounded-lg px-3 py-2.5 ${tc.bg}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[p.brand] || "#9BA8B7" }} />
                          <span className="text-[12px] font-medium text-text-primary truncate" title={p.name}>
                            {p.name}{p.distance_km != null && <span className="text-text-tertiary"> ({p.distance_km}km)</span>}
                          </span>
                          <div className="flex items-center gap-1 ml-auto shrink-0">
                            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${tc.badge}`}>
                              {variabilityLabel(p.type)} {p.changeCount}회/18일
                            </span>
                            {(() => {
                              const ch = changes?.changes.find((c) => c.id === p.id);
                              const diff = ch?.gasoline_diff ?? 0;
                              return diff !== 0 ? (
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${diff > 0 ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                                  오늘 {diff > 0 ? "↑" : "↓"}{Math.abs(diff)}원
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        <div className="text-[12px] text-text-secondary">
                          평균 {p.avgChangeSize}원폭
                          {p.currentPrice && <span className="ml-1">· 현재 {p.currentPrice.toLocaleString()}원</span>}
                          {p.r != null && (
                            <span className="ml-1 text-text-tertiary">· 영향력 r={p.r >= 0 ? "+" : ""}{p.r.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-[12px] text-text-tertiary leading-relaxed">
                  * 최근 18일 가격 변경 빈도 분류 — 변동 잦음(≥5회) · 보통(3~4회) · 적음(0~2회)<br />
                  * 각 그룹에서 영향력(|r|) 큰 순으로 2곳씩 표시. 빈 슬롯은 다른 그룹에서 채움.<br />
                  * 같은 페이지 다른 카드의 &lsquo;선제/추종/안정&rsquo; 배지도 동일 분류 (라벨 통합은 발표 후 진행)
                </div>
              </div>
            );
          })()}
          </div>

          <SectionDivider title="시장 흐름" description="유가 · 가격 추이" />

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

          {/* ⑦ 내 가격 추이 (wide) — 최하단 */}
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

        </div>
      </main>
    </div>
  );
}
