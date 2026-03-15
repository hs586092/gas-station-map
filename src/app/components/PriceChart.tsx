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
              date: d.date.slice(5), // "MM-DD" 형태로 표시
            }))
          );
        } else {
          setError("가격 추이 데이터가 없습니다.\n수집 API를 먼저 실행해주세요.");
        }
      })
      .catch(() => setError("데이터를 불러오는데 실패했습니다."))
      .finally(() => setLoading(false));
  }, [stationId]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 24,
          width: "100%",
          maxWidth: 600,
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 20,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "bold" }}>
              가격 추이
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#888" }}>
              {stationName} · 최근 30일
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#999",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* 차트 */}
        {loading && (
          <p style={{ textAlign: "center", color: "#aaa", padding: 40 }}>
            로딩 중...
          </p>
        )}

        {error && (
          <p
            style={{
              textAlign: "center",
              color: "#999",
              padding: 40,
              whiteSpace: "pre-line",
              fontSize: 14,
            }}
          >
            {error}
          </p>
        )}

        {!loading && !error && data.length > 0 && (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                fontSize={11}
                tick={{ fill: "#888" }}
                interval="preserveStartEnd"
              />
              <YAxis
                fontSize={11}
                tick={{ fill: "#888" }}
                domain={["dataMin - 20", "dataMax + 20"]}
                tickFormatter={(v: number) => v.toLocaleString()}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value).toLocaleString()}원`,
                  name,
                ]}
                labelStyle={{ fontWeight: "bold" }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="gasoline"
                name="휘발유"
                stroke="#e53e3e"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="diesel"
                name="경유"
                stroke="#3182ce"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
