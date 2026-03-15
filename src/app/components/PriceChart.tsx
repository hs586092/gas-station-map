"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
    setLoading(true);
    setError(null);

    fetch(`/api/price-history/${stationId}`)
      .then((res) => res.json())
      .then((json) => {
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
      })
      .catch(() => setError("데이터를 불러오는데 실패했습니다."))
      .finally(() => setLoading(false));
  }, [stationId]);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[600px] max-h-[80vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex justify-between items-start p-5 pb-0">
          <div>
            <h2 className="text-[17px] font-bold text-gray-900 m-0">
              가격 추이
            </h2>
            <p className="text-[12px] text-gray-400 mt-1">
              {stationName} · 최근 30일
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors border-none cursor-pointer text-gray-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 차트 */}
        <div className="p-5">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-navy rounded-full animate-spin" />
            </div>
          )}

          {error && (
            <p className="text-center text-gray-400 py-16 whitespace-pre-line text-[13px]">
              {error}
            </p>
          )}

          {!loading && !error && data.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  fontSize={11}
                  tick={{ fill: "#94a3b8" }}
                  interval="preserveStartEnd"
                  axisLine={{ stroke: "#e2e8f0" }}
                  tickLine={false}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "#94a3b8" }}
                  domain={["dataMin - 20", "dataMax + 20"]}
                  tickFormatter={(v: number) => v.toLocaleString()}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value, name) => [
                    `${Number(value).toLocaleString()}원`,
                    name,
                  ]}
                  labelStyle={{ fontWeight: "bold", color: "#1a2332" }}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
                />
                <Line
                  type="monotone"
                  dataKey="gasoline"
                  name="휘발유"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "#f59e0b" }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="diesel"
                  name="경유"
                  stroke="#1a2332"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "#1a2332" }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
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
