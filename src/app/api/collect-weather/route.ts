import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

/**
 * Open-Meteo로 하남시 날씨 실측을 수집하여 weather_daily 테이블에 upsert.
 *
 * 두 가지 소스를 상황에 맞게 사용:
 * 1. Forecast API + past_days=7 (기본, 크론용)
 *    - URL: https://api.open-meteo.com/v1/forecast
 *    - 장점: 당일/어제까지 관측 기반 데이터가 빠르게 반영됨 (archive는 2~5일 지연)
 *    - 용도: 매일 23:30 KST 크론, 최근 7일 보정
 *
 * 2. Archive API (?backfill=YYYY-MM-DD | ?backfill=true&days=N)
 *    - URL: https://archive-api.open-meteo.com/v1/archive
 *    - 장점: 장기간 확정 관측값이 정확 (ERA5 재분석)
 *    - 용도: 초기 1회 대규모 백필
 *
 * API 키 불필요.
 */
const LAT = 37.5405;
const LNG = 127.2060;

type WeatherRow = {
  date: string;
  weather_code: number | null;
  temp_max: number | null;
  temp_min: number | null;
  precipitation_mm: number | null;
  precipitation_prob_max: number | null;
};

function parseDaily(daily: Record<string, unknown>): WeatherRow[] {
  const dates = (daily.time as string[] | undefined) ?? [];
  const code = daily.weather_code as (number | null)[] | undefined;
  const tmax = daily.temperature_2m_max as (number | null)[] | undefined;
  const tmin = daily.temperature_2m_min as (number | null)[] | undefined;
  const precip = daily.precipitation_sum as (number | null)[] | undefined;

  return dates
    .map((date, i) => ({
      date,
      weather_code: code?.[i] ?? null,
      temp_max: tmax?.[i] ?? null,
      temp_min: tmin?.[i] ?? null,
      precipitation_mm: precip?.[i] ?? null,
      precipitation_prob_max: null, // 실측이므로 강수확률 없음
    }))
    .filter(
      (r) =>
        r.weather_code !== null ||
        r.temp_max !== null ||
        r.precipitation_mm !== null
    );
}

async function fetchForecastPastDays(days: number): Promise<WeatherRow[]> {
  const clamped = Math.max(1, Math.min(days, 92)); // forecast API past_days 한계
  const apiUrl =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LNG}` +
    `&past_days=${clamped}&forecast_days=1` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FSeoul`;

  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  const data = await res.json();
  return parseDaily(data.daily ?? {});
}

async function fetchArchive(startDate: string, endDate: string): Promise<WeatherRow[]> {
  const apiUrl =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${LAT}&longitude=${LNG}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=Asia%2FSeoul`;

  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
  const data = await res.json();
  return parseDaily(data.daily ?? {});
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const backfillParam = url.searchParams.get("backfill");
  const daysParam = url.searchParams.get("days");

  try {
    let rows: WeatherRow[];
    let source: "forecast_past_days" | "archive";
    let range: { from: string; to: string } | null = null;

    if (backfillParam) {
      // ── 백필 모드: Archive API ──
      source = "archive";
      const end = new Date();
      end.setDate(end.getDate() - 1); // 어제까지
      const start = new Date(end);

      if (backfillParam === "true") {
        const n = daysParam ? parseInt(daysParam, 10) : 190;
        const days = Number.isFinite(n) && n > 0 ? n : 190;
        start.setDate(start.getDate() - (days - 1));
      } else {
        // ?backfill=YYYY-MM-DD 형식
        const parsed = new Date(backfillParam);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "backfill 형식 오류 (true | YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        start.setTime(parsed.getTime());
      }

      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const startDate = fmt(start);
      const endDate = fmt(end);
      range = { from: startDate, to: endDate };
      rows = await fetchArchive(startDate, endDate);
    } else {
      // ── 기본(크론) 모드: Forecast API past_days ──
      source = "forecast_past_days";
      rows = await fetchForecastPastDays(7);
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, uploaded: 0, source, note: "데이터 없음", range });
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
      source,
      uploaded: rows.length,
      dateRange: { from: rows[0].date, to: rows[rows.length - 1].date },
      requestedRange: range,
    });
  } catch (err) {
    console.error("collect-weather error:", err);
    const msg = err instanceof Error ? err.message : "Open-Meteo 호출 실패";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
