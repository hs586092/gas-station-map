import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createServiceClient } from "@/lib/supabase";

interface StationRow {
  id: string;
  district: string | null;
  brand: string | null;
  road_rank: string | null;
  gasoline_price: number | null;
  diesel_price: number | null;
}

interface PopRow {
  adm_nm: string;
  total_pop: number;
}

function calcStats(
  prices: number[],
  myPrice: number
): {
  avg: number;
  min: number;
  max: number;
  count: number;
  rank: number;
  percentile: number;
  q1: number;
  median: number;
  q3: number;
} {
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / n);
  // rank: 가격 오름차순, 1 = 최저가
  const rank = sorted.filter((p) => p < myPrice).length + 1;
  // percentile: 나보다 싼 주유소의 비율 (100이면 가장 비쌈)
  const percentile = Math.round(((rank - 1) / n) * 100);

  const q1 = sorted[Math.floor(n * 0.25)];
  const median = sorted[Math.floor(n * 0.5)];
  const q3 = sorted[Math.floor(n * 0.75)];

  return {
    avg,
    min: sorted[0],
    max: sorted[n - 1],
    count: n,
    rank,
    percentile,
    q1,
    median,
    q3,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const fuelType = searchParams.get("fuel") || "gasoline";

  // 1. 기준 주유소 조회
  const { data: base, error: baseError } = await supabase
    .from("stations")
    .select(
      "id, name, brand, district, road_rank, gasoline_price, diesel_price"
    )
    .eq("id", id)
    .single();

  if (baseError || !base) {
    return NextResponse.json(
      { error: "주유소를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const myPrice =
    fuelType === "diesel" ? base.diesel_price : base.gasoline_price;

  if (!myPrice || myPrice <= 0) {
    return NextResponse.json(
      { error: "해당 주유소의 가격 정보가 없습니다." },
      { status: 400 }
    );
  }

  // 2. district가 있는 전체 주유소 조회 (서울 + 경기)
  const { data: allDistrictStations, error: districtError } = await supabase
    .from("stations")
    .select("id, district, brand, road_rank, gasoline_price, diesel_price")
    .not("district", "is", null);

  if (districtError || !allDistrictStations) {
    return NextResponse.json(
      { error: "주유소 데이터 조회 실패" },
      { status: 500 }
    );
  }

  const stations = allDistrictStations as StationRow[];

  // 가격이 유효한 주유소만 필터
  const validStations = stations.filter((s) => {
    const p = fuelType === "diesel" ? s.diesel_price : s.gasoline_price;
    return p != null && p > 0;
  });

  const getPrice = (s: StationRow) =>
    fuelType === "diesel" ? s.diesel_price! : s.gasoline_price!;

  // 3. 비교 축별 계산

  // 3-1. 같은 자치구
  const districtGroup = base.district
    ? validStations.filter((s) => s.district === base.district)
    : [];
  const districtBenchmark =
    districtGroup.length >= 2
      ? calcStats(districtGroup.map(getPrice), myPrice)
      : null;

  // 3-2. 같은 브랜드 (서울 전체)
  const brandGroup = base.brand
    ? validStations.filter((s) => s.brand === base.brand)
    : [];
  const brandBenchmark =
    brandGroup.length >= 2
      ? calcStats(brandGroup.map(getPrice), myPrice)
      : null;

  // 3-3. 같은 도로등급 (서울 전체)
  const roadRankGroup = base.road_rank
    ? validStations.filter((s) => s.road_rank === base.road_rank)
    : [];
  const roadRankBenchmark =
    roadRankGroup.length >= 2
      ? calcStats(roadRankGroup.map(getPrice), myPrice)
      : null;

  // 3-4. 서울 전체 평균
  const overallBenchmark = calcStats(
    validStations.map(getPrice),
    myPrice
  );

  // 3-5. 유동인구 유사 지역 (보너스)
  let populationBenchmark: (ReturnType<typeof calcStats> & {
    level: string;
    districts: string[];
  }) | null = null;

  if (base.district) {
    const serviceClient = createServiceClient();

    // 최근 인구 데이터 날짜
    const { data: latestDate } = await serviceClient
      .from("population_data")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (latestDate) {
      // 자치구별 평균 유동인구
      const { data: popData } = await serviceClient
        .from("population_data")
        .select("adm_nm, total_pop")
        .eq("date", latestDate.date);

      if (popData && popData.length > 0) {
        const popRows = popData as PopRow[];
        const districtAvgPop: Record<string, number> = {};
        const districtPopCounts: Record<string, number> = {};

        for (const row of popRows) {
          districtAvgPop[row.adm_nm] =
            (districtAvgPop[row.adm_nm] || 0) + row.total_pop;
          districtPopCounts[row.adm_nm] =
            (districtPopCounts[row.adm_nm] || 0) + 1;
        }

        for (const d of Object.keys(districtAvgPop)) {
          districtAvgPop[d] = Math.round(
            districtAvgPop[d] / districtPopCounts[d]
          );
        }

        const myPop = districtAvgPop[base.district];

        if (myPop) {
          // 유동인구 ±30% 범위의 자치구 찾기
          const similarDistricts = Object.entries(districtAvgPop)
            .filter(
              ([, pop]) =>
                pop >= myPop * 0.7 && pop <= myPop * 1.3
            )
            .map(([d]) => d);

          const popGroupStations = validStations.filter((s) =>
            similarDistricts.includes(s.district!)
          );

          // 유동인구 수준 판정
          const allPops = Object.values(districtAvgPop).sort(
            (a, b) => a - b
          );
          const popPercentile =
            allPops.filter((p) => p < myPop).length / allPops.length;
          const level =
            popPercentile >= 0.67
              ? "상"
              : popPercentile >= 0.33
                ? "중"
                : "하";

          if (popGroupStations.length >= 2) {
            populationBenchmark = {
              ...calcStats(popGroupStations.map(getPrice), myPrice),
              level,
              districts: similarDistricts,
            };
          }
        }
      }
    }
  }

  // 4. 포지셔닝 차트용 분포 데이터 (같은 자치구 기준)
  const distributionSource = districtGroup.length >= 2 ? districtGroup : validStations;
  const distributionPrices = distributionSource.map(getPrice).sort((a, b) => a - b);

  // 도로등급 라벨
  const roadRankLabels: Record<string, string> = {
    "101": "고속도로",
    "102": "도시고속도로",
    "103": "국도",
    "104": "특별/광역시도",
    "105": "국가지원지방도",
    "106": "지방도",
  };

  // 5. 응답
  return NextResponse.json(
    {
      station: {
        id: base.id,
        name: base.name,
        brand: base.brand,
        district: base.district,
        road_rank: base.road_rank,
        road_rank_label: base.road_rank
          ? roadRankLabels[base.road_rank] || base.road_rank
          : null,
        price: myPrice,
        fuel_type: fuelType,
      },
      benchmarks: {
        district: districtBenchmark
          ? {
              label: `${base.district} 평균`,
              ...districtBenchmark,
            }
          : null,
        brand: brandBenchmark
          ? {
              label: `${base.brand} 전체 평균`,
              ...brandBenchmark,
            }
          : null,
        road_rank: roadRankBenchmark
          ? {
              label: `${roadRankLabels[base.road_rank!] || base.road_rank} 평균`,
              ...roadRankBenchmark,
            }
          : null,
        overall: {
          label: "전체 평균",
          ...overallBenchmark,
        },
        population: populationBenchmark
          ? {
              label: `유동인구 ${populationBenchmark.level} 지역 평균`,
              ...populationBenchmark,
            }
          : null,
      },
      distribution: {
        prices: distributionPrices,
        myPrice,
        source:
          districtGroup.length >= 2
            ? `${base.district} 주유소`
            : "서울 전체 주유소",
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
