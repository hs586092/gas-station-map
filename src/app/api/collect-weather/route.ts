import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

/**
 * Open-Meteo Historical Weather API로 하남시 과거/어제 날씨를 수집하여
 * weather_daily 테이블에 upsert.
 *
 * - 쿼리 파라미터 없이 호출: 최근 7일치 업서트 (일일 크론용, 최신 데이터 보정 포함)
 * - ?backfill=YYYY-MM-DD: 해당 날짜부터 오늘까지 백필 (초기 1회용)
 *
 * API 키 불필요. archive-api.open-meteo.com은 확정된 관측값(대부분 1-2일 지연).
 */
const LAT = 37.5405;
const LNG = 127.2060;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const backfillStart = url.searchParams.get("backfill");

  // 기간 결정: backfill 지정 시 그 날짜부터, 아니면 최근 7일
  const end = new Date();
  end.setDate(end.getDate() - 1); // 어제까지 (archive API는 오늘 데이터 없음)
  const start = new Date(end);
  if (backfillStart) {
    start.setTime(new Date(backfillStart).getTime());
  } else {
    start.setDate(start.getDate() - 6); // 최근 7일
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const startDate = fmt(start);
  const endDate = fmt(end);

  const apiUrl =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${LAT}&longitude=${LNG}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FSeoul`;

  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
    const data = await res.json();

    const daily = data.daily || {};
    const dates: string[] = daily.time || [];

    const rows = dates
      .map((date, i) => ({
        date,
        weather_code: daily.weather_code?.[i] ?? null,
        temp_max: daily.temperature_2m_max?.[i] ?? null,
        temp_min: daily.temperature_2m_min?.[i] ?? null,
        precipitation_mm: daily.precipitation_sum?.[i] ?? null,
        precipitation_prob_max: null, // archive API는 강수확률 미제공 (관측값이라)
      }))
      .filter((r) => r.weather_code !== null || r.temp_max !== null);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, uploaded: 0, note: "데이터 없음" });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("weather_daily")
      .upsert(rows, { onConflict: "date", ignoreDuplicates: false });

    if (error) {
      console.error("weather_daily upsert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      uploaded: rows.length,
      dateRange: { from: rows[0].date, to: rows[rows.length - 1].date },
    });
  } catch (err) {
    console.error("collect-weather error:", err);
    return NextResponse.json(
      { error: "Open-Meteo archive 호출 실패" },
      { status: 500 }
    );
  }
}
