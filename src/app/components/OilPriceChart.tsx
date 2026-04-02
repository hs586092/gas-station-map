"use client";

import { useState, useEffect } from "react";
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

interface OilPrice {
  date: string;
  wti: number | null;
  brent: number | null;
}

interface OilPriceChartProps {
  onClose: () => void;
}

export default function OilPriceChart({ onClose }: OilPriceChartProps) {
  const [data, setData] = useState<OilPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/oil-prices?days=60");
        const json = await res.json();
        if (cancelled) return;
        if (json.prices?.length > 0) {
          setData(
            json.prices.map((p: OilPrice) => ({
              ...p,
              date: p.date.slice(5), // "MM-DD"
            }))
          );
        } else {
          setError("유가 데이터가 없습니다.");
        }
      } catch {
        if (!cancelled) setError("데이터를 불러오는데 실패했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // 2주 전 세로선 위치
  const twoWeeksAgoIdx = data.length > 0
    ? Math.max(0, data.length - 11) // 약 14영업일 ≈ 10~11 데이터포인트
    : -1;
  const twoWeeksAgoDate = twoWeeksAgoIdx >= 0 ? data[twoWeeksAgoIdx]?.date : null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[20px] w-full max-w-[600px] max-h-[80vh] overflow-auto"
        style={{ boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 pt-6 pb-0">
          <div>
            <h2 className="text-[17px] font-bold text-text-primary m-0">국제유가 추이</h2>
            <p className="text-[12px] text-text-tertiary mt-0.5 m-0">최근 60일 · EIA 기준</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[10px] hover:bg-surface bg-transparent border-none cursor-pointer transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 범례 */}
        <div className="flex items-center gap-4 px-6 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#f97316" }} />
            <span className="text-[11px] text-text-secondary font-medium">WTI</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#3b82f6" }} />
            <span className="text-[11px] text-text-secondary font-medium">Brent (Dubai유 참고)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-px border-t-2 border-dashed border-red-300" />
            <span className="text-[11px] text-text-tertiary">2주 전</span>
          </div>
        </div>

        {/* 차트 */}
        <div className="px-4 pb-6 pt-2">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-border border-t-emerald rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" className="mb-3">
                <path d="M3 3v18h18" /><path d="m7 14 4-4 4 4 5-5" />
              </svg>
              <p className="text-[13px] text-text-tertiary text-center m-0">{error}</p>
            </div>
          )}

          {!loading && !error && data.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false} />
                <XAxis
                  dataKey="date"
                  fontSize={11}
                  tick={{ fill: "#9BA8B7" }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: "#E8EBF0" }}
                  tickLine={false}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "#9BA8B7" }}
                  domain={["dataMin - 5", "dataMax + 5"]}
                  tickFormatter={(v: number) => `$${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `$${Number(value).toFixed(2)}/BBL`,
                    name === "wti" ? "WTI" : "Brent",
                  ]}
                  labelFormatter={(label) => `날짜: ${label}`}
                  labelStyle={{ fontWeight: 600, color: "#1B2838", fontSize: 12 }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E8EBF0",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    padding: "8px 12px",
                    fontSize: 12,
                  }}
                />
                {twoWeeksAgoDate && (
                  <ReferenceLine
                    x={twoWeeksAgoDate}
                    stroke="#fca5a5"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{ value: "2주 전", position: "top", fontSize: 10, fill: "#ef4444" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="wti"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  name="wti"
                />
                <Line
                  type="monotone"
                  dataKey="brent"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="brent"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 하단 설명 */}
        <div className="px-6 pb-5">
          <div className="bg-slate-50 rounded-[10px] px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed">
            국제유가 변동은 약 <strong className="text-slate-700">2주 후</strong> 주유소 소매가에 반영됩니다.
            빨간 점선(2주 전) 기준의 유가가 현재 소매가에 영향을 주는 시점입니다.
          </div>
        </div>
      </div>
    </div>
  );
}
