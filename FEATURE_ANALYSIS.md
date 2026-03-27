# slp-gas-station-map 기능 분석 보고서

> 분석일: 2026-03-27
> 프로젝트: 서울/경기 지역 주유소 가격 정보 지도 서비스
> 기술 스택: Next.js 16 (App Router) + React 19 + TypeScript + Supabase + Google Maps + Tailwind CSS 4

---

## 1단계: 프로젝트 구조

### 폴더/파일 트리

```
gas-station-map/
├── data/
│   └── road_links.json                     # 도로 링크 데이터 (업로드용)
├── public/
│   ├── favicon.svg
│   └── (기본 아이콘 파일들)
├── scripts/
│   ├── convert-nodelink.py                 # 도로 노드링크 변환 스크립트
│   ├── upload-road-links-direct.py         # 도로 링크 직접 업로드
│   └── upload-road-links.sh               # 업로드 쉘 스크립트
├── src/
│   ├── app/
│   │   ├── api/                            # API 라우트
│   │   │   ├── api-stats/route.ts
│   │   │   ├── collect-population/route.ts
│   │   │   ├── collect-prices/route.ts
│   │   │   ├── match-districts/route.ts
│   │   │   ├── match-stations-roads/route.ts
│   │   │   ├── population/heatmap/route.ts
│   │   │   ├── population-analysis/route.ts
│   │   │   ├── price-history/[id]/route.ts
│   │   │   ├── stations/route.ts
│   │   │   ├── stations/[id]/route.ts
│   │   │   ├── stations/[id]/competitors/route.ts
│   │   │   ├── stations/[id]/correlation/route.ts
│   │   │   └── upload-road-links/route.ts
│   │   ├── auth/callback/page.tsx          # Google OAuth 콜백
│   │   ├── community/page.tsx              # 커뮤니티 게시판
│   │   ├── components/
│   │   │   ├── AuthModal.tsx               # 로그인/회원가입 모달
│   │   │   ├── CompetitorModal.tsx         # 경쟁사 분석 모달
│   │   │   ├── GoogleMap.tsx               # 메인 지도 + 헤더
│   │   │   ├── PriceChart.tsx              # 가격 추이 차트
│   │   │   └── Sidebar.tsx                 # 필터 + 주유소 목록
│   │   ├── population/page.tsx             # 유동인구 분석
│   │   ├── globals.css                     # 전역 스타일
│   │   ├── layout.tsx                      # 루트 레이아웃
│   │   └── page.tsx                        # 홈 (지도)
│   ├── lib/
│   │   ├── auth.tsx                        # Supabase Auth Context
│   │   ├── opinet.ts                       # Opinet 주유소 API
│   │   └── supabase.ts                     # Supabase 클라이언트
│   └── app.d.ts                            # 타입 정의
├── supabase/migrations/
│   ├── 001_create_price_history.sql
│   ├── 002_create_historical_price_tables.sql
│   ├── 003_stations_cache_and_api_log.sql
│   ├── 004_auth_and_community.sql
│   └── 005_road_links_and_traffic.sql
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── vercel.json                             # Vercel 배포 + Cron 설정
└── .env.local                              # 환경 변수
```

### 주요 디렉토리 역할

| 디렉토리 | 역할 |
|----------|------|
| `src/app/` | Next.js App Router - 페이지 및 API 라우트 |
| `src/app/components/` | 주요 UI 컴포넌트 (지도, 사이드바, 차트, 모달) |
| `src/app/api/` | REST API 엔드포인트 (조회, 수집, 매칭) |
| `src/lib/` | 유틸리티 - Supabase 클라이언트, Opinet API 래퍼, 인증 Context |
| `supabase/migrations/` | 데이터베이스 스키마 마이그레이션 (5개) |
| `scripts/` | 도로 데이터 변환/업로드 유틸리티 스크립트 |
| `data/` | 도로 링크 JSON 데이터 |

---

## 2단계: 페이지(라우트) 목록

### 사용자 접근 페이지

