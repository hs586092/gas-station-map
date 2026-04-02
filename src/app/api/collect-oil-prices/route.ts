import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const EIA_API_KEY = process.env.EIA_API_KEY || "DEMO_KEY";
const EIA_BASE = "https://api.eia.gov/v2/petroleum/pri/spt/data/";

/**
 * EIA API에서 WTI/Brent 일별 현물가를 수집하여 oil_prices 테이블에 저장.
 * - pg_cron 또는 Vercel cron으로 매일 1회 호출
 * - 최근 90일치를 가져와서 upsert (빠진 날짜 자동 보정)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createServiceClient();

  try {
    // WTI + Brent를 병렬 호출
    const [wtiData, brentData] = await Promise.all([
      fetchEiaSeries("RWTC", 90),
      fetchEiaSeries("RBRTE", 90),
    ]);

    // 날짜별 Map으로 병합
    const priceMap = new Map<string, { wti?: number; brent?: number }>();

    for (const row of wtiData) {
      const entry = priceMap.get(row.period) || {};
      entry.wti = parseFloat(row.value);
      priceMap.set(row.period, entry);
    }
    for (const row of brentData) {
      const entry = priceMap.get(row.period) || {};
      entry.brent = parseFloat(row.value);
      priceMap.set(row.period, entry);
    }

    // upsert 데이터 준비
    const rows = Array.from(priceMap.entries())
      .map(([date, prices]) => ({
        date,
        wti: prices.wti ?? null,
        brent: prices.brent ?? null,
      }))
      .filter((r) => r.wti !== null || r.brent !== null);

    // 배치 upsert (500개씩)
    let uploaded = 0;
    let errors = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("oil_prices")
        .upsert(batch, { onConflict: "date", ignoreDuplicates: false });
      if (error) {
        console.error("oil_prices upsert error:", error.message);
        errors++;
      } else {
        uploaded += batch.length;
      }
    }

    return NextResponse.json({
      ok: true,
      uploaded,
      errors,
      dateRange: rows.length > 0
        ? { from: rows[rows.length - 1].date, to: rows[0].date }
        : null,
    });
  } catch (err) {
    console.error("collect-oil-prices error:", err);
    return NextResponse.json(
      { error: "EIA API 호출 실패" },
      { status: 500 }
    );
  }
}

interface EiaRow {
  period: string;
  value: string;
}

async function fetchEiaSeries(series: string, days: number): Promise<EiaRow[]> {
  const url =
    `${EIA_BASE}?api_key=${EIA_API_KEY}` +
    `&frequency=daily` +
    `&data[0]=value` +
    `&facets[series][]=${series}` +
    `&sort[0][column]=period` +
    `&sort[0][direction]=desc` +
    `&length=${days}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`EIA API ${res.status}: ${series}`);
  const data = await res.json();
  return data.response?.data || [];
}
