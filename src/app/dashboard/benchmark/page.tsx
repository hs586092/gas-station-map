"use client";

import { useState, useEffect } from "react";
import DetailHeader from "../_components/DetailHeader";

const STATION_ID = "A0003453";

interface BenchmarkTier {
  label: string;
  avg: number;
  min: number;
  max: number;
  count: number;
  rank: number;
  percentile: number;
  q1: number;
  median: number;
  q3: number;
}

interface PopulationTier extends BenchmarkTier {
  level: string;
  districts: string[];
}

interface BenchmarkData {
  station: {
    id: string; name: string; brand: string;
    district: string | null; road_rank: string | null;
    road_rank_label: string | null;
    price: number; fuel_type: string;
  };
  benchmarks: {
    district: (BenchmarkTier & { label: string }) | null;
    brand: (BenchmarkTier & { label: string }) | null;
    road_rank: (BenchmarkTier & { label: string }) | null;
    overall: BenchmarkTier & { label: string };
    population: (PopulationTier & { label: string }) | null;
  };
  distribution: {
    prices: number[];
    myPrice: number;
    source: string;
  };
}

export default function BenchmarkPage() {
  const [gasoline, setGasoline] = useState<BenchmarkData | null>(null);
  const [diesel, setDiesel] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFuel, setSelectedFuel] = useState<"gasoline" | "diesel">("gasoline");

  useEffect(() => {
    Promise.all([
      fetch(`/api/stations/${STATION_ID}/benchmark?fuel=gasoline`).then((r) => r.json()),
      fetch(`/api/stations/${STATION_ID}/benchmark?fuel=diesel`).then((r) => r.json()),
    ]).then(([gasData, dieselData]) => {
      setGasoline(gasData);
      setDiesel(dieselData);
      setLoading(false);
    });
  }, []);

  const data = selectedFuel === "gasoline" ? gasoline : diesel;

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-surface">
        <DetailHeader title="적정가 벤치마크" description="다양한 기준으로 내 가격 위치 분석" />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-border border-t-emerald rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const myPrice = data.station.price;
  const allBenchmarks = [
    data.benchmarks.district,
    data.benchmarks.brand,
    data.benchmarks.road_rank,
    data.benchmarks.overall,
    data.benchmarks.population,
  ].filter(Boolean) as (BenchmarkTier & { label: string })[];

  // 히스토그램 데이터
  const distribution = data.distribution;
  const binCount = 15;
  const dMin = distribution.prices[0];
  const dMax = distribution.prices[distribution.prices.length - 1];
  const binSize = Math.max(Math.ceil((dMax - dMin) / binCount), 1);
  const bins: { start: number; end: number; count: number; hasMe: boolean }[] = [];
  for (let i = 0; i < binCount; i++) {
    const start = dMin + i * binSize;
    const end = start + binSize;
    const count = distribution.prices.filter((p) => p >= start && (i === binCount - 1 ? p <= end : p < end)).length;
    const hasMe = myPrice >= start && (i === binCount - 1 ? myPrice <= end : myPrice < end);
    bins.push({ start, end, count, hasMe });
  }
  const maxBinCount = Math.max(...bins.map((b) => b.count), 1);

  // 적정가 범위 계산 (Q1 ~ Q3 기준)
  const refBenchmark = data.benchmarks.district || data.benchmarks.overall;
  const fairMin = refBenchmark.q1;
  const fairMax = refBenchmark.q3;
  const fairMedian = refBenchmark.median;

  return (
    <div className="min-h-screen bg-surface h-screen overflow-y-auto">
      <DetailHeader title="적정가 벤치마크" description="셀프광장주유소 · 다양한 비교 기준으로 내 가격 위치 분석" />

      <main className="px-5 pb-10">
        {/* 유종 선택 */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setSelectedFuel("gasoline")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
              selectedFuel === "gasoline" ? "bg-coral text-white border-coral" : "bg-surface-raised text-slate-800 border-border"
            }`}
          >
            휘발유
          </button>
          <button
            onClick={() => setSelectedFuel("diesel")}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium border transition-colors cursor-pointer ${
              selectedFuel === "diesel" ? "bg-navy text-white border-navy" : "bg-surface-raised text-slate-800 border-border"
            }`}
          >
            경유
          </button>
        </div>

        {/* 적정가 범위 카드 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="text-[16px] font-bold text-slate-900 mb-1">적정 가격 범위</div>
          <div className="text-[13px] text-slate-800 mb-4">{refBenchmark.label} 기준 Q1~Q3 범위</div>

          {/* 범위 시각화 */}
          <div className="relative h-12 mb-3">
            {/* 전체 바 */}
            <div className="absolute top-4 left-0 right-0 h-4 bg-slate-100 rounded-full" />
            {/* 적정 범위 */}
            {(() => {
              const range = dMax - dMin || 1;
              const left = ((fairMin - dMin) / range) * 100;
              const width = ((fairMax - fairMin) / range) * 100;
              const myPos = ((myPrice - dMin) / range) * 100;
              return (
                <>
                  <div
                    className="absolute top-4 h-4 bg-emerald-light border border-emerald rounded-full"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  {/* 내 위치 마커 */}
                  <div
                    className="absolute top-1 flex flex-col items-center"
                    style={{ left: `${myPos}%`, transform: "translateX(-50%)" }}
                  >
                    <div className="text-[12px] font-bold text-emerald mb-0.5">나</div>
                    <div className="w-3 h-3 rounded-full bg-emerald border-2 border-white shadow-sm" />
                    <div className="w-0.5 h-3 bg-emerald" />
                  </div>
                </>
              );
            })()}
          </div>
          <div className="flex justify-between text-[12px] text-slate-700 mb-4">
            <span>{dMin.toLocaleString()}원</span>
            <span>{dMax.toLocaleString()}원</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-[12px] text-slate-800 mb-1">Q1 (하위 25%)</div>
              <div className="text-[16px] font-bold text-blue-600">{fairMin.toLocaleString()}</div>
            </div>
            <div className="bg-emerald-light rounded-xl p-3">
              <div className="text-[12px] text-slate-800 mb-1">중앙값</div>
              <div className="text-[16px] font-bold text-emerald">{fairMedian.toLocaleString()}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-3">
              <div className="text-[12px] text-slate-800 mb-1">Q3 (상위 25%)</div>
              <div className="text-[16px] font-bold text-coral">{fairMax.toLocaleString()}</div>
            </div>
          </div>

          {/* 내 가격 판정 */}
          <div className={`mt-4 rounded-lg px-4 py-3 text-[13px] font-medium ${
            myPrice < fairMin ? "bg-blue-50 text-blue-700"
              : myPrice > fairMax ? "bg-red-50 text-red-700"
              : "bg-emerald-light text-emerald"
          }`}>
            {myPrice < fairMin
              ? `내 가격 ${myPrice.toLocaleString()}원은 적정 범위(${fairMin.toLocaleString()}~${fairMax.toLocaleString()}) 이하입니다. 가격 경쟁력이 높지만 수익성 점검이 필요합니다.`
              : myPrice > fairMax
              ? `내 가격 ${myPrice.toLocaleString()}원은 적정 범위(${fairMin.toLocaleString()}~${fairMax.toLocaleString()}) 이상입니다. 경쟁력 확보를 위한 가격 조정을 고려해보세요.`
              : `내 가격 ${myPrice.toLocaleString()}원은 적정 범위(${fairMin.toLocaleString()}~${fairMax.toLocaleString()}) 안에 있습니다. 적절한 가격대를 유지하고 있습니다.`}
          </div>
        </div>

        {/* 히스토그램 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="text-[16px] font-bold text-slate-900 mb-1">가격 분포 히스토그램</div>
          <div className="text-[13px] text-slate-800 mb-4">{distribution.source} · {distribution.prices.length}개</div>
          <div className="flex items-end gap-1 h-40">
            {bins.map((bin, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                <div className="text-[8px] text-slate-700 mb-1">
                  {bin.count > 0 ? bin.count : ""}
                </div>
                <div
                  className={`w-full rounded-t transition-all ${bin.hasMe ? "bg-emerald" : "bg-slate-200"}`}
                  style={{ height: `${(bin.count / maxBinCount) * 130}px`, minHeight: bin.count > 0 ? 4 : 0 }}
                />
                {bin.hasMe && (
                  <div className="text-[8px] font-bold text-emerald mt-0.5">▲</div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[12px] text-slate-700">
            <span>{dMin.toLocaleString()}</span>
            <span>{Math.round((dMin + dMax) / 2).toLocaleString()}</span>
            <span>{dMax.toLocaleString()}</span>
          </div>
        </div>

        {/* 5축 벤치마크 비교 */}
        <div className="bg-surface-raised rounded-xl p-5 border border-border mb-6">
          <div className="text-[16px] font-bold text-slate-900 mb-4">다축 벤치마크 비교</div>
          <div className="space-y-4">
            {allBenchmarks.map((bm, i) => {
              const diff = myPrice - bm.avg;
              const diffColor = diff <= -30 ? "text-blue-600" : diff >= 30 ? "text-coral" : "text-emerald";
              const diffLabel = diff <= -30 ? "저렴" : diff >= 30 ? "비쌈" : "평균";
              return (
                <div key={i} className="border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-[13px] font-bold text-slate-900">{bm.label}</div>
                      <div className="text-[12px] text-slate-700">{bm.count}개 중 {bm.rank}위 · 상위 {bm.percentile}%</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[18px] font-extrabold ${diffColor}`}>
                        {diff > 0 ? "+" : ""}{diff}원
                      </div>
                      <div className={`text-[13px] font-medium ${diffColor}`}>{diffLabel}</div>
                    </div>
                  </div>

                  {/* 가격 범위 바 */}
                  <div className="relative h-6 mt-2">
                    <div className="absolute top-2.5 left-0 right-0 h-1.5 bg-slate-100 rounded-full" />
                    {/* Q1~Q3 범위 */}
                    {(() => {
                      const range = bm.max - bm.min || 1;
                      const q1Pos = ((bm.q1 - bm.min) / range) * 100;
                      const q3Pos = ((bm.q3 - bm.min) / range) * 100;
                      const myPos = Math.max(0, Math.min(100, ((myPrice - bm.min) / range) * 100));
                      const avgPos = ((bm.avg - bm.min) / range) * 100;
                      return (
                        <>
                          <div
                            className="absolute top-2.5 h-1.5 bg-slate-200 rounded-full"
                            style={{ left: `${q1Pos}%`, width: `${q3Pos - q1Pos}%` }}
                          />
                          {/* 평균 마커 */}
                          <div
                            className="absolute top-1.5 w-0.5 h-3.5 bg-text-tertiary"
                            style={{ left: `${avgPos}%` }}
                          />
                          {/* 내 위치 */}
                          <div
                            className="absolute top-1 w-2.5 h-2.5 rounded-full bg-emerald border-2 border-white shadow-sm"
                            style={{ left: `${myPos}%`, transform: "translateX(-50%)" }}
                          />
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex justify-between text-[12px] text-slate-700 mt-1">
                    <span>최저 {bm.min.toLocaleString()}</span>
                    <span>평균 {bm.avg.toLocaleString()}</span>
                    <span>최고 {bm.max.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 유동인구 비교 (있는 경우) */}
        {data.benchmarks.population && (
          <div className="bg-surface-raised rounded-xl p-5 border border-border">
            <div className="text-[16px] font-bold text-slate-900 mb-2">유동인구 유사 지역 비교</div>
            <div className="text-[13px] text-slate-800 mb-3">
              유동인구 {(data.benchmarks.population as PopulationTier).level} 수준 · {(data.benchmarks.population as PopulationTier).districts.join(", ")}
            </div>
            <div className="bg-slate-50 rounded-lg px-4 py-3">
              <div className="text-[12px] text-slate-900">
                유동인구 수준이 비슷한 지역({(data.benchmarks.population as PopulationTier).districts.length}개 구)의 평균가는{" "}
                <strong>{data.benchmarks.population.avg.toLocaleString()}원</strong>이며,
                내 가격은 {data.benchmarks.population.count}개 중 <strong>{data.benchmarks.population.rank}위</strong>입니다.
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