| URL | 파일 | 설명 | 인증 필요 |
|-----|------|------|-----------|
| `/` | `src/app/page.tsx` | 메인 지도 - Google Maps 기반 주유소 검색, 가격/브랜드/거리 필터, 히트맵 | X |
| `/population` | `src/app/population/page.tsx` | 유동인구 분석 - 자치구별 인구-주유가 산점도, 시간대별 히트맵, 경쟁 강도 | X |
| `/community` | `src/app/community/page.tsx` | 커뮤니티 게시판 - 5개 카테고리, 게시글/댓글/좋아요, 인기글 TOP 3 | O |
| `/auth/callback` | `src/app/auth/callback/page.tsx` | Google OAuth 콜백 처리 (내부용) | - |

### 모달/서브뷰 (메인 페이지 내)

- 주유소 클릭 → **InfoWindow** (주소, 전화, 가격, 편의시설)
- "가격 추이" → **PriceChart 모달** (30일 라인 차트)
- "경쟁사 분석" → **CompetitorModal** (가격 비교 탭 + 가격 연동성 탭)
- 로그인/회원가입 → **AuthModal** (이메일 + Google OAuth)

---

## 3단계: 핵심 기능 분석

### 기능 1: 지도 기반 주유소 검색

- **설명**: Google Maps 위에 반경 내 주유소를 마커로 표시하고, 유종/브랜드/반경으로 필터링
- **관련 파일**: `GoogleMap.tsx`, `Sidebar.tsx`, `/api/stations/route.ts`
- **데이터 흐름**:
  1. 지도 이동/줌 → `onIdle` 이벤트 발생
  2. 맵 중심 좌표 + 줌 레벨 기반 반경 계산
  3. `GET /api/stations?lat=X&lng=Y&radius=Z&prodCd=XXX` 호출
  4. DB에서 위경도 박스 필터링 → Haversine 거리 정밀 계산 → 가격순 정렬
  5. 마커 렌더링 + Sidebar 목록 갱신
- **외부 연동**: Google Maps API (`@vis.gl/react-google-maps`), Supabase (stations 테이블)

### 기능 2: 내 위치 기반 최저가 TOP 5

- **설명**: 사용자 GPS 위치 기준 가장 저렴한 주유소 5개를 하이라이트 표시
- **관련 파일**: `GoogleMap.tsx`, `Sidebar.tsx`, `/api/stations/route.ts`
- **데이터 흐름**:
  1. `navigator.geolocation` → 현재 위치 획득
  2. 해당 좌표로 `/api/stations` 호출 (반경 필터 기반)
  3. 가격순 정렬 후 상위 5개를 별도 섹션으로 표시
- **외부 연동**: Browser Geolocation API

### 기능 3: 주유소 상세 정보

- **설명**: 주유소 클릭 시 주소, 전화번호, 유종별 가격, 편의시설(LPG/세차/편의점) 표시
- **관련 파일**: `GoogleMap.tsx` (InfoWindow), `/api/stations/[id]/route.ts`, `src/lib/opinet.ts`
- **데이터 흐름**:
  1. 마커 클릭 → `GET /api/stations/{id}`
  2. DB에 상세정보 있으면 바로 반환
  3. 없으면 Opinet `detailById.do` API 호출 → KATEC→WGS84 좌표변환 → DB 캐시
  4. InfoWindow에 렌더링
- **외부 연동**: Opinet API (detailById.do), Supabase (stations 테이블)

### 기능 4: 가격 추이 차트

- **설명**: 선택한 주유소의 최근 30일 가격 변동을 라인 차트로 표시
- **관련 파일**: `PriceChart.tsx`, `/api/price-history/[id]/route.ts`
- **데이터 흐름**:
  1. "가격 추이" 버튼 클릭 → PriceChart 모달 오픈
  2. `GET /api/price-history/{id}` → 30일 데이터 조회
  3. 날짜별 그룹핑 (하루 중복 시 마지막 값)
  4. Recharts LineChart 렌더링 (휘발유: 빨강, 경유: 검정)
