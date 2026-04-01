import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 300;

const API_KEY = process.env.SEOUL_OPENDATA_API_KEY!;
const BASE_URL = "http://openapi.seoul.go.kr:8088";
const SERVICE = "SPOP_LOCAL_RESD_JACHI";
const PAGE_SIZE = 1000;

/** 자치구 코드 → 이름 매핑 */
const GU_NAMES: Record<string, string> = {
  "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구",
  "11215": "광진구", "11230": "동대문구", "11260": "중랑구", "11290": "성북구",
  "11305": "강북구", "11320": "도봉구", "11350": "노원구", "11380": "은평구",
  "11410": "서대문구", "11440": "마포구", "11470": "양천구", "11500": "강서구",
  "11530": "구로구", "11545": "금천구", "11560": "영등포구", "11590": "동작구",
  "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구",
  "11740": "강동구",
};

interface SeoulApiRow {
  STDR_DE_ID: string;
  TMZON_PD_SE: string;
  ADSTRD_CODE_SE: string;
  TOT_LVPOP_CO: string;
  MALE_F0T9_LVPOP_CO: string;
  MALE_F10T14_LVPOP_CO: string;
  MALE_F15T19_LVPOP_CO: string;
  MALE_F20T24_LVPOP_CO: string;
  MALE_F25T29_LVPOP_CO: string;
  MALE_F30T34_LVPOP_CO: string;
  MALE_F35T39_LVPOP_CO: string;
  MALE_F40T44_LVPOP_CO: string;
  MALE_F45T49_LVPOP_CO: string;
  MALE_F50T54_LVPOP_CO: string;
  MALE_F55T59_LVPOP_CO: string;
  MALE_F60T64_LVPOP_CO: string;
  MALE_F65T69_LVPOP_CO: string;
  MALE_F70T74_LVPOP_CO: string;
  FEMALE_F0T9_LVPOP_CO: string;
  FEMALE_F10T14_LVPOP_CO: string;
  FEMALE_F15T19_LVPOP_CO: string;
  FEMALE_F20T24_LVPOP_CO: string;
  FEMALE_F25T29_LVPOP_CO: string;
  FEMALE_F30T34_LVPOP_CO: string;
  FEMALE_F35T39_LVPOP_CO: string;
  FEMALE_F40T44_LVPOP_CO: string;
  FEMALE_F45T49_LVPOP_CO: string;
  FEMALE_F50T54_LVPOP_CO: string;
  FEMALE_F55T59_LVPOP_CO: string;
  FEMALE_F60T64_LVPOP_CO: string;
  FEMALE_F65T69_LVPOP_CO: string;
  FEMALE_F70T74_LVPOP_CO: string;
}

function n(v: string): number {
  return parseFloat(v) || 0;
}

function sumMale(row: SeoulApiRow): number {
  return (
    n(row.MALE_F0T9_LVPOP_CO) + n(row.MALE_F10T14_LVPOP_CO) +
    n(row.MALE_F15T19_LVPOP_CO) + n(row.MALE_F20T24_LVPOP_CO) +
    n(row.MALE_F25T29_LVPOP_CO) + n(row.MALE_F30T34_LVPOP_CO) +
    n(row.MALE_F35T39_LVPOP_CO) + n(row.MALE_F40T44_LVPOP_CO) +
    n(row.MALE_F45T49_LVPOP_CO) + n(row.MALE_F50T54_LVPOP_CO) +
    n(row.MALE_F55T59_LVPOP_CO) + n(row.MALE_F60T64_LVPOP_CO) +
    n(row.MALE_F65T69_LVPOP_CO) + n(row.MALE_F70T74_LVPOP_CO)
  );
}

function sumFemale(row: SeoulApiRow): number {
  return (
    n(row.FEMALE_F0T9_LVPOP_CO) + n(row.FEMALE_F10T14_LVPOP_CO) +
    n(row.FEMALE_F15T19_LVPOP_CO) + n(row.FEMALE_F20T24_LVPOP_CO) +
    n(row.FEMALE_F25T29_LVPOP_CO) + n(row.FEMALE_F30T34_LVPOP_CO) +
    n(row.FEMALE_F35T39_LVPOP_CO) + n(row.FEMALE_F40T44_LVPOP_CO) +
    n(row.FEMALE_F45T49_LVPOP_CO) + n(row.FEMALE_F50T54_LVPOP_CO) +
    n(row.FEMALE_F55T59_LVPOP_CO) + n(row.FEMALE_F60T64_LVPOP_CO) +
    n(row.FEMALE_F65T69_LVPOP_CO) + n(row.FEMALE_F70T74_LVPOP_CO)
  );
}

function ageGroup(row: SeoulApiRow, ageKey: string): number {
  const maleKey = `MALE_${ageKey}_LVPOP_CO` as keyof SeoulApiRow;
  const femaleKey = `FEMALE_${ageKey}_LVPOP_CO` as keyof SeoulApiRow;
  return n(row[maleKey]) + n(row[femaleKey]);
}

