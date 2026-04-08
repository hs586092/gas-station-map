"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from "recharts";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

// ─── 타입 ───
interface Variable {
  id: string;
  label: string;
  group: "center" | "weather" | "competitor" | "oil" | "time";
  color: string;
  metric: "pearson" | "eta_squared";
  r: number | null;
  etaSq: number | null;
  p: number | null;
  n: number;
  significant: boolean;
  lowSample: boolean;
}

interface RankItem {
  id: string;
  label: string;
  absEffect: number;
  r: number;
  metric: string;
  n: number;
  significant: boolean;
}

interface ScatterPoint {
  date: string;
  totalVol: number;
  precipitation: number | null;
  temperature: number | null;
  brent: number | null;
  dow: number;
  competitorDiffs: Record<string, number | null>;
}

interface MatrixItem {
  variable: string;
  label: string;
  r: number | null;
  p: number | null;
  n: number;
  metric: string;
  significant: boolean;
}

interface CorrelationData {
  stationName: string | null;
  dataRange: { from: string | null; to: string | null; totalDays: number };
  variables: Variable[];
  matrix: MatrixItem[];
  ranking: RankItem[];
  scatterData: ScatterPoint[];
  competitors: Array<{ id: string; name: string; distance_km: number; n: number }>;
}

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const GROUP_LABELS: Record<string, string> = {
  weather: "날씨",
  competitor: "경쟁사",
  oil: "유가",
  time: "시간",
};