- **외부 연동**: Supabase (price_history 테이블)

### 기능 5: 경쟁사 비교 분석

- **설명**: 선택 주유소 반경 5km 내 경쟁사 가격 비교, 평균가 대비 순위, 가격 차이 표시
- **관련 파일**: `CompetitorModal.tsx` (가격 비교 탭), `/api/stations/[id]/competitors/route.ts`
- **데이터 흐름**:
  1. "경쟁사 분석" 클릭 → CompetitorModal 오픈
  2. `GET /api/stations/{id}/competitors` → 5km 내 주유소 조회 (최대 30개)
  3. 가격 차이, 평균가, 순위 계산
  4. 유종별(휘발유/경유) 토글 지원, 거리/가격 정렬
- **외부 연동**: Supabase (stations 테이블)

### 기능 6: 가격 연동성 분석

- **설명**: 기준 주유소와 경쟁사 간 30일 가격 변동의 Pearson 상관계수 분석
- **관련 파일**: `CompetitorModal.tsx` (연동성 탭), `/api/stations/[id]/correlation/route.ts`
- **데이터 흐름**:
  1. 연동성 탭 클릭 (지연 로드)
  2. `GET /api/stations/{id}/correlation`
  3. 30일간 기준+경쟁사 price_history → 일별 delta 계산
  4. 공통 날짜 필터링 → Pearson 상관계수 계산
  5. 신뢰도 레벨 판정 (low<7일, medium<15일, high≥15일)
- **외부 연동**: Supabase (price_history 테이블)

### 기능 7: 가격 히트맵 (지도 레이어)

- **설명**: 지도 위에 주유소 가격 분포를 히트맵 레이어로 시각화
- **관련 파일**: `GoogleMap.tsx`
- **데이터 흐름**:
  1. 히트맵 토글 ON
  2. 현재 표시 중인 주유소의 가격을 weight(0.1~1.0)로 변환
  3. Google Maps Visualization HeatmapLayer 렌더링
  4. 범례 표시 (최저가~최고가 그래디언트)
- **외부 연동**: Google Maps Visualization API

### 기능 8: 유동인구 분석

- **설명**: 서울 25개 자치구의 유동인구 데이터와 주유소 가격의 상관관계 분석
- **관련 파일**: `population/page.tsx`, `/api/population-analysis/route.ts`, `/api/population/heatmap/route.ts`
- **데이터 흐름**:
  1. 페이지 로드 → 두 API 병렬 호출
  2. `/api/population-analysis`: 자치구별 인구-주유가 상관분석
     - 인구 지표: 피크시간, 평균/야간 인구
     - 주유소 지표: 수, 평균/최저/최고가
     - 인사이트: 주유소당 인구, 경쟁 강도(very_high/high/medium/low)
     - 전체 Pearson 상관계수
  3. `/api/population/heatmap`: 25구 × 24시간 유동인구 매트릭스
  4. 시각화: 산점도(4사분면), 시간대별 히트맵, 경쟁 강도 분석
- **외부 연동**: Supabase (stations, population_data 테이블)

### 기능 9: 커뮤니티 게시판

- **설명**: 주유소 사장님들의 정보 공유 게시판 (5개 카테고리)
- **관련 파일**: `community/page.tsx`, `src/lib/auth.tsx`
- **데이터 흐름**:
  1. 로그인 필요 (Supabase Auth)
  2. 카테고리: 정유사정보, 운영고민, 장비추천, 구인구직, 자유
  3. Supabase 직접 쿼리 (posts, comments, post_likes, users_profile)
  4. 정렬: 최신순/인기순/댓글순, 검색: 제목+내용 (ilike)
  5. 인기글 TOP 3 카드 (가로 스크롤)
- **외부 연동**: Supabase (posts, comments, post_likes, users_profile)

### 기능 10: 인증 (로그인/회원가입)

