// ============================================================
// 셀프광장주유소 판매 데이터 → Supabase 동기화
// Google Apps Script (GAS)
// ============================================================

// ─── 설정 (여기만 수정하세요) ───────────────────────────────
const CONFIG = {
  // Supabase 프로젝트 URL (예: https://xxxxxxxxxxxx.supabase.co)
  SUPABASE_URL: "여기에_SUPABASE_URL_입력",

  // Supabase service_role key (Settings → API → service_role 에서 복사)
  // ⚠️ anon key가 아닌 service_role key를 사용해야 합니다
  SUPABASE_SERVICE_ROLE_KEY: "여기에_SERVICE_ROLE_KEY_입력",

  // Google Sheets ID (URL의 /d/ 뒤 부분)
  SHEET_ID: "1a_SKw3E6-EqrYzQVFYTm2UXKdbHWAKUlrDuGLYEdqeA",

  // 시트 이름 (탭 이름)
  SHEET_NAME: "판매데이터",

  // 주유소 ID
  STATION_ID: "A0003453",
};
// ──────────────────────────────────────────────────────────────

/**
 * 매일 실행: 최근 7일 데이터를 Supabase에 upsert
 * - 트리거: 매일 새벽 2~3시
 * - 최근 7일을 다시 보내므로 수정된 데이터도 자동 반영
 */
function syncRecentSales() {
  const rows = readSheetData_();
  if (rows.length === 0) {
    Logger.log("시트에 데이터가 없습니다.");
    return;
  }

  // 최근 7일 필터
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const recentRows = rows.filter(function (r) {
    return r.date >= sevenDaysAgo;
  });

  if (recentRows.length === 0) {
    Logger.log("최근 7일 내 데이터가 없습니다.");
    return;
  }

  const payload = recentRows.map(toSupabaseRow_);
  upsertToSupabase_(payload);
  Logger.log("동기화 완료: " + recentRows.length + "건 (최근 7일)");
}

/**
 * 최초 1회 실행: 전체 과거 데이터를 Supabase에 업로드
 * - 수동으로 한 번만 실행
 * - 100건씩 배치 처리
 */
function uploadAllHistorical() {
  const rows = readSheetData_();
  if (rows.length === 0) {
    Logger.log("시트에 데이터가 없습니다.");
    return;
  }

  const allPayload = rows.map(toSupabaseRow_);

  // 100건씩 배치 upsert
  const BATCH_SIZE = 100;
  let uploaded = 0;
  for (var i = 0; i < allPayload.length; i += BATCH_SIZE) {
    var batch = allPayload.slice(i, i + BATCH_SIZE);
    upsertToSupabase_(batch);
    uploaded += batch.length;
    Logger.log("진행: " + uploaded + " / " + allPayload.length);

    // API 속도 제한 방지
    if (i + BATCH_SIZE < allPayload.length) {
      Utilities.sleep(500);
    }
  }

  Logger.log("전체 업로드 완료: " + allPayload.length + "건");
}

// ─── 내부 함수 ──────────────────────────────────────────────

/**
 * Google Sheets에서 판매 데이터를 읽어옴
 * 컬럼 순서: Date, 휘발유_총판매수량, 휘발유_총건수, 휘발유_판매금액(할인포함), 경유_총판매수량, 경유_총건수
 */
function readSheetData_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    // 시트 이름이 다를 수 있으므로 gid로 시도
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === 1655950201) {
        sheet = sheets[i];
        break;
      }
    }
  }

  if (!sheet) {
    Logger.log("시트를 찾을 수 없습니다. 시트 이름을 확인해주세요.");
    return [];
  }

  var data = sheet.getDataRange().getValues();
  var rows = [];

  // 1행: 카테고리, 2행: 컬럼명 → 데이터는 3행(index 2)부터
  for (var i = 2; i < data.length; i++) {
    var row = data[i];
    var dateVal = row[0];

    // 빈 행 건너뛰기
    if (!dateVal) continue;

    // Date 객체로 변환
    var date;
    if (dateVal instanceof Date) {
      date = dateVal;
    } else {
      date = new Date(dateVal);
    }

    // 유효하지 않은 날짜 건너뛰기
    if (isNaN(date.getTime())) {
      Logger.log("잘못된 날짜 형식 (행 " + (i + 1) + "): " + dateVal);
      continue;
    }

    // 판매량이 전부 비어있는 행 건너뛰기 (미래 날짜 등)
    var gVol = parseNum_(row[1]);
    var dVol = parseNum_(row[4]);
    if (gVol === null && dVol === null) continue;

    rows.push({
      date: date,
      gasoline_volume: gVol,
      gasoline_count: parseNum_(row[2]),
      gasoline_amount: parseNum_(row[3]),
      diesel_volume: dVol,
      diesel_count: parseNum_(row[5]),
    });
  }

  return rows;
}

/**
 * 숫자 파싱 (빈 값, 문자열 대응)
 */
function parseNum_(val) {
  if (val === "" || val === null || val === undefined) return null;
  var n = Number(val);
  return isNaN(n) ? null : n;
}

/**
 * 시트 행 → Supabase 레코드로 변환
 */
function toSupabaseRow_(row) {
  return {
    station_id: CONFIG.STATION_ID,
    date: Utilities.formatDate(row.date, "Asia/Seoul", "yyyy-MM-dd"),
    gasoline_volume: row.gasoline_volume,
    gasoline_count: row.gasoline_count,
    gasoline_amount: row.gasoline_amount,
    diesel_volume: row.diesel_volume,
    diesel_count: row.diesel_count,
  };
}

/**
 * Supabase REST API로 upsert
 * ON CONFLICT (station_id, date) DO UPDATE
 */
function upsertToSupabase_(payload) {
  var url = CONFIG.SUPABASE_URL + "/rest/v1/sales_data?on_conflict=station_id,date";

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      apikey: CONFIG.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + CONFIG.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: "resolution=merge-duplicates",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code !== 200 && code !== 201) {
    Logger.log("Supabase 오류 (" + code + "): " + response.getContentText());
    throw new Error("Supabase upsert 실패: HTTP " + code);
  }
}

/**
 * 연결 테스트: Supabase에 접속 가능한지 확인
 * 설정 후 이 함수를 먼저 실행해서 테스트하세요.
 */
function testConnection() {
  var url = CONFIG.SUPABASE_URL + "/rest/v1/sales_data?select=count&limit=0";

  var options = {
    method: "get",
    headers: {
      apikey: CONFIG.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + CONFIG.SUPABASE_SERVICE_ROLE_KEY,
    },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code === 200) {
    Logger.log("연결 성공! Supabase에 정상 접속됩니다.");
  } else {
    Logger.log("연결 실패 (" + code + "): " + response.getContentText());
    Logger.log("SUPABASE_URL과 SERVICE_ROLE_KEY를 확인해주세요.");
  }
}
