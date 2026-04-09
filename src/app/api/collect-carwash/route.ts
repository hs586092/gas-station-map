import { NextResponse } from "next/server";
import { createServiceClient, createCarwashClient } from "@/lib/supabase";

const BUSINESS_ID = process.env.CARWASH_BUSINESS_ID!;
const STATION_ID = "A0003453";
const PAGE_SIZE = 1000;

/**
 * 세차장 POS(별도 Supabase)에서 일별 세차 데이터를 수집하여
 * SLP Analytics의 carwash_daily 테이블에 저장.
 *
 * - Vercel cron으로 매일 04:00 KST 호출
 * - ?backfill=true 로 과거 전체 데이터 백필 가능
 * - ?date=2026-04-08 로 특정 날짜만 수집 가능
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const backfill = url.searchParams.get("backfill") === "true";
  const specificDate = url.searchParams.get("date");

  const carwash = createCarwashClient();
  const slp = createServiceClient();

  try {
    // ── 수집 대상 날짜 범위 결정 ──
    let minDate: string;
    let maxDate: string;

    if (specificDate) {
      minDate = maxDate = specificDate;
    } else if (backfill) {
      const { data: earliestRows, error: eErr } = await carwash
        .from("transactions")
        .select("date")
        .eq("business_id", BUSINESS_ID)
        .neq("is_deleted", true)
        .order("date", { ascending: true })
        .limit(1);

      if (eErr || !earliestRows || earliestRows.length === 0) {
        return NextResponse.json({ error: "No carwash data found", detail: eErr?.message }, { status: 404 });
      }
      minDate = earliestRows[0].date;
      maxDate = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    } else {
      maxDate = new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      minDate = new Date(Date.now() - 2 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    }

    // ── 세차장 트랜잭션 페이지네이션 조회 ──
    type Tx = { date: string; price_key: string; price_label: string; price_value: number; payment_key: string };
    const allTx: Tx[] = [];
    let offset = 0;

    while (true) {
      const { data: page, error: txErr } = await carwash
        .from("transactions")
        .select("date, price_key, price_label, price_value, payment_key")
        .eq("business_id", BUSINESS_ID)
        .neq("is_deleted", true)
        .gte("date", minDate)
        .lte("date", maxDate)
        .order("date", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (txErr) {
        return NextResponse.json({ error: "Carwash DB error", detail: txErr.message }, { status: 500 });
      }

      if (!page || page.length === 0) break;
      allTx.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // ── 날짜별 집계 ──
    const dailyMap = new Map<string, {
      total_count: number;
      total_revenue: number;
      breakdown: Record<string, number>;
      payment_breakdown: Record<string, number>;
    }>();

    // 모든 대상 날짜를 미리 초기화 (데이터 없는 날도 0으로 기록)
    const dates = getDateRange(minDate, maxDate);
    for (const d of dates) {
      dailyMap.set(d, { total_count: 0, total_revenue: 0, breakdown: {}, payment_breakdown: {} });
    }

    for (const tx of allTx) {
      const day = dailyMap.get(tx.date);
      if (!day) continue;

      day.total_count += 1;
      day.total_revenue += tx.price_value || 0;

      const label = tx.price_label || tx.price_key;
      day.breakdown[label] = (day.breakdown[label] || 0) + 1;

      const pay = tx.payment_key || "unknown";
      day.payment_breakdown[pay] = (day.payment_breakdown[pay] || 0) + 1;
    }

    // ── SLP Analytics DB에 upsert ──
    const rows = Array.from(dailyMap.entries()).map(([date, agg]) => ({
      station_id: STATION_ID,
      date,
      total_count: agg.total_count,
      total_revenue: agg.total_revenue,
      breakdown: agg.breakdown,
      payment_breakdown: agg.payment_breakdown,
    }));

    const batchSize = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: upsertErr } = await slp
        .from("carwash_daily")
        .upsert(batch, { onConflict: "station_id,date" });

      if (upsertErr) {
        return NextResponse.json({
          error: "SLP DB upsert error",
          detail: upsertErr.message,
          upserted,
        }, { status: 500 });
      }
      upserted += batch.length;
    }

    return NextResponse.json({
      ok: true,
      totalTransactions: allTx.length,
      dates: dates.length,
      upserted,
      sample: rows.slice(0, 3).map(r => ({ date: r.date, count: r.total_count, revenue: r.total_revenue })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Unexpected error", detail: message }, { status: 500 });
  }
}

/** 시작일~종료일 사이의 모든 날짜 배열 생성 */
function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}