- **설명**: 이메일/비밀번호 및 Google OAuth 기반 사용자 인증
- **관련 파일**: `AuthModal.tsx`, `src/lib/auth.tsx`, `auth/callback/page.tsx`
- **데이터 흐름**:
  1. 이메일 가입 → Supabase Auth `signUp` → users_profile 생성
  2. Google OAuth → `signInWithOAuth` → `/auth/callback` → 프로필 자동 생성
  3. AuthProvider Context로 전역 상태 관리
- **외부 연동**: Supabase Auth, Google OAuth

### 기능 11: 주유가 자동 수집 (Cron)

- **설명**: 매일 자정 Opinet API에서 서울+경기 전체 주유소 가격 수집
- **관련 파일**: `/api/collect-prices/route.ts`, `src/lib/opinet.ts`
- **데이터 흐름**:
  1. Vercel Cron → `GET /api/collect-prices` (매일 00:00 UTC)
  2. 43개 수집 포인트(서울12+경기31) × 3유종 = 129회 Opinet API 호출
  3. Map으로 주유소 중복 제거
  4. 주소 없는 주유소 → Opinet `detailById` 보충 (배치 5개)
  5. price_history INSERT (배치 1000개) + stations UPSERT
  6. api_call_log 기록
- **외부 연동**: Opinet API (aroundAll.do, detailById.do), Supabase

### 기능 12: 유동인구 데이터 수집

- **설명**: 서울시 공공데이터 API에서 자치구별 시간대별 생활인구 수집
- **관련 파일**: `/api/collect-population/route.ts`
- **데이터 흐름**:
  1. `GET /api/collect-population`
  2. 서울시 OpenData API (SPOP_LOCAL_RESD_JACHI) 호출
  3. 25개 자치구 × 24시간 = 600행/일
  4. 나이대별(0-9, 10-19, ..., 60+) 인구 합산
  5. population_data 테이블 UPSERT (배치 500개)
- **외부 연동**: 서울시 공공데이터 API, Supabase

---

## 4단계: API 라우트 정리

### 조회 API (GET)

| 엔드포인트 | 역할 | 캐시 |
|-----------|------|------|
| `GET /api/stations` | 반경 내 주유소 목록 (lat, lng, radius, prodCd) | 3600s |
| `GET /api/stations/[id]` | 주유소 상세정보 (주소, 전화, 가격, 편의시설) | 3600s |
| `GET /api/stations/[id]/competitors` | 5km 내 경쟁사 비교 (최대 30개, 가격차/순위) | 3600s |
| `GET /api/stations/[id]/correlation` | 경쟁사 가격 연동성 (Pearson 상관계수, 30일) | 3600s |
| `GET /api/price-history/[id]` | 30일 가격 이력 (날짜별 그룹핑) | - |
| `GET /api/population-analysis` | 자치구별 인구-주유가 상관분석 | 3600s + swr 600s |
| `GET /api/population/heatmap` | 시간대별 유동인구 히트맵 (25구 × 24시간) | 3600s + swr 600s |
| `GET /api/api-stats` | API 호출 통계 (일별/주간, 일일 한계 1500회) | - |

### 데이터 수집/관리 API

| 엔드포인트 | 메서드 | 역할 | Cron | maxDuration | 인증 |
|-----------|--------|------|------|-------------|------|
| `/api/collect-prices` | GET | 서울+경기 주유가 수집 (43포인트 × 3유종) | **매일 00:00** | 300s | CRON_SECRET |
| `/api/collect-population` | GET | 서울 생활인구 수집 (25구 × 24시간) | 수동 | 300s | CRON_SECRET (prod) |
| `/api/match-districts` | GET | 주유소→자치구 매칭 (주소+좌표 Haversine) | 수동 | 300s | - |
| `/api/match-stations-roads` | POST | 주유소→도로 링크 매칭 (등급 가중치) | 수동 | 300s | CRON_SECRET |
| `/api/upload-road-links` | POST | 도로 링크 데이터 업로드 (배치 500개) | 수동 | 300s | CRON_SECRET |

