import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  const supabase = createServiceClient();

  // 1. 가장 최근 날짜 조회
  const { data: latest, error: latestError } = await supabase
    .from("population_data")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (latestError || !latest) {
    return NextResponse.json(
      { error: "데이터가 없습니다" },
      { status: 404 }
    );
  }

  const targetDate = latest.date;

  // 2. 해당 날짜의 전체 데이터 조회 (25구 × 24시간 = 600행)
  const { data, error } = await supabase
    .from("population_data")
    .select("adm_nm, hour, total_pop")
    .eq("date", targetDate)
    .order("adm_nm")
    .order("hour");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: `${targetDate} 데이터가 없습니다` },
      { status: 404 }
    );
  }

  // 3. 히트맵 데이터 구성
  let maxPopulation = 0;
  let minPopulation = Infinity;

  const heatmap = data.map((row) => {
    const pop = row.total_pop || 0;
    if (pop > maxPopulation) maxPopulation = pop;
    if (pop < minPopulation) minPopulation = pop;
    return {
      district: row.adm_nm,
      hour: row.hour,
      population: pop,
    };
  });

  // 4. 자치구 목록 (총 인구 내림차순)
  const districtTotals: Record<string, number> = {};
  for (const row of heatmap) {
    districtTotals[row.district] = (districtTotals[row.district] || 0) + row.population;
  }
  const districts = Object.entries(districtTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  return NextResponse.json(
    {
      heatmap,
      date: targetDate,
      districts,
      maxPopulation,
      minPopulation,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
      },
    }
  );
}
