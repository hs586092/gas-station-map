"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

const BRAND_LABELS: Record<string, string> = {
  SKE: "SK에너지", GSC: "GS칼텍스", HDO: "HD현대오일뱅크",
  SOL: "S-OIL", RTO: "자영알뜰", NHO: "농협알뜰", ETC: "기타",
};
const BRAND_COLORS: Record<string, string> = {
  SKE: "#f42a2a", GSC: "#00a651", HDO: "#0066b3",
  SOL: "#ffd200", RTO: "#ff8c00", NHO: "#006838", ETC: "#9BA8B7",
};

interface Competitor {
  id: string; name: string; brand: string;
  gasoline_price: number | null; diesel_price: number | null;
  distance_km: number; gasoline_diff: number | null; diesel_diff: number | null;
}

interface Profile {
  id: string; name: string; brand: string; distance_km: number;
  type: "leader" | "follower" | "steady" | "unknown";
  changeCount: number; avgChangeSize: number; currentPrice: number | null;
}

interface CorrelationItem {
  id: string; name: string; brand: string;
  gasoline_correlation: number | null; diesel_correlation: number | null;
  distance_km: number; data_points: number;
}

interface WeeklyTrend {
  action: string; message: string;
  risingCount: number; fallingCount: number; stableCount: number;
}