### Cron Job 설정 (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/collect-prices",
      "schedule": "0 0 * * *"   // 매일 자정 (UTC)
    }
  ]
}
```

> `collect-population`, `match-districts` 등은 자동 스케줄링 없이 수동 실행

---

## 5단계: Supabase 테이블/스토리지 사용 현황

### 테이블 목록

| 테이블명 | 마이그레이션 | 데이터 유형 | 설명 |
|---------|-------------|-----------|------|
| `stations` | 003 | 캐시(정적) | 주유소 기본정보 + 현재 가격 (id, name, brand, lat, lng, gasoline_price, diesel_price, premium_price, old_address, new_address, tel, district, nearest_link_id, link_distance, road_name, road_rank, lpg_yn, car_wash_yn, cvs_yn) |
| `price_history` | 001 | 시계열 | 일별 가격 이력 (station_id, station_name, brand, gasoline_price, diesel_price, premium_price, collected_at) |
| `population_data` | 추정 | 시계열 | 자치구별 시간대별 유동인구 (date, hour, adm_cd, adm_nm, total_pop, male_pop, female_pop, age_10~age_60_plus) |
| `road_links` | 005 | 지리정보 | 도로 네트워크 (link_id, f_node, t_node, road_name, road_rank, lanes, max_spd, length, center_lat/lng, start_lat/lng, end_lat/lng) |
| `users_profile` | 004 | 사용자 | 사용자 프로필 (id, nickname, station_name, region) |
| `posts` | 004 | UGC | 커뮤니티 게시글 (author_id, category, title, content, likes_count, comments_count) |
| `comments` | 004 | UGC | 댓글 (post_id, author_id, content) |
| `post_likes` | 004 | 관계 | 좋아요 (post_id, user_id) |
| `api_call_log` | 003 | 로그 | API 호출 통계 (endpoint, call_count, caller, success, error_message, called_at) |

### Supabase Storage

**사용하지 않음** - 모든 데이터는 테이블 기반으로 저장. 파일 업로드/이미지 첨부 기능 없음.

### 환경 변수 목록

| 환경 변수 | 용도 | 범위 |
|----------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | 클라이언트 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 익명 키 (RLS 적용) | 클라이언트 |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API 키 | 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 역할 키 (관리자 권한) | 서버 전용 |
| `OPINET_API_KEY` | 오피넷(한국석유공사) API 키 | 서버 전용 |
| `SEOUL_OPENDATA_API_KEY` | 서울시 공공데이터 API 키 | 서버 전용 |
| `CRON_SECRET` | Cron/관리 API 인증 토큰 | 서버 전용 |

---

## 6단계: 전체 기능 요약표

| 번호 | 기능명 | 상태 | 관련 페이지 | 핵심 기술 | 비고 |
|------|--------|------|-------------|-----------|------|
| 1 | 지도 기반 주유소 검색 | 완성 | `/` | Google Maps, Supabase | 유종/브랜드/반경 필터 |
| 2 | 내 위치 기반 최저가 TOP 5 | 완성 | `/` | Geolocation API | Sidebar에 별도 섹션 |
| 3 | 주유소 상세 정보 | 완성 | `/` | Opinet API, Supabase | on-demand 캐싱 |
| 4 | 가격 추이 차트 (30일) | 완성 | `/` (모달) | Recharts | 휘발유/경유 라인차트 |
| 5 | 경쟁사 가격 비교 | 완성 | `/` (모달) | Supabase | 5km 반경, 최대 30개 |
| 6 | 가격 연동성 분석 | 완성 | `/` (모달) | Pearson 상관계수 | 신뢰도 레벨 표시 |
| 7 | 가격 히트맵 | 완성 | `/` | Google Maps Visualization | 지도 레이어 토글 |
| 8 | 유동인구 분석 | 완성 | `/population` | Recharts, Supabase | 산점도+히트맵+경쟁분석 |
| 9 | 커뮤니티 게시판 | 완성 | `/community` | Supabase | 5개 카테고리, 댓글/좋아요 |
| 10 | 인증 (이메일+Google) | 완성 | 전체 (모달) | Supabase Auth | OAuth 콜백 포함 |
| 11 | 주유가 자동 수집 | 완성 | - (Cron) | Opinet API, Vercel Cron | 매일 자정, 43포인트 |
| 12 | 유동인구 데이터 수집 | 완성 | - (수동) | 서울시 API | Cron 미등록, 수동 실행 |
| 13 | 주유소-자치구 매칭 | 완성 | - (수동) | Haversine | 주소+좌표 이중 매칭 |
| 14 | 주유소-도로 매칭 | 완성 | - (수동) | 도로등급 가중치 | road_links 연결 |
| 15 | API 호출 통계 | 완성 | - | Supabase | 일일 한계 1500회 |

---

## 데이터 흐름 종합 다이어그램

```
┌─────────────── 외부 API ──────────────────┐
│                                            │
│  Opinet API (한국석유공사)                  │
│  ├─ aroundAll.do (반경 검색)              │
│  └─ detailById.do (상세정보)              │
│                                            │
│  서울시 OpenData API                       │
│  └─ SPOP_LOCAL_RESD_JACHI (생활인구)       │
│                                            │
│  Google Maps API (지도 렌더링)             │
└──────────────┬─────────────────────────────┘
               │
    ┌──────────▼──────────┐
    │   Next.js API 서버   │
    │                      │
    │  [수집] Cron 00:00   │
    │  collect-prices ──────┼──► stations, price_history
    │  collect-population ──┼──► population_data
    │                      │
    │  [매칭] 수동 실행     │
    │  match-districts ─────┼──► stations.district
    │  match-stations-roads ┼──► stations.nearest_link_id
    │                      │
    │  [조회] 캐시 3600s    │
    │  /api/stations        │
    │  /api/stations/[id]   │
    │  /api/.../competitors │
    │  /api/.../correlation │
    │  /api/price-history   │
    │  /api/population-*    │
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │   Supabase (DB)      │
    │                      │
    │  stations            │
    │  price_history       │
    │  population_data     │
    │  road_links          │
    │  users_profile       │
    │  posts/comments      │
    │  post_likes          │
    │  api_call_log        │
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │   프론트엔드 (React)  │
    │                      │
    │  GoogleMap + Sidebar │
    │  PriceChart          │
    │  CompetitorModal     │
    │  PopulationPage      │
    │  CommunityPage       │
    │  AuthModal           │
    └──────────────────────┘
