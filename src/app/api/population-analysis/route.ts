import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

interface StationRow {
  id: string;
  district: string;
  gasoline_price: number | null;
  diesel_price: number | null;
}

interface PopRow {
  hour: number;
  adm_nm: string;
  total_pop: number;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export async function GET() {
  const supabase = createServiceClient();

  // 1. 서울 주유소 가져오기 (district 컬럼 사용, 경기도 제외)
  const { data: allStations, error: stErr } = await supabase
    .from("stations")
    .select("id, district, gasoline_price, diesel_price")
    .not("district", "is", null)
    .neq("district", "경기도");

  if (stErr) {
    return NextResponse.json({ error: stErr.message }, { status: 500 });
  }

  const seoulStations = allStations as StationRow[];

  // 2. population_data에서 최근 날짜 데이터
  const { data: latestDate } = await supabase
    .from("population_data")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (!latestDate) {
    return NextResponse.json(
      { error: "인구 데이터가 없습니다. /api/collect-population을 먼저 실행해주세요." },
      { status: 404 }
    );
  }

  const { data: popData, error: popErr } = await supabase
    .from("population_data")
    .select("hour, adm_nm, total_pop")
    .eq("date", latestDate.date);

  if (popErr) {
    return NextResponse.json({ error: popErr.message }, { status: 500 });
  }

  // 3. 자치구별 인구 분석
  const popByDistrict: Record<string, PopRow[]> = {};
  for (const row of popData as PopRow[]) {
    if (!popByDistrict[row.adm_nm]) popByDistrict[row.adm_nm] = [];
    popByDistrict[row.adm_nm].push(row);
  }

  // 4. 자치구별 주유소 집계
  const stationsByDistrict: Record<string, StationRow[]> = {};
  for (const s of seoulStations) {
    if (!stationsByDistrict[s.district]) stationsByDistrict[s.district] = [];
    stationsByDistrict[s.district].push(s);
  }

  // 5. 서울 전체 평균 휘발유가
  const allGasolinePrices = seoulStations
    .map((s) => s.gasoline_price)
    .filter((p): p is number => p != null && p > 0);
  const avgGasolineSeoul =
    allGasolinePrices.length > 0
      ? Math.round(allGasolinePrices.reduce((a, b) => a + b, 0) / allGasolinePrices.length)
      : 0;

  // 6. 자치구별 분석 결합
  const allDistricts = new Set([
    ...Object.keys(popByDistrict),
    ...Object.keys(stationsByDistrict),
  ]);

  const correlationPops: number[] = [];
  const correlationPrices: number[] = [];

  const analysis = Array.from(allDistricts)
    .map((district) => {
      const popRows = popByDistrict[district] || [];
      const hourlyPops = popRows.map((r) => ({ hour: r.hour, pop: r.total_pop }));
      hourlyPops.sort((a, b) => b.pop - a.pop);

      const peakHour = hourlyPops.length > 0 ? hourlyPops[0].hour : 0;
      const peakPop = hourlyPops.length > 0 ? hourlyPops[0].pop : 0;
      const avgPop =
        popRows.length > 0
          ? Math.round(popRows.reduce((s, r) => s + r.total_pop, 0) / popRows.length)
          : 0;
      const nightRows = popRows.filter((r) => r.hour >= 0 && r.hour <= 6);
      const nightPop =
        nightRows.length > 0
          ? Math.round(nightRows.reduce((s, r) => s + r.total_pop, 0) / nightRows.length)
          : 0;

      const stations = stationsByDistrict[district] || [];
      const gasPrices = stations
        .map((s) => s.gasoline_price)
        .filter((p): p is number => p != null && p > 0);
      const dieselPrices = stations
        .map((s) => s.diesel_price)
        .filter((p): p is number => p != null && p > 0);

      const avgGasoline =
        gasPrices.length > 0
          ? Math.round(gasPrices.reduce((a, b) => a + b, 0) / gasPrices.length)
          : 0;
      const avgDiesel =
        dieselPrices.length > 0
          ? Math.round(dieselPrices.reduce((a, b) => a + b, 0) / dieselPrices.length)
          : 0;
      const minGasoline = gasPrices.length > 0 ? Math.min(...gasPrices) : 0;
      const maxGasoline = gasPrices.length > 0 ? Math.max(...gasPrices) : 0;

      const popPerStation = stations.length > 0 ? Math.round(avgPop / stations.length) : 0;
      const priceVsAvg = avgGasoline > 0 ? avgGasoline - avgGasolineSeoul : 0;

      let competitionLevel: string;
      if (popPerStation < 15000) competitionLevel = "very_high";
      else if (popPerStation < 25000) competitionLevel = "high";
      else if (popPerStation < 40000) competitionLevel = "medium";
      else competitionLevel = "low";

      if (avgPop > 0 && avgGasoline > 0) {
        correlationPops.push(avgPop);
        correlationPrices.push(avgGasoline);
      }

      return {
        district,
        population: {
          peak_hour: peakHour,
          peak_pop: peakPop,
          avg_pop: avgPop,
          night_pop: nightPop,
        },
        gasStation: {
          count: stations.length,
          avg_gasoline: avgGasoline,
          avg_diesel: avgDiesel,
          min_gasoline: minGasoline,
          max_gasoline: maxGasoline,
        },
        insight: {
          pop_per_station: popPerStation,
          price_vs_avg: priceVsAvg,
          competition_level: competitionLevel,
        },
      };
    })
    .sort((a, b) => b.population.avg_pop - a.population.avg_pop);

  const correlation = parseFloat(
    pearsonCorrelation(correlationPops, correlationPrices).toFixed(4)
  );

  return NextResponse.json(
    {
      analysis,
      summary: {
        total_districts: allDistricts.size,
        total_stations: seoulStations.length,
        avg_gasoline_seoul: avgGasolineSeoul,
        correlation,
        correlation_meaning:
          correlation > 0.3
            ? "유동인구가 많을수록 주유가격이 높은 경향"
            : correlation < -0.3
              ? "유동인구가 많을수록 주유가격이 낮은 경향"
              : "유동인구와 주유가격 간 뚜렷한 상관관계 없음",
        date: latestDate.date,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
