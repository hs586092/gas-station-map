import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── 통계 유틸 ──

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pearsonWithPValue(
  xs: number[],
  ys: number[]
): { r: number; p: number; n: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);

  // t-test for significance of correlation
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const df = n - 2;
  // Approximate two-tailed p-value using t-distribution
  // Using the approximation for |t| > 0
  const p = tDistPValue(Math.abs(t), df);

  return {
    r: Math.round(r * 1000) / 1000,
    p: Math.round(p * 10000) / 10000,
    n,
  };
}

// Approximate two-tailed p-value from t-distribution
// Uses the incomplete beta function approximation
function tDistPValue(t: number, df: number): number {
  const x = df / (df + t * t);
  // Regularized incomplete beta function approximation
  // For large df, use normal approximation
  if (df > 100) {
    // Normal approximation
    const z = t;
    return 2 * (1 - normalCDF(Math.abs(z)));
  }
  // For smaller df, use a series approximation
  const a = df / 2;
  const b = 0.5;
  const betaInc = incompleteBeta(x, a, b);
  return Math.min(1, Math.max(0, betaInc));
}

function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * z);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

// Regularized incomplete beta function via continued fraction
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use the continued fraction expansion
  const lnBeta =
    logGamma(a) + logGamma(b) - logGamma(a + b);
  const front =
    Math.exp(
      Math.log(x) * a + Math.log(1 - x) * b - lnBeta
    ) / a;

  // Lentz's algorithm for continued fraction
  let f = 1,
    c = 1,
    d = 0;
  for (let i = 0; i <= 200; i++) {
    let m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) {
      numerator = 1;
    } else if (i % 2 === 0) {
      numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    } else {
      numerator =
        -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    }
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-8) break;
  }

  return front * (f - 1);
}

function logGamma(z: number): number {
  // Stirling's approximation for log(Gamma(z))
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = z;
  let tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / z);
}

// ANOVA eta-squared: effect size of categorical variable on continuous variable
function anovaEtaSquared(
  groups: number[][]
): { etaSq: number; effectSize: number; n: number } | null {
  const all = groups.flat();
  const n = all.length;
  if (n < 3 || groups.length < 2) return null;
  // Need at least 2 groups with data
  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length < 2) return null;

  const grandMean = mean(all);
  let ssBetween = 0;
  let ssTotal = 0;

  for (const g of nonEmpty) {
    const gMean = mean(g);
    ssBetween += g.length * (gMean - grandMean) ** 2;
  }
  for (const v of all) {
    ssTotal += (v - grandMean) ** 2;
  }

  if (ssTotal === 0) return null;
  const etaSq = ssBetween / ssTotal;
  // Convert to effect size comparable to |r| (sqrt of eta-squared)
  const effectSize = Math.sqrt(etaSq);

  return {
    etaSq: Math.round(etaSq * 1000) / 1000,
    effectSize: Math.round(effectSize * 1000) / 1000,
    n,
  };
}

