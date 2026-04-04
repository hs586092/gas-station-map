import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 1. 판매 데이터 (전체) ──
  const { data: salesRaw } = await supabase
    .from("sales_data")
    .select("date, gasoline_volume, gasoline_count, gasoline_amount, diesel_volume, diesel_count")
    .eq("station_id", id)
    .order("date", { ascending: true });

  if (!salesRaw || salesRaw.length === 0) {
    return NextResponse.json({ error: "판매 데이터가 없습니다." }, { status: 404 });
  }

  // ── 2. price_history (해당 주유소만) ──
  const { data: priceRaw } = await supabase
    .from("price_history")
    .select("gasoline_price, diesel_price, collected_at")
    .eq("station_id", id)
    .not("gasoline_price", "is", null)
    .order("collected_at", { ascending: true });

  // price_history를 날짜별 맵으로 (마지막 값 기준)
  const priceByDate = new Map<string, { gasoline: number; diesel: number | null }>();
  if (priceRaw) {
    for (const r of priceRaw) {
      const date = r.collected_at.slice(0, 10);
      priceByDate.set(date, { gasoline: r.gasoline_price!, diesel: r.diesel_price });
    }
  }

  // ── 3. 일별 데이터 구성 (판매 단가 추정 포함) ──
  interface DayData {
    date: string;
    gasoline_volume: number;
    diesel_volume: number;
    gasoline_count: number;
    diesel_count: number;
    gasoline_amount: number;
    gasoline_price: number | null;    // price_history 기준
    gasoline_unit_price: number | null; // 실효 단가 (amount/volume)
    price_source: "price_history" | "sales_unit_price" | null;
  }

  const days: DayData[] = [];
  for (const s of salesRaw) {
    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    const gAmt = Number(s.gasoline_amount) || 0;
    const gCount = Number(s.gasoline_count) || 0;
    const dCount = Number(s.diesel_count) || 0;

    const unitPrice = gVol > 0 ? Math.round(gAmt / gVol) : null;
    const ph = priceByDate.get(s.date);

    days.push({
      date: s.date,
      gasoline_volume: gVol,
      diesel_volume: dVol,
      gasoline_count: gCount,
      diesel_count: dCount,
      gasoline_amount: gAmt,
      gasoline_price: ph?.gasoline ?? null,
      gasoline_unit_price: unitPrice,
      price_source: ph ? "price_history" : unitPrice ? "sales_unit_price" : null,
    });
  }

  // ── 4. 가격 변경 이벤트 감지 ──
  // 가격 소스: price_history 우선, 없으면 실효 단가
  function getPrice(d: DayData): number | null {
    return d.gasoline_price ?? d.gasoline_unit_price;
  }

  interface PriceEvent {
    date: string;
    fuel: "gasoline";
    priceBefore: number;
    priceAfter: number;
    priceChange: number;
    volumeBefore3d: number;
    volumeAfter3d: number;
    volumeChangeRate: number;
    volumeAfter7d: number | null;
    recoveryRate: number | null;
    priceSource: "price_history" | "sales_unit_price";
    elasticity: number | null;
  }

  const events: PriceEvent[] = [];
  const MIN_PRICE_CHANGE = 5; // 5원 이상만 이벤트로 인정

  for (let i = 1; i < days.length; i++) {
    const prev = getPrice(days[i - 1]);
    const curr = getPrice(days[i]);
    if (prev == null || curr == null) continue;

    const change = curr - prev;
    if (Math.abs(change) < MIN_PRICE_CHANGE) continue;

    // 변경 전 3일 평균 판매량
    const before3 = days.slice(Math.max(0, i - 3), i);
    const after3 = days.slice(i, Math.min(days.length, i + 3));
    const after7 = days.slice(i, Math.min(days.length, i + 7));

    if (before3.length === 0 || after3.length === 0) continue;

    const avgBefore = before3.reduce((s, d) => s + d.gasoline_volume, 0) / before3.length;
    const avgAfter = after3.reduce((s, d) => s + d.gasoline_volume, 0) / after3.length;
    const avgAfter7 = after7.length >= 5
      ? after7.reduce((s, d) => s + d.gasoline_volume, 0) / after7.length
      : null;

    if (avgBefore === 0) continue;

    const volChangeRate = ((avgAfter - avgBefore) / avgBefore) * 100;
    const recoveryRate = avgAfter7 != null && avgBefore > 0
      ? ((avgAfter7 - avgBefore) / avgBefore) * 100
      : null;

    // 탄력성: 판매량 변화율 / 가격 변화율
    const priceChangeRate = (change / prev) * 100;
    const elasticity = priceChangeRate !== 0
      ? Math.round((volChangeRate / priceChangeRate) * 100) / 100
      : null;

    events.push({
      date: days[i].date,
      fuel: "gasoline",
      priceBefore: prev,
      priceAfter: curr,
      priceChange: change,
      volumeBefore3d: Math.round(avgBefore),
      volumeAfter3d: Math.round(avgAfter),
      volumeChangeRate: Math.round(volChangeRate * 10) / 10,
      volumeAfter7d: avgAfter7 != null ? Math.round(avgAfter7) : null,
      recoveryRate: recoveryRate != null ? Math.round(recoveryRate * 10) / 10 : null,
      priceSource: days[i].price_source === "price_history" ? "price_history" : "sales_unit_price",
      elasticity,
    });
  }

  // ── 5. 요약 통계 ──
  const last30 = days.slice(-30);
  const avg30Gas = last30.length > 0
    ? Math.round(last30.reduce((s, d) => s + d.gasoline_volume, 0) / last30.length)
    : 0;
  const avg30Diesel = last30.length > 0
    ? Math.round(last30.reduce((s, d) => s + d.diesel_volume, 0) / last30.length)
    : 0;

  // 평균 탄력성 (이벤트 5개 이상)
  const validElasticities = events
    .filter((e) => e.elasticity != null)
    .map((e) => e.elasticity!);
  const avgElasticity = validElasticities.length >= 3
    ? Math.round((validElasticities.reduce((s, v) => s + v, 0) / validElasticities.length) * 100) / 100
    : null;

  let elasticityLabel: "민감" | "보통" | "둔감" | "데이터 부족" = "데이터 부족";
  if (avgElasticity != null) {
    const abs = Math.abs(avgElasticity);
    if (abs > 3) elasticityLabel = "민감";
    else if (abs > 1) elasticityLabel = "보통";
    else elasticityLabel = "둔감";
  }

  // ── 6. 요일별 패턴 ──
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayBuckets: { gasoline: number[]; diesel: number[] }[] =
    Array.from({ length: 7 }, () => ({ gasoline: [], diesel: [] }));

  for (const d of days) {
    const dow = new Date(d.date + "T00:00:00+09:00").getDay();
    weekdayBuckets[dow].gasoline.push(d.gasoline_volume);
    weekdayBuckets[dow].diesel.push(d.diesel_volume);
  }

  const weekdayPattern = weekdayBuckets.map((b, i) => ({
    day: i,
    dayLabel: dayLabels[i],
    avgGasoline: b.gasoline.length > 0
      ? Math.round(b.gasoline.reduce((s, v) => s + v, 0) / b.gasoline.length)
      : 0,
    avgDiesel: b.diesel.length > 0
      ? Math.round(b.diesel.reduce((s, v) => s + v, 0) / b.diesel.length)
      : 0,
  }));

  // ── 7. 차트용 일별 데이터 (최근 90일) ──
  const dailySales = days.slice(-90).map((d) => ({
    date: d.date,
    gasoline_volume: d.gasoline_volume,
    diesel_volume: d.diesel_volume,
    gasoline_price: d.gasoline_price ?? d.gasoline_unit_price,
    gasoline_count: d.gasoline_count,
    diesel_count: d.diesel_count,
  }));

  // 이벤트 날짜 셋 (차트에 세로선 표시용)
  const eventDates = events.map((e) => e.date);

  return NextResponse.json(
    {
      summary: {
        avg30d: { gasoline: avg30Gas, diesel: avg30Diesel },
        totalEvents: events.length,
        elasticity: avgElasticity,
        elasticityLabel,
        dataRange: {
          from: days[0]?.date ?? null,
          to: days[days.length - 1]?.date ?? null,
          totalDays: days.length,
        },
      },
      events: events.sort((a, b) => b.date.localeCompare(a.date)), // 최신순
      dailySales,
      eventDates,
      weekdayPattern,
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
  );
}