export default function CorrelationsPage() {
  const [data, setData] = useState<CorrelationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/stations/${STATION_ID}/correlation-matrix`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const getScatterPairs = useCallback(
    (variableId: string): { x: number; y: number; date: string }[] => {
      if (!data) return [];
      const pairs: { x: number; y: number; date: string }[] = [];
      for (const pt of data.scatterData) {
        let xVal: number | null = null;
        if (variableId === "precipitation") xVal = pt.precipitation;
        else if (variableId === "temperature") xVal = pt.temperature;
        else if (variableId === "brent") xVal = pt.brent;
        else if (variableId === "day_of_week") xVal = pt.dow;
        else if (variableId.startsWith("comp_")) {
          const compId = variableId.replace("comp_", "");
          xVal = pt.competitorDiffs[compId] ?? null;
        }
        if (xVal != null) {
          pairs.push({ x: xVal, y: pt.totalVol, date: pt.date });
        }
      }
      return pairs;
    },
    [data]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="변수 상관관계 분석" description="판매량에 영향을 미치는 변수 간 상관관계 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-64 bg-slate-100 rounded-xl" />
            <div className="h-40 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="변수 상관관계 분석" description="판매량에 영향을 미치는 변수 간 상관관계 분석" />
        <div className="max-w-[1280px] mx-auto px-6 py-8">
          <div className="bg-surface-raised rounded-xl p-8 border border-border text-center text-text-secondary">
            데이터를 불러올 수 없습니다.
          </div>
        </div>
      </div>
    );
  }

  const vars = data.variables
    .filter((v) => v.id !== "sales")
    .map((v) => {
      const absEffect = v.metric === "eta_squared" ? (v.etaSq ?? 0) : Math.abs(v.r ?? 0);
      return { ...v, absEffect };
    })
    .sort((a, b) => b.absEffect - a.absEffect);

  const maxEffect = Math.max(...vars.map((v) => v.absEffect), 0.01);

  type InfluenceGroup = "strong" | "moderate" | "weak";
  const getGroup = (abs: number): InfluenceGroup =>
    abs > 0.4 ? "strong" : abs > 0.2 ? "moderate" : "weak";

  const groupMeta: Record<InfluenceGroup, { label: string; borderColor: string }> = {
    strong: { label: "강한 영향  |r| > 0.4", borderColor: "#639922" },
    moderate: { label: "보통 영향  0.2 < |r| < 0.4", borderColor: "#378ADD" },
    weak: { label: "약한/없음  |r| < 0.2", borderColor: "#888" },
  };

  const grouped: Record<InfluenceGroup, typeof vars> = { strong: [], moderate: [], weak: [] };
  vars.forEach((v) => grouped[getGroup(v.absEffect)].push(v));

  const getBarColor = (v: typeof vars[0]) =>
    v.metric === "eta_squared" ? "#7F77DD"
      : (v.r ?? 0) > 0 ? "#1D9E75" : (v.r ?? 0) < 0 ? "#E24B4A" : "#6B7280";

  const selectedVar = selectedNode
    ? data.variables.find((v) => v.id === selectedNode)
    : null;
  const scatterPairs = selectedNode ? getScatterPairs(selectedNode) : [];

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader
        title="변수 상관관계 분석"
        description={`판매량 중심 · ${data.dataRange.totalDays}일 데이터 (${data.dataRange.from} ~ ${data.dataRange.to})`}
      />

      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-6">
        {/* 영향력 순위 바 차트 */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[15px] font-bold text-text-primary m-0">판매량 영향력 순위</h2>
            <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#1D9E75" }} /> 양의 상관</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#E24B4A" }} /> 음의 상관</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1.5 inline-block rounded-sm" style={{ backgroundColor: "#7F77DD" }} /> 요일 효과</span>
            </div>
          </div>
          {/* 중심 변수 */}
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-600/20 border border-amber-500/30">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[12px] font-bold text-amber-400">판매량</span>
            </span>
            <span className="text-[11px] text-text-tertiary">← 중심 변수 · 변수 클릭 → 아래 산점도</span>
          </div>
          {/* 그룹별 바 */}
          <div className="space-y-3">
            {(["strong", "moderate", "weak"] as InfluenceGroup[]).map((group) => {
              const items = grouped[group];
              if (items.length === 0) return null;
              const meta = groupMeta[group];
              return (
                <div key={group} className="rounded-md py-3 pr-4 pl-4" style={{ borderLeft: `3px solid ${meta.borderColor}` }}>
                  <div className="text-[11px] text-text-tertiary mb-2 font-medium">{meta.label}</div>
                  <div className="space-y-1.5">
                    {items.map((v) => {
                      const barWidth = Math.max(4, (v.absEffect / maxEffect) * 100);
                      const barColor = getBarColor(v);
                      const displayValue = v.metric === "eta_squared"
                        ? `η²=${v.absEffect.toFixed(2)}`
                        : `${(v.r ?? 0) >= 0 ? "+" : ""}${(v.r ?? 0).toFixed(2)}`;
                      const isSelected = selectedNode === v.id;
                      return (
                        <div
                          key={v.id}
                          className={`flex items-center gap-3 py-1 px-2 rounded cursor-pointer transition-colors ${isSelected ? "bg-slate-100" : "hover:bg-slate-50"}`}
                          onClick={() => setSelectedNode((prev) => prev === v.id ? null : v.id)}
                        >
                          <span className="text-[13px] text-text-secondary w-[100px] truncate text-right flex-shrink-0 font-medium" title={v.label}>{v.label}</span>
                          <div className="flex-1 h-[18px] rounded-sm overflow-hidden relative" style={{ backgroundColor: "#f0f0f0" }}>
                            <div
                              className="h-full rounded-sm transition-all duration-500"
                              style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <span className="text-[13px] w-[60px] text-right flex-shrink-0" style={{ color: barColor, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {displayValue}
                          </span>
                          {v.lowSample && <span className="text-[9px] text-amber-500 flex-shrink-0">n={v.n}</span>}
                          {!v.significant && <span className="text-[9px] text-amber-500 flex-shrink-0">*</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 산점도 (노드 클릭 시 표시) */}
        {selectedVar && selectedNode !== "day_of_week" && scatterPairs.length > 0 && (
          <div className="bg-surface-raised rounded-xl p-6 border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-bold text-text-primary m-0">
                {selectedVar.label} vs 판매량 산점도
              </h2>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-[12px] text-text-tertiary hover:text-text-primary cursor-pointer bg-transparent border-none"
              >
                닫기
              </button>
            </div>
            <div className="text-[12px] text-text-tertiary mb-3">
              n={scatterPairs.length}
              {selectedVar.r != null && (
                <> · r={selectedVar.r.toFixed(3)}</>
              )}
              {selectedVar.p != null && (
                <> · p={selectedVar.p < 0.001 ? "<0.001" : selectedVar.p.toFixed(3)}</>
              )}
              {selectedVar.significant ? (
                <span className="text-emerald-600 ml-1">통계적 유의</span>
              ) : (
                <span className="text-amber-500 ml-1">유의하지 않음</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={350}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name={selectedVar.label}
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  label={{
                    value: selectedVar.label,
                    position: "insideBottomRight",
                    offset: -5,
                    fontSize: 11,
                    fill: "#6B7280",
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="판매량"
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  label={{
                    value: "판매량 (L)",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                    fill: "#6B7280",
                  }}
                />
                <ZAxis range={[30, 30]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    if (!payload || payload.length === 0) return null;
                    const pt = payload[0].payload;
                    return (
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[12px] shadow-md">
                        <div className="text-text-tertiary">{pt.date}</div>
                        <div>
                          {selectedVar!.label}: <span className="font-bold">{typeof pt.x === "number" ? pt.x.toLocaleString() : pt.x}</span>
                        </div>
                        <div>
                          판매량: <span className="font-bold">{Math.round(pt.y).toLocaleString()}L</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterPairs} fill={selectedVar.color} opacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 요일 효과 — 요일별 평균 판매량 바 차트 */}
        {selectedNode === "day_of_week" && (
          <div className="bg-surface-raised rounded-xl p-6 border border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-bold text-text-primary m-0">
                요일별 평균 판매량
              </h2>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-[12px] text-text-tertiary hover:text-text-primary cursor-pointer bg-transparent border-none"
              >
                닫기
              </button>
            </div>
            {(() => {
              const dowGroups: Record<number, number[]> = {};
              for (const pt of data.scatterData) {
                if (!dowGroups[pt.dow]) dowGroups[pt.dow] = [];
                dowGroups[pt.dow].push(pt.totalVol);
              }
              const dowData = DOW_LABELS.map((label, i) => {
                const arr = dowGroups[i] || [];
                const avg = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
                return { day: label, avg: Math.round(avg), n: arr.length };
              });
              const overallAvg =
                data.scatterData.length > 0
                  ? data.scatterData.reduce((s, p) => s + p.totalVol, 0) / data.scatterData.length
                  : 0;

              return (
                <div className="space-y-2">
                  {dowData.map((d) => {
                    const pct = overallAvg > 0 ? ((d.avg - overallAvg) / overallAvg) * 100 : 0;
                    const barWidth = overallAvg > 0 ? Math.max(5, (d.avg / (overallAvg * 1.5)) * 100) : 50;
                    return (
                      <div key={d.day} className="flex items-center gap-3">
                        <span className="text-[13px] font-bold text-text-primary w-6 text-right">{d.day}</span>
                        <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden relative">
                          <div
                            className="h-full rounded-full bg-purple-400"
                            style={{ width: `${Math.min(100, barWidth)}%`, opacity: 0.7 }}
                          />
                        </div>
                        <span className="text-[12px] font-bold text-text-primary w-16 text-right tabular-nums">
                          {d.avg.toLocaleString()}L
                        </span>
                        <span
                          className={`text-[11px] font-bold w-12 text-right ${
                            pct >= 3 ? "text-emerald-600" : pct <= -3 ? "text-red-500" : "text-text-tertiary"
                          }`}
                        >
                          {pct >= 0 ? "+" : ""}
                          {pct.toFixed(1)}%
                        </span>
                        <span className="text-[10px] text-text-tertiary w-8 text-right">n={d.n}</span>
                      </div>
                    );
                  })}
                  <div className="text-[11px] text-text-tertiary mt-2">
                    * 전체 평균 대비 %. η²={data.variables.find((v) => v.id === "day_of_week")?.etaSq?.toFixed(3) ?? "—"}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 영향력 순위 테이블 */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">
            판매량 영향 변수 순위
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-text-tertiary font-semibold">#</th>
                  <th className="text-left py-2 text-text-tertiary font-semibold">변수</th>
                  <th className="text-left py-2 text-text-tertiary font-semibold">그룹</th>
                  <th className="text-right py-2 text-text-tertiary font-semibold">효과 크기</th>
                  <th className="text-right py-2 text-text-tertiary font-semibold">상관계수/η²</th>
                  <th className="text-right py-2 text-text-tertiary font-semibold">p-value</th>
                  <th className="text-right py-2 text-text-tertiary font-semibold">n</th>
                  <th className="text-center py-2 text-text-tertiary font-semibold">유의성</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((item, i) => {
                  const v = data.variables.find((vv) => vv.id === item.id);
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-border/50 hover:bg-slate-50 cursor-pointer"
                      onClick={() =>
                        setSelectedNode((prev) =>
                          prev === item.id ? null : item.id
                        )
                      }
                    >
                      <td className="py-2.5 text-text-tertiary">{i + 1}</td>
                      <td className="py-2.5">
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: v?.color || "#9CA3AF" }}
                          />
                          <span className="font-medium text-text-primary">{item.label}</span>
                          {v?.lowSample && (
                            <span className="text-[9px] font-bold text-amber-500 bg-amber-50 border border-amber-200 px-1 py-0 rounded-full">
                              표본 부족
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 text-text-secondary">
                        {GROUP_LABELS[v?.group || ""] || v?.group}
                      </td>
                      <td className="py-2.5 text-right font-bold text-text-primary tabular-nums">
                        {item.absEffect.toFixed(3)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        <span
                          className={`font-bold ${
                            item.metric === "eta_squared"
                              ? "text-purple-600"
                              : item.r >= 0
                              ? "text-emerald-600"
                              : "text-red-500"
                          }`}
                        >
                          {item.metric === "eta_squared"
                            ? `η²=${(item.r ** 2).toFixed(3)}`
                            : `${item.r >= 0 ? "+" : ""}${item.r.toFixed(3)}`}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-text-secondary tabular-nums">
                        {v?.p != null
                          ? v.p < 0.001
                            ? "<0.001"
                            : v.p.toFixed(3)
                          : "—"}
                      </td>
                      <td className="py-2.5 text-right text-text-secondary tabular-nums">
                        {item.n}
                      </td>
                      <td className="py-2.5 text-center">
                        {item.significant ? (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            유의
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">
                            참고
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[11px] text-text-tertiary space-y-0.5">
            <p className="m-0">* 실선 = 통계적 유의 (p&lt;0.05 또는 η²&gt;0.06), 점선 = 참고용</p>
            <p className="m-0">* 효과 크기: |r| 또는 &radic;(η²) — 값이 클수록 판매량과 강한 관계</p>
          </div>
        </div>

        {/* 상관관계 매트릭스 테이블 */}
        <div className="bg-surface-raised rounded-xl p-6 border border-border">
          <h2 className="text-[15px] font-bold text-text-primary m-0 mb-4">
            상관관계 매트릭스 (판매량 기준)
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {data.matrix.map((m) => {
              const r = m.r ?? 0;
              const absR = Math.abs(r);
              const bgIntensity = Math.round(absR * 100);
              const bgColor =
                m.metric === "eta_squared"
                  ? `rgba(167, 139, 250, ${absR * 0.3})`
                  : r > 0
                  ? `rgba(16, 185, 129, ${absR * 0.3})`
                  : `rgba(239, 68, 68, ${absR * 0.3})`;

              return (
                <div
                  key={m.variable}
                  className="rounded-lg p-3 border border-border/50 cursor-pointer hover:shadow-md transition-shadow"
                  style={{ background: bgColor }}
                  onClick={() =>
                    setSelectedNode((prev) =>
                      prev === m.variable ? null : m.variable
                    )
                  }
                >
                  <div className="text-[12px] font-bold text-text-primary mb-1">
                    {m.label}
                  </div>
                  <div
                    className={`text-[20px] font-extrabold tabular-nums ${
                      m.metric === "eta_squared"
                        ? "text-purple-700"
                        : r >= 0
                        ? "text-emerald-700"
                        : "text-red-600"
                    }`}
                  >
                    {m.metric === "eta_squared"
                      ? `η²=${(r ** 2).toFixed(2)}`
                      : `${r >= 0 ? "+" : ""}${r.toFixed(2)}`}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-text-tertiary">n={m.n}</span>
                    {m.significant ? (
                      <span className="text-[9px] font-bold text-emerald-600">유의</span>
                    ) : (
                      <span className="text-[9px] font-bold text-slate-400">참고</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