```

---

## Dead Code 및 미사용 항목

### ~~1. `src/lib/its.ts` - 삭제 완료 (2026-03-27)~~

- ~~`getTrafficInfo()` 함수와 `TRAFFIC_GRID` 격자 정의 - 프로젝트 어디에서도 호출되지 않아 삭제~~
- ~~`ITS_API_KEY` 환경 변수도 함께 정리 (`.env.local`에서 수동 제거 필요)~~

### 2. `traffic_snapshots` 테이블 - 미사용

- migration 005에 정의되어 있으나, 이 테이블에 데이터를 쓰거나 읽는 코드가 없음
- 마이그레이션 SQL은 이력이므로 수정하지 않음

### 3. 일회성 관리 API

- `/api/match-districts`, `/api/match-stations-roads`, `/api/upload-road-links`는 초기 데이터 셋업용으로 추정
- Cron에 등록되지 않았고, 프론트엔드에서 호출하지 않음
- 새 주유소 추가 시 다시 실행 필요할 수 있으므로 유지해도 무방

### 3. `/api/collect-population` - Cron 미등록

- 코드는 완성되어 있으나 `vercel.json`의 crons에 등록되지 않음
- 수동 실행만 가능한 상태

### 4. `/api/api-stats` - 프론트엔드 미연결

- API 호출 통계를 반환하지만, 이를 표시하는 UI 페이지가 없음
- 관리/모니터링용으로 추정

---

## 솔직한 의견 (Your Opinion)

### 1. 프로젝트 구조에서 개선이 필요한 부분

- **컴포넌트 위치**: `src/app/components/`에 모든 컴포넌트가 있는데, Next.js 관례상 `src/components/`로 분리하는 것이 더 일반적. App Router의 라우트 세그먼트로 오인될 가능성은 없지만, 규모가 커질 경우 도메인별 분리가 필요
- **GoogleMap.tsx 비대화**: 메인 지도 컴포넌트가 Header, 지도, 마커, 히트맵, InfoWindow, 상태 관리를 모두 포함하고 있어 단일 책임 원칙 위반. Header, MapMarkers, HeatmapLayer 등으로 분리 권장
- **커뮤니티 페이지**: `community/page.tsx` 하나에 게시판 전체 기능(목록, 작성, 상세, 댓글)이 들어있어 매우 길 것으로 추정. 서브 컴포넌트 분리 필요

### 2. 사용되지 않는 코드(dead code)

- ~~**`src/lib/its.ts`**: 삭제 완료 (2026-03-27)~~
- ~~**`ITS_API_KEY`**: `.env.local`에서 수동 제거 필요~~
- **`traffic_snapshots` 테이블** (migration 005에 정의): 데이터를 쓰는 코드가 없음. road_links는 사용되지만 traffic_snapshots는 미사용

### 3. 성능/유지보수 우려

- **클라이언트 캐싱 부재**: 모든 API 호출이 매번 서버로 가고 있음. React Query나 SWR 같은 클라이언트 캐싱 라이브러리 도입 시 UX 개선 가능
- **Opinet API 의존도**: 상세정보를 on-demand로 Opinet에서 가져오는 구조인데, API 장애 시 상세정보를 볼 수 없음. collect-prices 시 상세정보도 함께 수집하면 더 안정적
- **collect-population Cron 미등록**: 인구 데이터가 자동 갱신되지 않아 수동 실행을 잊으면 데이터가 오래됨
- **좌표 변환 비용**: KATEC↔WGS84 변환이 매 API 호출마다 수행됨. stations 테이블에 이미 WGS84 좌표가 캐시되므로 큰 문제는 아니지만, 초기 수집 시 부하가 있을 수 있음

### 4. 새 기능 추가 시 어려운 점

- **타입 정의 부족**: Supabase 테이블 타입이 `app.d.ts`에만 있고, API 응답 타입이 별도로 정의되지 않아 새 기능 추가 시 타입 안전성이 떨어질 수 있음. Supabase CLI의 타입 생성(`supabase gen types`) 활용 권장
- **API 라우트 패턴 불일치**: 수집 API는 GET(collect-prices)과 POST(match-stations-roads)가 혼재. 일관된 패턴 필요
- **테스트 부재**: 단위 테스트, 통합 테스트가 전혀 없음. 가격 계산, 상관계수, 좌표 변환 등 핵심 로직에 테스트 추가 필요

### 5. 기타 피드백

- **보안**: 공개 키(`NEXT_PUBLIC_*`)와 서비스 키의 분리는 잘 되어 있음. 다만 RLS(Row Level Security) 정책이 코드에서 확인되지 않아, Supabase 대시보드에서 설정 확인 필요
- **vercel.json**: `maxDuration: 300`이 collect-prices와 match-districts에만 설정. collect-population, match-stations-roads, upload-road-links도 300s가 필요하지만 설정이 없음 (Vercel 기본값 10s로 타임아웃 가능)
- **검색 기능**: Header에 검색 UI가 있으나 실제 검색 로직이 구현되지 않은 것으로 보임 (추정)
- **반응형 완성도**: Sidebar의 모바일 바텀시트 구현은 좋으나, population/community 페이지의 모바일 최적화 수준은 별도 확인 필요
- **전체적 완성도**: 핵심 기능(주유소 검색, 가격 비교, 유동인구 분석)은 모두 동작하는 상태로, 프로덕션 배포 가능 수준. 정리와 안정성 강화에 집중하면 좋겠음
