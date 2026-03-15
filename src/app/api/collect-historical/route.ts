import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const OPINET_BASE_URL = "http://www.opinet.co.kr/api";
const API_KEY = process.env.OPINET_API_KEY!;

const PRODUCT_CODES = [
  { code: "B027", name: "휘발유" },
  { code: "D047", name: "경유" },
  { code: "C004", name: "고급휘발유" },
];

// 날짜를 YYYYMMDD 형식으로 변환
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// 날짜를 YYYY-MM-DD 형식으로 변환
function toISODate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 7일 단위 날짜 목록 생성 (startDate부터 endDate까지)
function generate7DayDates(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  // 첫 호출은 startDate + 6일 (7일치 데이터: startDate ~ startDate+6)
  const current = new Date(startDate);
  current.setDate(current.getDate() + 6); // API는 지정일 포함 이전 7일

  while (current <= endDate) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 7);
  }

  // 마지막 구간이 endDate를 포함하지 못하면 endDate로 한번 더
  const lastDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const endFormatted = formatDate(endDate);
  if (lastDate !== endFormatted) {
    dates.push(endFormatted);
  }

  return dates;
}

// Opinet API 호출 헬퍼
async function fetchOpinet(endpoint: string, params: Record<string, string>) {
  const query = new URLSearchParams({ code: API_KEY, out: "json", ...params });
  const url = `${OPINET_BASE_URL}/${endpoint}?${query}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Opinet API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// 전국 평균가격 (특정 7일간)
async function fetchAvgPrice(date: string, prodcd: string) {
  const data = await fetchOpinet("avgRecentPrice.do", { date, prodcd });
  return data?.RESULT?.OIL ?? [];
}

// 지역별 평균가격 (특정 7일간)
async function fetchRegionalPrice(date: string, prodcd: string) {
  const data = await fetchOpinet("avgSidoPrice.do", { date, prodcd });
  return data?.RESULT?.OIL ?? [];
}

// 상표별 평균가격 (특정 7일간)
async function fetchBrandPrice(date: string, prodcd: string) {
  const data = await fetchOpinet("avgLastPrice.do", { date, prodcd });
  return data?.RESULT?.OIL ?? [];
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const supabase = createServiceClient();

  // 쿼리 파라미터로 시작/종료일 지정 가능
  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start") || "20250101";
  const endParam = searchParams.get("end") || formatDate(new Date());

  const startDate = new Date(
    parseInt(startParam.slice(0, 4)),
    parseInt(startParam.slice(4, 6)) - 1,
    parseInt(startParam.slice(6, 8))
  );
  const endDate = new Date(
    parseInt(endParam.slice(0, 4)),
    parseInt(endParam.slice(4, 6)) - 1,
    parseInt(endParam.slice(6, 8))
  );

  const dates = generate7DayDates(startDate, endDate);
  const totalCalls = dates.length * PRODUCT_CODES.length * 3;

  console.log(`=== 과거 데이터 수집 시작 ===`);
  console.log(`기간: ${startParam} ~ ${endParam}`);
  console.log(`7일 구간 수: ${dates.length}`);
  console.log(`총 예상 API 호출: ${totalCalls}회`);

  let apiCalls = 0;
  let avgInserted = 0;
  let regionalInserted = 0;
  let brandInserted = 0;
  let errors: string[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    console.log(`\n[${i + 1}/${dates.length}] 날짜 구간: ${date} 처리 중...`);

    for (const product of PRODUCT_CODES) {
      // 1) 전국 평균가격
      try {
        const avgData = await fetchAvgPrice(date, product.code);
        apiCalls++;
        if (avgData.length > 0) {
          const rows = avgData.map((item: { DATE: string; PRICE: string }) => ({
            date: toISODate(item.DATE),
            product_code: product.code,
            product_name: product.name,
            avg_price: parseFloat(item.PRICE),
          }));
          const { error } = await supabase
            .from("avg_price_history")
            .upsert(rows, { onConflict: "date,product_code" });
          if (error) {
            errors.push(`avg ${date} ${product.code}: ${error.message}`);
          } else {
            avgInserted += rows.length;
          }
        }
        await sleep(500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`avg ${date} ${product.code}: ${msg}`);
      }

      // 2) 지역별 평균가격
      try {
        const regionalData = await fetchRegionalPrice(date, product.code);
        apiCalls++;
        if (regionalData.length > 0) {
          const rows = regionalData.map(
            (item: {
              DATE: string;
              SIDOCD: string;
              SIDONM: string;
              PRICE: string;
            }) => ({
              date: toISODate(item.DATE),
              sido_code: item.SIDOCD,
              sido_name: item.SIDONM,
              product_code: product.code,
              avg_price: parseFloat(item.PRICE),
            })
          );
          const { error } = await supabase
            .from("regional_price_history")
            .upsert(rows, { onConflict: "date,sido_code,product_code" });
          if (error) {
            errors.push(`regional ${date} ${product.code}: ${error.message}`);
          } else {
            regionalInserted += rows.length;
          }
        }
        await sleep(500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`regional ${date} ${product.code}: ${msg}`);
      }

      // 3) 상표별 평균가격
      try {
        const brandData = await fetchBrandPrice(date, product.code);
        apiCalls++;
        if (brandData.length > 0) {
          const rows = brandData.map(
            (item: {
              DATE: string;
              POLLCD: string;
              POLLNM: string;
              PRICE: string;
            }) => ({
              date: toISODate(item.DATE),
              brand_code: item.POLLCD,
              brand_name: item.POLLNM,
              product_code: product.code,
              avg_price: parseFloat(item.PRICE),
            })
          );
          const { error } = await supabase
            .from("brand_price_history")
            .upsert(rows, { onConflict: "date,brand_code,product_code" });
          if (error) {
            errors.push(`brand ${date} ${product.code}: ${error.message}`);
          } else {
            brandInserted += rows.length;
          }
        }
        await sleep(500);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`brand ${date} ${product.code}: ${msg}`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const result = {
    success: true,
    period: `${startParam} ~ ${endParam}`,
    intervals: dates.length,
    apiCalls,
    inserted: {
      avg: avgInserted,
      regional: regionalInserted,
      brand: brandInserted,
    },
    errors: errors.length > 0 ? errors : undefined,
    elapsedSeconds: parseFloat(elapsed),
  };

  console.log(`\n=== 수집 완료 ===`);
  console.log(JSON.stringify(result, null, 2));

  return NextResponse.json(result);
}