interface PriceDay {
  date: string; gasoline: number | null; diesel: number | null;
}

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [myStation, setMyStation] = useState<{ name: string; gasoline_price: number | null; diesel_price: number | null } | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([]);
  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrend | null>(null);
  const [loading, setLoading] = useState(true);

  // 개별 경쟁사 차트
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chartData, setChartData] = useState<PriceDay[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const [selectedFuel, setSelectedFuel] = useState<"gasoline" | "diesel">("gasoline");
  const [sortBy, setSortBy] = useState<"distance" | "price" | "changes">("distance");

  useEffect(() => {
    const base = `/api/stations/${STATION_ID}`;
    Promise.all([
      fetch(`${base}/competitors`).then((r) => r.json()),
      fetch(`${base}/dashboard-insights`).then((r) => r.json()),
      fetch(`${base}/correlation`).then((r) => r.json()),
    ]).then(([compData, insightsData, corrData]) => {
      setMyStation(compData.baseStation);
      setCompetitors(compData.competitors || []);
      setProfiles(insightsData.competitorProfiles || []);
      setWeeklyTrend(insightsData.weeklyTrend || null);
      setCorrelations(corrData.correlations || []);
      setLoading(false);
    });
  }, []);

  const toggleChart = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setChartLoading(true);
    const res = await fetch(`/api/price-history/${id}`);
    const json = await res.json();
    setChartData(json.history || []);
    setChartLoading(false);
  };

  // 프로파일/연동성 맵
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const corrMap = new Map(correlations.map((c) => [c.id, c]));

  // 정렬
  const sorted = [...competitors].sort((a, b) => {
    if (sortBy === "price") {
      const pA = selectedFuel === "gasoline" ? (a.gasoline_price ?? 9999) : (a.diesel_price ?? 9999);
      const pB = selectedFuel === "gasoline" ? (b.gasoline_price ?? 9999) : (b.diesel_price ?? 9999);
      return pA - pB;
    }
    if (sortBy === "changes") {
      return (profileMap.get(b.id)?.changeCount ?? 0) - (profileMap.get(a.id)?.changeCount ?? 0);
    }
    return a.distance_km - b.distance_km;
  });

  const typeLabel = (t: string) => t === "leader" ? "선제형" : t === "follower" ? "추종형" : t === "steady" ? "안정형" : "미분류";
  const typeColor = (t: string) => t === "leader" ? "bg-red-100 text-red-700" : t === "follower" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="경쟁사 통합 분석" description="반경 5km 경쟁사 종합 현황" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="경쟁사 통합 분석" description="셀프광장주유소 · 반경 5km 경쟁사 종합 현황" />

      <main className="px-5 pb-10">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">총 경쟁사</div>
            <div className="text-[22px] font-extrabold text-text-primary">{competitors.length}<span className="text-[12px] font-normal">개</span></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">이번 주 인상</div>
            <div className="text-[22px] font-extrabold text-coral">{weeklyTrend?.risingCount ?? 0}<span className="text-[12px] font-normal">곳</span></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">이번 주 인하</div>
            <div className="text-[22px] font-extrabold text-blue-600">{weeklyTrend?.fallingCount ?? 0}<span className="text-[12px] font-normal">곳</span></div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-border">
            <div className="text-[13px] text-text-secondary mb-1">선제형 경쟁사</div>
            <div className="text-[22px] font-extrabold text-text-primary">{profiles.filter((p) => p.type === "leader").length}<span className="text-[12px] font-normal">곳</span></div>
          </div>
        </div>

        {/* 7일 추세 */}
        {weeklyTrend && (
          <div className={`mb-6 rounded-2xl px-5 py-4 ${
            weeklyTrend.action === "rising" ? "bg-red-50" : weeklyTrend.action === "falling" ? "bg-blue-50" : "bg-slate-50"
          }`}>
            <div className="text-[13px] font-semibold text-text-primary">{weeklyTrend.message}</div>
          </div>
        )}

        {/* 필터 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button onClick={() => setSelectedFuel("gasoline")} className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${selectedFuel === "gasoline" ? "bg-coral text-white border-coral" : "bg-white text-text-secondary border-border"}`}>휘발유</button>
            <button onClick={() => setSelectedFuel("diesel")} className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${selectedFuel === "diesel" ? "bg-navy text-white border-navy" : "bg-white text-text-secondary border-border"}`}>경유</button>
          </div>
          <div className="flex gap-1">
            {(["distance", "price", "changes"] as const).map((s) => (
              <button key={s} onClick={() => setSortBy(s)} className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${sortBy === s ? "bg-slate-700 text-white border-slate-700" : "bg-white text-text-secondary border-border"}`}>
                {s === "distance" ? "거리순" : s === "price" ? "가격순" : "변경순"}
              </button>
            ))}
          </div>
        </div>

        {/* 경쟁사 목록 */}
        <div className="space-y-2 mb-6">
          {sorted.map((c) => {
            const price = selectedFuel === "gasoline" ? c.gasoline_price : c.diesel_price;
            const diff = selectedFuel === "gasoline" ? c.gasoline_diff : c.diesel_diff;
            const prof = profileMap.get(c.id);
            const corr = corrMap.get(c.id);
            const corrVal = selectedFuel === "gasoline" ? corr?.gasoline_correlation : corr?.diesel_correlation;
            const isExpanded = expandedId === c.id;

            return (
              <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-surface/50 transition-colors"
                  onClick={() => toggleChart(c.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-text-primary truncate">{c.name}</span>
                          <span className="text-[12px] text-text-tertiary">{BRAND_LABELS[c.brand] || ""}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[12px] text-text-secondary">
                          <span>{c.distance_km}km</span>
                          {prof && (
                            <span className={`px-1.5 py-0.5 rounded-full font-bold text-[12px] ${typeColor(prof.type)}`}>
                              {typeLabel(prof.type)} · {prof.changeCount}회
                            </span>
                          )}
                          {corrVal != null && (
                            <span className={`text-[12px] font-medium ${corrVal >= 0.7 ? "text-emerald" : corrVal >= 0.3 ? "text-amber-600" : "text-text-tertiary"}`}>
                              연동 {corrVal.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-[16px] font-bold text-text-primary">{price?.toLocaleString() || "-"}<span className="text-[12px] font-normal">원</span></div>
                      {diff != null && (
                        <div className={`text-[13px] font-bold ${diff > 0 ? "text-coral" : diff < 0 ? "text-blue-600" : "text-text-tertiary"}`}>
                          나보다 {diff > 0 ? `+${diff}` : diff}원
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end mt-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2" className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {/* 펼침: 30일 차트 */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border">
                    {chartLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-5 h-5 border-2 border-border border-t-emerald rounded-full animate-spin" />
                      </div>
                    ) : chartData.length > 0 ? (
                      <div className="pt-3">
                        <div className="text-[13px] text-text-secondary mb-2">{c.name} · 최근 30일 {selectedFuel === "gasoline" ? "휘발유" : "경유"}</div>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={chartData.map((d) => ({ ...d, date: d.date.slice(5) }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                            <XAxis dataKey="date" fontSize={10} tick={{ fill: "#9BA8B7" }} interval="preserveStartEnd" tickLine={false} />
                            <YAxis fontSize={10} tick={{ fill: "#9BA8B7" }} domain={["dataMin - 20", "dataMax + 20"]} tickFormatter={(v: number) => v.toLocaleString()} axisLine={false} tickLine={false} width={45} />
                            <Tooltip formatter={(value, name) => [`${Number(value).toLocaleString()}원`, String(name)]} contentStyle={{ borderRadius: 10, border: "1px solid #E8EBF0", fontSize: 12 }} />
                            <Line type="monotone" dataKey={selectedFuel} stroke={BRAND_COLORS[c.brand] || "#9BA8B7"} strokeWidth={2} dot={false} connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="text-[12px] text-text-tertiary text-center py-6">가격 이력 데이터가 없습니다.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 가격 연동성 */}
        {correlations.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-border mb-6">
            <div className="text-[16px] font-bold text-text-primary mb-1">가격 연동성 분석</div>
            <div className="text-[13px] text-text-secondary mb-4">나와 가격이 같이 움직이는 경쟁사 (Pearson 상관계수, 30일 기준)</div>
            <div className="space-y-3">
              {correlations
                .filter((c) => (selectedFuel === "gasoline" ? c.gasoline_correlation : c.diesel_correlation) != null)
                .sort((a, b) => {
                  const va = Math.abs(selectedFuel === "gasoline" ? (a.gasoline_correlation ?? 0) : (a.diesel_correlation ?? 0));
                  const vb = Math.abs(selectedFuel === "gasoline" ? (b.gasoline_correlation ?? 0) : (b.diesel_correlation ?? 0));
                  return vb - va;
                })
                .slice(0, 8)
                .map((c) => {
                  const val = (selectedFuel === "gasoline" ? c.gasoline_correlation : c.diesel_correlation) ?? 0;
                  const absVal = Math.abs(val);
                  const barColor = val >= 0.7 ? "bg-emerald-500" : val >= 0.3 ? "bg-amber-400" : val >= -0.3 ? "bg-gray-300" : "bg-red-400";
                  const label = val >= 0.7 ? "높은 연동" : val >= 0.3 ? "보통 연동" : val >= -0.3 ? "독립적" : "역방향";
                  return (
                    <div key={c.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BRAND_COLORS[c.brand] || "#9BA8B7" }} />
                          <span className="text-[12px] text-text-primary truncate">{c.name}</span>
                          <span className="text-[12px] text-text-tertiary">{c.distance_km}km</span>
                        </div>
                        <span className="text-[12px] font-bold text-text-primary shrink-0 ml-2">{val.toFixed(2)}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(absVal * 100, 5)}%` }} />
                      </div>
                      <div className="text-[12px] text-text-secondary">{label} · 데이터 {c.data_points}일</div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* 프로파일 요약 */}
        {profiles.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-border">
            <div className="text-[16px] font-bold text-text-primary mb-4">경쟁사 행동 프로파일</div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {(["leader", "follower", "steady"] as const).map((t) => {
                const count = profiles.filter((p) => p.type === t).length;
                const colors = { leader: "bg-red-50 text-red-700", follower: "bg-amber-50 text-amber-700", steady: "bg-slate-50 text-slate-600" };
                return (
                  <div key={t} className={`rounded-xl p-3 text-center ${colors[t]}`}>
                    <div className="text-[20px] font-extrabold">{count}</div>
                    <div className="text-[13px] font-medium">{typeLabel(t)}</div>
                  </div>
                );
              })}
            </div>
            <div className="text-[12px] text-text-tertiary">
              * 18일간 가격 변경 빈도: 5회 이상 선제형, 3~4회 추종형, 2회 이하 안정형
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