function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GET /api/stations/[id]/correlation-matrix
 *
 * 판매량 중심의 변수 간 상관관계 매트릭스를 계산한다.
 *
 * 변수:
 *  1. 총 판매량 (gasoline_volume + diesel_volume) — 중심 노드
 *  2. 강수량 (precipitation_mm)
 *  3. 기온 (temp_avg)
 *  4. Brent 유가
 *  5~8. 경쟁사 가격 차이 (최대 4곳)
 *  9. 요일 효과 (ANOVA eta-squared)
 *
 * 반환:
 *  - variables: 변수 목록 (id, label, group, color, r/etaSq, p, n)
 *  - matrix: 전체 상관관계 매트릭스 (변수 쌍)
 *  - scatterData: 산점도용 raw data
 *  - ranking: 판매량 영향력 순위
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const compact = request.nextUrl.searchParams.get("compact") === "1";

  // ── 1. 데이터 수집 (병렬) ──
  const [salesRes, weatherRes, oilRes, stationRes] = await Promise.all([
    supabase
      .from("sales_data")
      .select(
        "date, gasoline_volume, diesel_volume, gasoline_count, diesel_count"
      )
      .eq("station_id", id)
      .order("date", { ascending: true }),
    supabase
      .from("weather_daily")
      .select("date, precipitation_mm, temp_max, temp_min")
      .order("date", { ascending: true }),
    supabase
      .from("oil_prices")
      .select("date, brent")
      .not("brent", "is", null)
      .order("date", { ascending: true }),
    supabase
      .from("stations")
      .select("id, name, lat, lng")
      .eq("id", id)
      .single(),
  ]);

  if (!salesRes.data || salesRes.data.length === 0) {
    return NextResponse.json(
      { error: "판매 데이터가 없습니다." },
      { status: 404 }
    );
  }

  // ── 2. 판매 데이터 → 날짜별 Map ──
  const salesMap = new Map<
    string,
    { totalVol: number; totalCnt: number; dow: number }
  >();
  for (const s of salesRes.data) {
    const gVol = Number(s.gasoline_volume) || 0;
    const dVol = Number(s.diesel_volume) || 0;
    if (gVol === 0 && dVol === 0) continue;
    salesMap.set(s.date, {
      totalVol: gVol + dVol,
      totalCnt: (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0),
      dow: dowFromDateStr(s.date),
    });
  }

  // ── 3. 날씨 → 날짜별 Map ──
  const weatherMap = new Map<
    string,
    { precip: number; tempAvg: number | null }
  >();
  for (const w of weatherRes.data || []) {
    const tMax = w.temp_max != null ? Number(w.temp_max) : null;
    const tMin = w.temp_min != null ? Number(w.temp_min) : null;
    const tempAvg = tMax != null && tMin != null ? (tMax + tMin) / 2 : null;
    weatherMap.set(w.date, {
      precip: Number(w.precipitation_mm) || 0,
      tempAvg,
    });
  }

  // ── 4. 유가 → 날짜별 Map ──
  const oilMap = new Map<string, number>();
  for (const o of oilRes.data || []) {
    oilMap.set(o.date, Number(o.brent));
  }

  // ── 5. 경쟁사 가격 차이 계산 ──
  type CompetitorInfo = {
    id: string;
    name: string;
    distance_km: number;
    priceDiffMap: Map<string, number>;
    n: number;
  };
  const competitors: CompetitorInfo[] = [];

  if (stationRes.data?.lat && stationRes.data?.lng) {
    const RADIUS_KM = 5;
    const latDelta = RADIUS_KM / 111;
    const lngDelta = RADIUS_KM / 88;
    const base = stationRes.data;

    const { data: candidates } = await supabase
      .from("stations")
      .select("id, name, lat, lng")
      .gte("lat", base.lat - latDelta)
      .lte("lat", base.lat + latDelta)
      .gte("lng", base.lng - lngDelta)
      .lte("lng", base.lng + lngDelta)
      .neq("id", id);

    const neighbors = (candidates || [])
      .map((s) => ({
        ...s,
        distance_km:
          Math.round(
            haversineKm(base.lat, base.lng, s.lat, s.lng) * 100
          ) / 100,
      }))
      .filter((s) => s.distance_km <= RADIUS_KM)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 4); // 최대 4곳

    if (neighbors.length > 0) {
      const allIds = [id, ...neighbors.map((n) => n.id)];
      const { data: histories } = await supabase
        .from("price_history")
        .select("station_id, collected_at, gasoline_price")
        .in("station_id", allIds)
        .not("gasoline_price", "is", null)
        .order("collected_at", { ascending: true });

      // 주유소별 → 날짜별 가격
      const stationPrices = new Map<string, Map<string, number>>();
      for (const row of histories || []) {
        const sid = row.station_id;
        const date = row.collected_at.slice(0, 10);
        if (!stationPrices.has(sid)) stationPrices.set(sid, new Map());
        stationPrices.get(sid)!.set(date, row.gasoline_price!);
      }

      const myPrices = stationPrices.get(id) || new Map();

      for (const neighbor of neighbors) {
        const nPrices = stationPrices.get(neighbor.id) || new Map();
        const priceDiffMap = new Map<string, number>();
        for (const [date, myPrice] of myPrices) {
          const nPrice = nPrices.get(date);
          if (nPrice != null && myPrice > 0 && nPrice > 0) {
            priceDiffMap.set(date, myPrice - nPrice); // 양수 = 내가 비쌈
          }
        }
        if (priceDiffMap.size >= 3) {
          competitors.push({
            id: neighbor.id,
            name: neighbor.name,
            distance_km: neighbor.distance_km,
            priceDiffMap,
            n: priceDiffMap.size,
          });
        }
      }
    }
  }

  // ── 6. 상관관계 계산 ──

  interface VariableResult {
    id: string;
    label: string;
    group: "center" | "weather" | "competitor" | "oil" | "time";
    color: string;
    metric: "pearson" | "eta_squared";
    r: number | null; // pearson r 또는 sqrt(eta²) 부호 없음
    etaSq: number | null; // eta-squared (요일만)
    p: number | null;
    n: number;
    significant: boolean;
    lowSample: boolean;
  }

  const variables: VariableResult[] = [];

  // (a) 판매량 — 중심 노드
  const salesDates = [...salesMap.keys()].sort();
  variables.push({
    id: "sales",
    label: "판매량",
    group: "center",
    color: "#D4A843",
    metric: "pearson",
    r: 1,
    etaSq: null,
    p: 0,
    n: salesMap.size,
    significant: true,
    lowSample: false,
  });

  // (b) 강수량 vs 판매량
  {
    const pairs: { vol: number; precip: number }[] = [];
    for (const [date, s] of salesMap) {
      const w = weatherMap.get(date);
      if (w) pairs.push({ vol: s.totalVol, precip: w.precip });
    }
    const result = pearsonWithPValue(
      pairs.map((p) => p.precip),
      pairs.map((p) => p.vol)
    );
    variables.push({
      id: "precipitation",
      label: "강수량",
      group: "weather",
      color: "#3B82F6",
      metric: "pearson",
      r: result?.r ?? null,
      etaSq: null,
      p: result?.p ?? null,
      n: pairs.length,
      significant: result ? result.p < 0.05 : false,
      lowSample: pairs.length < 30,
    });
  }

  // (c) 기온 vs 판매량
  {
    const pairs: { vol: number; temp: number }[] = [];
    for (const [date, s] of salesMap) {
      const w = weatherMap.get(date);
      if (w?.tempAvg != null) pairs.push({ vol: s.totalVol, temp: w.tempAvg });
    }
    const result = pearsonWithPValue(
      pairs.map((p) => p.temp),
      pairs.map((p) => p.vol)
    );
    variables.push({
      id: "temperature",
      label: "기온",
      group: "weather",
      color: "#60A5FA",
      metric: "pearson",
      r: result?.r ?? null,
      etaSq: null,
      p: result?.p ?? null,
      n: pairs.length,
      significant: result ? result.p < 0.05 : false,
      lowSample: pairs.length < 30,
    });
  }

  // (d) Brent 유가 vs 판매량
  {
    const pairs: { vol: number; brent: number }[] = [];
    for (const [date, s] of salesMap) {
      const brent = oilMap.get(date);
      if (brent != null) pairs.push({ vol: s.totalVol, brent });
    }
    const result = pearsonWithPValue(
      pairs.map((p) => p.brent),
      pairs.map((p) => p.vol)
    );
    variables.push({
      id: "brent",
      label: "Brent 유가",
      group: "oil",
      color: "#9CA3AF",
      metric: "pearson",
      r: result?.r ?? null,
      etaSq: null,
      p: result?.p ?? null,
      n: pairs.length,
      significant: result ? result.p < 0.05 : false,
      lowSample: pairs.length < 30,
    });
  }

  // (e) 경쟁사 가격 차이 vs 판매량
  for (const comp of competitors) {
    const pairs: { vol: number; diff: number }[] = [];
    for (const [date, diff] of comp.priceDiffMap) {
      const s = salesMap.get(date);
      if (s) pairs.push({ vol: s.totalVol, diff });
    }
    const result = pearsonWithPValue(
      pairs.map((p) => p.diff),
      pairs.map((p) => p.vol)
    );
    // 주유소 이름에서 브랜드·법인명 제거 → 짧은 이름만 추출
    const shortName = comp.name
      .replace(/^(?:HD현대오일뱅크|현대오일뱅크|에쓰오일|에스오일|SK에너지|GS칼텍스|알뜰)(?:㈜|주식회사|\(주\))?\s*/g, "")
      .replace(/^(?:㈜|\(주\)|주식회사)\s*/g, "")
      .replace(/(?:㈜|\(주\)|주식회사)/g, "")
      .replace(/\s*(직영|위탁)\s*/g, "")
      .replace(/\s+/g, " ")
      .trim() || comp.name;

    variables.push({
      id: `comp_${comp.id}`,
      label: shortName,
      group: "competitor",
      color: "#EF4444",
      metric: "pearson",
      r: result?.r ?? null,
      etaSq: null,
      p: result?.p ?? null,
      n: pairs.length,
      significant: result ? result.p < 0.05 : false,
      lowSample: pairs.length < 30,
    });
  }

  // (f) 요일 효과 (ANOVA)
  {
    const groups: number[][] = Array.from({ length: 7 }, () => []);
    for (const [, s] of salesMap) {
      groups[s.dow].push(s.totalVol);
    }
    const result = anovaEtaSquared(groups);
    variables.push({
      id: "day_of_week",
      label: "요일",
      group: "time",
      color: "#A78BFA",
      metric: "eta_squared",
      r: result?.effectSize ?? null, // sqrt(eta²) for comparable scale
      etaSq: result?.etaSq ?? null,
      p: null, // ANOVA F-test p는 별도 계산 필요, 생략
      n: result?.n ?? salesMap.size,
      significant: result ? result.etaSq > 0.06 : false, // medium effect threshold
      lowSample: salesMap.size < 30,
    });
  }

  // ── 7. 산점도 데이터 (상세 페이지용) ──
  interface ScatterPoint {
    date: string;
    totalVol: number;
    precipitation: number | null;
    temperature: number | null;
    brent: number | null;
    dow: number;
    competitorDiffs: Record<string, number | null>;
  }

  const scatterData: ScatterPoint[] = [];
  for (const [date, s] of salesMap) {
    const w = weatherMap.get(date);
    const brent = oilMap.get(date) ?? null;
    const competitorDiffs: Record<string, number | null> = {};
    for (const comp of competitors) {
      competitorDiffs[comp.id] = comp.priceDiffMap.get(date) ?? null;
    }
    scatterData.push({
      date,
      totalVol: s.totalVol,
      precipitation: w?.precip ?? null,
      temperature: w?.tempAvg ?? null,
      brent,
      dow: s.dow,
      competitorDiffs,
    });
  }

  // ── 8. 판매량 영향력 순위 ──
  const ranking = variables
    .filter((v) => v.id !== "sales" && v.r != null)
    .map((v) => ({
      id: v.id,
      label: v.label,
      absEffect: Math.abs(v.r!),
      r: v.r!,
      metric: v.metric,
      n: v.n,
      significant: v.significant,
    }))
    .sort((a, b) => b.absEffect - a.absEffect);

  // ── 9. 전체 상관관계 매트릭스 (변수 쌍) ──
  // 판매량 vs 각 변수만 (star topology)
  const matrix = variables
    .filter((v) => v.id !== "sales")
    .map((v) => ({
      variable: v.id,
      label: v.label,
      r: v.r,
      p: v.p,
      n: v.n,
      metric: v.metric,
      significant: v.significant,
    }));

  const responseBody: Record<string, unknown> = {
    stationName: stationRes.data?.name ?? null,
    dataRange: {
      from: salesDates[0] || null,
      to: salesDates[salesDates.length - 1] || null,
      totalDays: salesMap.size,
    },
    variables,
    ranking,
  };

  // compact=1: 대시보드 카드용 (scatterData, matrix, competitors 제외 → ~70% 경량)
  if (!compact) {
    responseBody.matrix = matrix;
    responseBody.scatterData = scatterData;
    responseBody.competitors = competitors.map((c) => ({
      id: c.id,
      name: c.name,
      distance_km: c.distance_km,
      n: c.n,
    }));
  }

  return NextResponse.json(
    responseBody,
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
      },
    }
  );
}
