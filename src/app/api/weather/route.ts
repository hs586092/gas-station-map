import { NextResponse } from "next/server";

/**
 * GET /api/weather
 * Open-Meteo에서 하남시 오늘/내일 날씨를 가져온다. API 키 불필요.
 * - 실시간: 현재 기온/날씨코드
 * - 오늘/내일: 최고/최저 기온, 최대 강수확률, 날씨코드
 * 캐시: 10분 (대시보드 로드용)
 */
const LAT = 37.5405;
const LNG = 127.2060;

export async function GET() {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LNG}` +
    `&current=temperature_2m,weather_code,precipitation` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum` +
    `&timezone=Asia%2FSeoul` +
    `&forecast_days=3`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = await res.json();

    const daily = data.daily || {};
    const dates: string[] = daily.time || [];
    const days = dates.map((date, i) => ({
      date,
      weatherCode: daily.weather_code?.[i] ?? null,
      tempMax: daily.temperature_2m_max?.[i] ?? null,
      tempMin: daily.temperature_2m_min?.[i] ?? null,
      precipProbMax: daily.precipitation_probability_max?.[i] ?? null,
      precipSum: daily.precipitation_sum?.[i] ?? null,
    }));

    return NextResponse.json(
      {
        location: "하남시",
        current: {
          temperature: data.current?.temperature_2m ?? null,
          weatherCode: data.current?.weather_code ?? null,
          precipitation: data.current?.precipitation ?? null,
        },
        today: days[0] || null,
        tomorrow: days[1] || null,
        days,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300",
        },
      }
    );
  } catch (err) {
    console.error("weather fetch error:", err);
    return NextResponse.json({ error: "날씨 데이터를 가져올 수 없습니다." }, { status: 500 });
  }
}
