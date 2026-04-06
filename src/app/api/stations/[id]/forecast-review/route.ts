import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/stations/[id]/forecast-review
 *
 * 어제의 판매량 예측 vs 실제를 비교하고, 오차 원인을 분석한다.
 * - forecast_history에서 예측값
 * - sales_data에서 실제값
 * - price_history + weather_daily에서 오차 원인
 */

// ── Haversine ──
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // ── 1. forecast_history에서 최근 30일 예측 가져오기 ──
  const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: forecasts, error: fcErr } = await supabase
    .from("forecast_history")
    .select("*")
    .eq("station_id", id)
    .gte("forecast_date", thirtyAgo)
    .order("forecast_date", { ascending: false });

  if (fcErr || !forecasts || forecasts.length === 0) {
    return NextResponse.json(
      {
        status: "no_data",
        message: "예측 데이터 축적 중 — 내일부터 복기 시작",
        yesterday: null,
        accuracy: null,
        history: [],
      },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
    );
  }

  // ── 2. sales_data에서 같은 기간 실제값 가져오기 ──
  const { data: salesRows } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume, diesel_volume, gasoline_count, diesel_count")
    .eq("station_id", id)
    .gte("date", thirtyAgo)
    .order("date", { ascending: false });

  const salesMap = new Map<string, number>();
  const countMap = new Map<string, number>();
  for (const s of salesRows ?? []) {
    const vol = (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    const cnt = (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0);
    salesMap.set(s.date, vol);
    countMap.set(s.date, cnt);
  }

  // ── 3. forecast_history에 actual_volume + actual_count 업데이트 (lazy) ──
  for (const fc of forecasts) {
    const needsUpdate = (fc.actual_volume == null && salesMap.has(fc.forecast_date))
      || (fc.actual_count == null && countMap.has(fc.forecast_date));
    if (needsUpdate) {
      const updates: Record<string, number> = {};
      if (fc.actual_volume == null && salesMap.has(fc.forecast_date)) {
        const actual = salesMap.get(fc.forecast_date)!;
        fc.actual_volume = actual;
        updates.actual_volume = actual;
      }
      if (fc.actual_count == null && countMap.has(fc.forecast_date)) {
        const actualCnt = countMap.get(fc.forecast_date)!;
        fc.actual_count = actualCnt;
        updates.actual_count = actualCnt;
      }
      if (Object.keys(updates).length > 0) {
        supabase
          .from("forecast_history")
          .update(updates)
          .eq("id", fc.id)
          .then(() => {});
      }
    }
  }

  // ── 4. 어제 복기 데이터 ──
  const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const yesterdayFc = forecasts.find((f) => f.forecast_date === yesterdayStr);

  let yesterday: {
    date: string;
    predicted: number;
    actual: number | null;
    error: number | null;
    errorPct: number | null;
    predictedCount: number | null;
    actualCount: number | null;
    countErrorPct: number | null;
    causes: Array<{ type: string; icon: string; message: string }>;
  } | null = null;

  if (yesterdayFc) {
    const actual = yesterdayFc.actual_volume != null ? Number(yesterdayFc.actual_volume) : null;
    const predicted = Number(yesterdayFc.predicted_volume);
    const error = actual != null ? actual - predicted : null;
    const errorPct = actual != null && predicted > 0 ? +((error! / predicted) * 100).toFixed(1) : null;

    const predictedCount = yesterdayFc.predicted_count != null ? Number(yesterdayFc.predicted_count) : null;
    const actualCount = yesterdayFc.actual_count != null ? Number(yesterdayFc.actual_count) : null;
    const countErrorPct = predictedCount != null && actualCount != null && predictedCount > 0
      ? +(((actualCount - predictedCount) / predictedCount) * 100).toFixed(1) : null;

    // ── 5. 오차 원인 분석 ──
    const causes: Array<{ type: string; icon: string; message: string }> = [];

    // 5a. 내 가격 변동
    const dayBefore = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const { data: myPrices } = await supabase
      .from("price_history")
      .select("gasoline_price, collected_at")
      .eq("station_id", id)
      .in("collected_at", [yesterdayStr, dayBefore])
      .not("gasoline_price", "is", null)
      .order("collected_at", { ascending: true });

    // price_history의 collected_at이 YYYY-MM-DD 형태가 아닐 수 있으므로 날짜 부분만 비교
    const myPriceMap = new Map<string, number>();
    for (const p of myPrices ?? []) {
      myPriceMap.set(p.collected_at.slice(0, 10), p.gasoline_price);
    }
    const myYesterday = myPriceMap.get(yesterdayStr);
    const myDayBefore = myPriceMap.get(dayBefore);
    if (myYesterday && myDayBefore && myYesterday !== myDayBefore) {
      const diff = myYesterday - myDayBefore;
      causes.push({
        type: "my_price",
        icon: diff > 0 ? "🔴" : "🔵",
        message: `내 가격 ${diff > 0 ? "+" : ""}${diff}원 변동 → ${diff > 0 ? "수요 감소" : "수요 증가"} 가능`,
      });
    }

    // 5b. 경쟁사 가격 변동
    const { data: baseStation } = await supabase
      .from("stations")
      .select("lat, lng")
      .eq("id", id)
      .single();

    if (baseStation) {
      const RADIUS = 5;
      const latD = RADIUS / 111;
      const lngD = RADIUS / 88;
      const { data: compPrices } = await supabase
        .from("price_history")
        .select("station_id, station_name, gasoline_price, collected_at")
        .neq("station_id", id)
        .not("gasoline_price", "is", null)
        .gte("collected_at", dayBefore)
        .lte("collected_at", yesterdayStr + "T23:59:59")
        .order("collected_at", { ascending: true });

      // 경쟁사 5km 필터를 위해 stations 위치 조회
      const { data: nearbyStations } = await supabase
        .from("stations")
        .select("id, name, lat, lng")
        .gte("lat", baseStation.lat - latD)
        .lte("lat", baseStation.lat + latD)
        .gte("lng", baseStation.lng - lngD)
        .lte("lng", baseStation.lng + lngD)
        .neq("id", id);

      const nearbyIds = new Set(
        (nearbyStations ?? [])
          .filter((s) => haversineKm(baseStation.lat, baseStation.lng, s.lat, s.lng) <= RADIUS)
          .map((s) => s.id)
      );
      const nearbyNameMap = new Map((nearbyStations ?? []).map((s) => [s.id, s.name]));

      // 경쟁사별 어제 vs 그저께 가격 비교
      const compByStation = new Map<string, Map<string, number>>();
      for (const p of compPrices ?? []) {
        if (!nearbyIds.has(p.station_id)) continue;
        if (!compByStation.has(p.station_id)) compByStation.set(p.station_id, new Map());
        compByStation.get(p.station_id)!.set(p.collected_at.slice(0, 10), p.gasoline_price);
      }

      const bigChanges: Array<{ name: string; diff: number }> = [];
      for (const [sid, dateMap] of compByStation) {
        const y = dateMap.get(yesterdayStr);
        const db = dateMap.get(dayBefore);
        if (y && db && y !== db) {
          bigChanges.push({ name: nearbyNameMap.get(sid) ?? sid, diff: y - db });
        }
      }

      // 가장 큰 변동 2개까지만
      bigChanges.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      for (const c of bigChanges.slice(0, 2)) {
        causes.push({
          type: "competitor_price",
          icon: c.diff < 0 ? "🔴" : "🟡",
          message: `${c.name} ${c.diff > 0 ? "+" : ""}${c.diff}원 변동${c.diff < 0 ? " → 고객 이탈 가능" : ""}`,
        });
      }
    }

    // 5c. 날씨 예보 오차
    const { data: actualWeather } = await supabase
      .from("weather_daily")
      .select("precipitation_mm, temp_max, temp_min")
      .eq("date", yesterdayStr)
      .single();

    if (actualWeather && yesterdayFc.weather_intensity) {
      const actualPrecip = Number(actualWeather.precipitation_mm) || 0;
      const actualIntensity: string =
        actualPrecip < 1 ? "dry" : actualPrecip < 5 ? "light" : "heavy";
      if (actualIntensity !== yesterdayFc.weather_intensity) {
        const labels: Record<string, string> = { dry: "맑음", light: "약한 비", heavy: "본격 비" };
        causes.push({
          type: "weather_error",
          icon: "🌦️",
          message: `날씨 예보 ${labels[yesterdayFc.weather_intensity]} → 실제 ${labels[actualIntensity]}`,
        });
      }
    }

    // 5d. 요일 특수성 (간단: 주말 여부만 체크)
    const ydow = new Date(yesterdayStr + "T00:00:00+09:00").getDay();
    if (ydow === 0 || ydow === 6) {
      causes.push({
        type: "weekend",
        icon: "📅",
        message: `주말 효과 (${ydow === 0 ? "일" : "토"}요일)`,
      });
    }

    // 5e. 원인 불명
    if (causes.length === 0 && error != null && Math.abs(errorPct ?? 0) >= 5) {
      causes.push({
        type: "unknown",
        icon: "❓",
        message: "특정 원인 미감지 — 기타 외부 요인 추정",
      });
    }

    yesterday = {
      date: yesterdayStr,
      predicted,
      actual,
      error,
      errorPct,
      predictedCount,
      actualCount,
      countErrorPct,
      causes,
    };
  }

  // ── 6. 정확도 추적 (7일 / 30일) ──
  const completed = forecasts.filter(
    (f) => f.actual_volume != null && f.predicted_volume != null
  );

  function calcAccuracy(items: typeof completed) {
    if (items.length === 0) return null;
    const errors = items.map((f) => {
      const pred = Number(f.predicted_volume);
      const act = Number(f.actual_volume);
      return pred > 0 ? Math.abs((act - pred) / pred) * 100 : 0;
    });
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    return { avgErrorPct: +avgError.toFixed(1), accuracy: +(100 - avgError).toFixed(1), count: items.length };
  }

  const recent7 = completed.slice(0, 7);
  const recent30 = completed;

  const acc7 = calcAccuracy(recent7);
  const acc30 = calcAccuracy(recent30);

  // 추세: 최근 3일 vs 이전 4일 평균 오차 비교
  let trend: "improving" | "declining" | "stable" | null = null;
  if (recent7.length >= 5) {
    const first3 = calcAccuracy(recent7.slice(0, 3));
    const last4 = calcAccuracy(recent7.slice(3));
    if (first3 && last4) {
      const diff = first3.avgErrorPct - last4.avgErrorPct;
      trend = diff < -2 ? "improving" : diff > 2 ? "declining" : "stable";
    }
  }

  // ── 7. 히스토리 (차트용) ──
  const history = completed.map((f) => ({
    date: f.forecast_date,
    predicted: Number(f.predicted_volume),
    actual: Number(f.actual_volume),
    errorPct: Number(f.predicted_volume) > 0
      ? +(((Number(f.actual_volume) - Number(f.predicted_volume)) / Number(f.predicted_volume)) * 100).toFixed(1)
      : 0,
  })).reverse();

  return NextResponse.json(
    {
      status: yesterday ? "ready" : "no_yesterday",
      yesterday,
      accuracy: {
        days7: acc7,
        days30: acc30,
        trend,
      },
      history,
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300" } }
  );
}
