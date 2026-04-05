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
} from "recharts";

interface PriceData {
  date: string;
  gasoline: number | null;
  diesel: number | null;
  premium: number | null;
}

interface PriceChartProps {
  stationId: string;
  stationName: string;
  onClose: () => void;
}

export default function PriceChart({
  stationId,
  stationName,
  onClose,
}: PriceChartProps) {
  const [data, setData] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/price-history/${stationId}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.history && json.history.length > 0) {
          setData(
            json.history.map((d: PriceData) => ({
              ...d,
              date: d.date.slice(5),
            }))
          );
        } else {
          setError("가격 추이 데이터가 없습니다.\n수집 후 확인 가능합니다.");
        }
      } catch {
        if (!cancelled) setError("데이터를 불러오는데 실패했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [stationId]);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-[20px] w-full max-w-[560px] max-h-[80vh] overflow-auto"
        style={{ boxShadow: "var(--shadow-xl)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 pt-6 pb-0">
          <div>
            <h2 className="text-[17px] font-bold text-text-primary m-0">가격 추이</h2>
            <p className="text-[12px] text-text-tertiary mt-0.5 m-0">{stationName} · 최근 30일</p>
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
            <div className="w-2.5 h-2.5 rounded-full bg-coral" />
            <span className="text-[11px] text-text-secondary font-medium">휘발유</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-navy" />
            <span className="text-[11px] text-text-secondary font-medium">경유</span>
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
              <p className="text-[13px] text-text-tertiary whitespace-pre-line text-center m-0">{error}</p>
            </div>
          )}

          {!loading && !error && data.length > 0 && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#26282F" vertical={false} />
                <XAxis
                  dataKey="date"
                  fontSize={11}
                  tick={{ fill: "#9BA8B7" }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: "#26282F" }}
                  tickLine={false}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "#9BA8B7" }}
                  domain={["dataMin - 20", "dataMax + 20"]}
                  tickFormatter={(v: number) => v.toLocaleString()}
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value).toLocaleString()}원`,
                    name,
                  ]}
                  labelStyle={{ fontWeight: 600, color: "#1B2838", fontSize: 12 }}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #E8EBF0",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    padding: "8px 12px",
                    fontSize: 12,
                  }}
                  itemStyle={{ padding: "2px 0" }}
                />
                <Line
                  type="monotone"
                  dataKey="gasoline"
                  name="휘발유"
                  stroke="#FF5252"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: "#FF5252" }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="diesel"
                  name="경유"
                  stroke="#1B2838"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: "#1B2838" }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
