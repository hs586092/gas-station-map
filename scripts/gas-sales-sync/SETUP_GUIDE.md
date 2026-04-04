# 판매 데이터 자동 동기화 설정 가이드

셀프광장주유소의 일별 판매 데이터를 Google Sheets → Supabase로 자동 전송하는 설정입니다.

---

## 사전 준비

시작하기 전에 아래 2가지 정보를 준비하세요:

| 항목 | 확인 위치 |
|---|---|
| Supabase URL | Supabase 대시보드 → Settings → API → Project URL |
| Service Role Key | Supabase 대시보드 → Settings → API → `service_role` (⚠️ anon이 아님!) |

> **주의:** `service_role` 키는 관리자 권한이므로 외부에 절대 공유하지 마세요.

---

## 1단계: Supabase 테이블 생성

Supabase 대시보드 → SQL Editor에서 아래 SQL을 실행합니다:

```sql
CREATE TABLE sales_data (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_id       TEXT NOT NULL DEFAULT 'A0003453',
  date             DATE NOT NULL,
  gasoline_volume  NUMERIC(10,2),
  gasoline_count   INTEGER,
  gasoline_amount  NUMERIC(12,0),
  diesel_volume    NUMERIC(10,2),
  diesel_count     INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, date)
);

CREATE INDEX idx_sales_data_station_date ON sales_data (station_id, date DESC);

ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_data_select" ON sales_data FOR SELECT USING (true);
CREATE POLICY "sales_data_insert" ON sales_data FOR INSERT WITH CHECK (true);
CREATE POLICY "sales_data_update" ON sales_data FOR UPDATE USING (true) WITH CHECK (true);
```

실행 후 "Success" 메시지가 나오면 완료입니다.

---

## 2단계: Google Apps Script 생성

1. [Google Apps Script](https://script.google.com) 접속
2. **새 프로젝트** 클릭
3. 프로젝트 이름을 `판매데이터 동기화`로 변경
4. 기본으로 있는 `Code.gs` 파일의 내용을 **모두 삭제**
5. 이 폴더의 `Code.gs` 파일 내용을 **전체 복사**하여 붙여넣기

---

## 3단계: 설정값 입력

`Code.gs` 맨 위의 `CONFIG` 부분을 수정합니다:

```javascript
const CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxx.supabase.co",          // ← 여기 수정
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIs...",   // ← 여기 수정
  SHEET_ID: "1a_SKw3E6-EqrYzQVFYTm2UXKdbHWAKUlrDuGLYEdqeA",  // 이미 설정됨
  SHEET_NAME: "판매데이터",   // ← 실제 시트 탭 이름으로 수정
  STATION_ID: "A0003453",    // 그대로 유지
};
```

> **시트 이름 확인:** Google Sheets 하단 탭에 표시된 이름 그대로 입력하세요.
> 탭 이름이 다르더라도 gid(1655950201)로 자동 탐색하므로 동작은 합니다.

---

## 4단계: 연결 테스트

1. 상단 함수 선택 드롭다운에서 `testConnection` 선택
2. **실행** 버튼 클릭 (▶)
3. 첫 실행 시 Google 권한 요청 팝업 → **허용**
4. 하단 로그에 `연결 성공!`이 나오면 OK

실패 시 확인할 것:
- `SUPABASE_URL`에 `/` 가 끝에 붙어있으면 제거
- `service_role` 키가 맞는지 확인 (anon 키가 아닌지)

---

## 5단계: 과거 데이터 업로드 (최초 1회)

1. 함수 선택 → `uploadAllHistorical`
2. **실행** 클릭
3. 로그에서 진행 상황 확인 (100건씩 배치 처리)
4. `전체 업로드 완료: XXX건` 메시지 확인

> 이 함수는 **최초 1회만** 실행합니다. 이후에는 일별 동기화가 처리합니다.

---

## 6단계: 자동 실행 트리거 설정

1. 왼쪽 메뉴에서 ⏰ **트리거** (시계 아이콘) 클릭
2. 우측 하단 **+ 트리거 추가** 클릭
3. 아래와 같이 설정:

| 설정 항목 | 값 |
|---|---|
| 실행할 함수 | `syncRecentSales` |
| 이벤트 소스 | `시간 기반` |
| 트리거 유형 | `일 단위 타이머` |
| 시간 | `오전 2시 ~ 3시` |

4. **저장** 클릭

---

## 동작 확인

### Supabase에서 데이터 확인

SQL Editor에서 실행:

```sql
SELECT date, gasoline_volume, gasoline_count, diesel_volume, diesel_count
FROM sales_data
WHERE station_id = 'A0003453'
ORDER BY date DESC
LIMIT 10;
```

### 수동 동기화

최근 데이터를 바로 동기화하고 싶으면:
1. 함수 선택 → `syncRecentSales`
2. **실행** 클릭

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `연결 실패 (401)` | 키가 잘못됨 | service_role 키 재확인 |
| `연결 실패 (404)` | URL이 잘못됨 | Supabase URL 재확인 (끝에 `/` 제거) |
| `시트를 찾을 수 없습니다` | 시트 이름 불일치 | SHEET_NAME을 실제 탭 이름으로 수정 |
| `Supabase 오류 (409)` | 테이블 미생성 | 1단계 SQL 실행 확인 |
| `잘못된 날짜 형식` | Date 컬럼 형식 문제 | Sheets에서 날짜 컬럼이 "날짜" 서식인지 확인 |

---

## 구조 요약

```
Google Sheets (판매 데이터)
    ↓ GAS (매일 새벽 2시)
Supabase sales_data 테이블
    ↓ API (향후)
대시보드 가격 탄력성 분석
```