async function fetchAllRows(dateStr: string): Promise<SeoulApiRow[]> {
  // 먼저 전체 건수 확인
  const countUrl = `${BASE_URL}/${API_KEY}/json/${SERVICE}/1/1/${dateStr}`;
  const countRes = await fetch(countUrl);
  const countData = await countRes.json();

  if (countData.RESULT?.CODE === "INFO-200") {
    return [];
  }

  const totalCount = countData[SERVICE]?.list_total_count || 0;
  if (totalCount === 0) return [];

  const allRows: SeoulApiRow[] = [];
  let start = 1;

  while (start <= totalCount) {
    const end = Math.min(start + PAGE_SIZE - 1, totalCount);
    const url = `${BASE_URL}/${API_KEY}/json/${SERVICE}/${start}/${end}/${dateStr}`;
    const res = await fetch(url);
    const data = await res.json();

    const rows = data[SERVICE]?.row;
    if (!rows || rows.length === 0) break;

    allRows.push(...rows);
    start = end + 1;
  }

  return allRows;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const authHeader = request.headers.get("authorization");

  // 인증 (선택적)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // 개발 환경에서는 허용
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // 날짜 파라미터 (기본: 최근 사용 가능한 날짜를 탐색)
  let dateStr = searchParams.get("date");

  if (!dateStr) {
    // 어제부터 14일 전까지 사용 가능한 날짜 탐색 (서울 OpenData는 ~5일 지연)
    for (let d = 1; d <= 14; d++) {
      const date = new Date();
      date.setDate(date.getDate() - d);
      const candidate = date.toISOString().slice(0, 10).replace(/-/g, "");
      const testUrl = `${BASE_URL}/${API_KEY}/json/${SERVICE}/1/1/${candidate}`;
      const testRes = await fetch(testUrl);
      const testData = await testRes.json();
      if (testData[SERVICE]?.list_total_count > 0) {
        dateStr = candidate;
        break;
      }
    }
  }

  if (!dateStr) {
    return NextResponse.json(
      { error: "사용 가능한 생활인구 데이터를 찾을 수 없습니다 (최근 14일)" },
      { status: 404 }
    );
  }

  try {
    // 1. API에서 전체 데이터 가져오기
    const rows = await fetchAllRows(dateStr);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: `${dateStr} 날짜의 데이터가 없습니다` },
        { status: 404 }
      );
    }

    // 2. DB 저장용 레코드 변환
    const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    const records = rows.map((row) => ({
      date: formattedDate,
      hour: parseInt(row.TMZON_PD_SE, 10),
      adm_cd: row.ADSTRD_CODE_SE,
      adm_nm: GU_NAMES[row.ADSTRD_CODE_SE] || row.ADSTRD_CODE_SE,
      total_pop: Math.round(n(row.TOT_LVPOP_CO)),
      male_pop: Math.round(sumMale(row)),
      female_pop: Math.round(sumFemale(row)),
      age_10: Math.round(ageGroup(row, "F10T14") + ageGroup(row, "F15T19")),
      age_20: Math.round(ageGroup(row, "F20T24") + ageGroup(row, "F25T29")),
      age_30: Math.round(ageGroup(row, "F30T34") + ageGroup(row, "F35T39")),
      age_40: Math.round(ageGroup(row, "F40T44") + ageGroup(row, "F45T49")),
      age_50: Math.round(ageGroup(row, "F50T54") + ageGroup(row, "F55T59")),
      age_60_plus: Math.round(
        ageGroup(row, "F60T64") + ageGroup(row, "F65T69") + ageGroup(row, "F70T74")
      ),
    }));

    // 3. Supabase에 upsert
    const supabase = createServiceClient();
    const BATCH_SIZE = 500;
    let insertedCount = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("population_data")
        .upsert(batch, { onConflict: "date,hour,adm_cd" });

      if (error) {
        return NextResponse.json(
          {
            error: `Supabase 저장 실패: ${error.message}`,
            hint: error.message.includes("does not exist")
              ? "population_data 테이블을 먼저 생성해주세요"
              : undefined,
          },
          { status: 500 }
        );
      }
      insertedCount += batch.length;
    }

    return NextResponse.json({
      success: true,
      date: formattedDate,
      totalRows: rows.length,
      insertedCount,
      sampleRecord: records[0],
    });
  } catch (error) {
    const msg = (error as Error).message;
    const isXml = msg.includes("Unexpected token '<'");
    return NextResponse.json(
      {
        error: `수집 실패: ${msg}`,
        hint: isXml
          ? "서울 OpenData API가 XML 에러를 반환했습니다. SEOUL_OPENDATA_API_KEY 환경변수를 확인하세요."
          : undefined,
      },
      { status: 500 }
    );
  }
}
