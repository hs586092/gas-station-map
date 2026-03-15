const OPINET_BASE_URL = "http://www.opinet.co.kr/api";
const API_KEY = process.env.OPINET_API_KEY!;

/** 유종 코드 */
export const PROD_CD = {
  GASOLINE: "B027", // 휘발유
  PREMIUM_GASOLINE: "B034", // 고급휘발유
  DIESEL: "D047", // 경유
  LPG: "K015", // LPG
} as const;

/** aroundAll.do 응답 항목 */
export interface AroundStation {
  UNI_ID: string;
  POLL_DIV_CD: string;
  OS_NM: string;
  PRICE: number;
  DISTANCE: number;
  GIS_X_COOR: number; // KATEC X
  GIS_Y_COOR: number; // KATEC Y
}

/** detailById.do 유가 항목 */
export interface OilPrice {
  PRODCD: string;
  PRICE: number;
  TRADE_DT: string;
  TRADE_TM: string;
}

/** detailById.do 응답 항목 */
export interface StationDetail {
  UNI_ID: string;
  POLL_DIV_CO: string;
  OS_NM: string;
  VAN_ADR: string;
  NEW_ADR: string;
  TEL: string;
  GIS_X_COOR: number;
  GIS_Y_COOR: number;
  LPG_YN: string;
  CAR_WASH_YN: string;
  CVS_YN: string;
  OIL_PRICE: OilPrice[];
}

// ── KATEC → WGS84 좌표 변환 ──
// TM128(KATEC) 좌표계를 GPS(WGS84) 좌표로 변환

const PI = Math.PI;
const DEGTORAD = PI / 180;
const RADTODEG = 180 / PI;

interface Datum {
  a: number;
  f: number;
  b: number;
  e2: number;
  e: number;
}

interface TmParam {
  scaleFactor: number;
  lonCenter: number;
  latCenter: number;
  falseNorthing: number;
  falseEasting: number;
  datum: Datum;
}

function makeDatum(a: number, f: number): Datum {
  const b = a * (1 - f);
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);
  return { a, f, b, e2, e };
}

const BESSEL = makeDatum(6377397.155, 1 / 299.1528128);
const WGS84_DATUM = makeDatum(6378137.0, 1 / 298.257223563);

const KATEC_PARAM: TmParam = {
  scaleFactor: 0.9999,
  lonCenter: 128.0 * DEGTORAD,
  latCenter: 38.0 * DEGTORAD,
  falseNorthing: 600000.0,
  falseEasting: 400000.0,
  datum: BESSEL,
};

function tmToGeodetic(
  x: number,
  y: number,
  param: TmParam
): { lat: number; lng: number } {
  const { datum, scaleFactor, lonCenter, latCenter, falseEasting, falseNorthing } = param;
  const { a, e2 } = datum;
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const M0 =
    a *
    ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latCenter -
      (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latCenter) +
      (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latCenter) -
      (35 * e6 / 3072) * Math.sin(6 * latCenter));

  const M = M0 + (y - falseNorthing) / scaleFactor;
  const mu =
    M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
    (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
    (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = (e2 / (1 - e2)) * cosPhi1 * cosPhi1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = (x - falseEasting) / (N1 * scaleFactor);
  const D2 = D * D;

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D2 * D2) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) *
          D2 * D2 * D2) / 720);

  const lng =
    lonCenter +
    (D -
      ((1 + 2 * T1 + C1) * D * D2) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) *
        D * D2 * D2) / 120) /
      cosPhi1;

  return { lat: lat * RADTODEG, lng: lng * RADTODEG };
}

// Molodensky 변환 (Bessel → WGS84)
function besselToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  const dA = WGS84_DATUM.a - BESSEL.a;
  const dF = WGS84_DATUM.f - BESSEL.f;
  const dX = -146.43;
  const dY = 507.89;
  const dZ = 681.46;

  const latRad = lat * DEGTORAD;
  const lngRad = lng * DEGTORAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLng = Math.sin(lngRad);
  const cosLng = Math.cos(lngRad);

  const { a, f, e2 } = BESSEL;
  const Rn = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const Rm = (a * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);

  const dLat =
    ((-dX * sinLat * cosLng - dY * sinLat * sinLng + dZ * cosLat +
      dA * ((Rn * e2 * sinLat * cosLat) / a) +
      dF * (Rm / (1 - f) + Rn * (1 - f)) * sinLat * cosLat) /
      Rm) *
    RADTODEG;

  const dLng =
    ((-dX * sinLng + dY * cosLng) / (Rn * cosLat)) * RADTODEG;

  return { lat: lat + dLat, lng: lng + dLng };
}

/** KATEC 좌표를 WGS84(GPS)로 변환 */
export function katecToWgs84(x: number, y: number): { lat: number; lng: number } {
  const bessel = tmToGeodetic(x, y, KATEC_PARAM);
  return besselToWgs84(bessel.lat, bessel.lng);
}

/** WGS84(GPS) 좌표를 KATEC으로 변환 */
export function wgs84ToKatec(lat: number, lng: number): { x: number; y: number } {
  // 역변환: WGS84 → Bessel → KATEC TM
  const dA = BESSEL.a - WGS84_DATUM.a;
  const dF = BESSEL.f - WGS84_DATUM.f;
  const dX = 146.43;
  const dY = -507.89;
  const dZ = -681.46;

  const latRad = lat * DEGTORAD;
  const lngRad = lng * DEGTORAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLng = Math.sin(lngRad);
  const cosLng = Math.cos(lngRad);

  const { a, f, e2 } = WGS84_DATUM;
  const Rn = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const Rm = (a * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);

  const dLat =
    ((-dX * sinLat * cosLng - dY * sinLat * sinLng + dZ * cosLat +
      dA * ((Rn * e2 * sinLat * cosLat) / a) +
      dF * (Rm / (1 - f) + Rn * (1 - f)) * sinLat * cosLat) /
      Rm) *
    RADTODEG;

  const dLng =
    ((-dX * sinLng + dY * cosLng) / (Rn * cosLat)) * RADTODEG;

  const besselLat = lat + dLat;
  const besselLng = lng + dLng;

  // Bessel geodetic → KATEC TM
  const { datum, scaleFactor, lonCenter, latCenter, falseEasting, falseNorthing } = KATEC_PARAM;
  const bLatRad = besselLat * DEGTORAD;
  const bLngRad = besselLng * DEGTORAD;

  const { a: bA, e2: bE2 } = datum;
  const bE4 = bE2 * bE2;
  const bE6 = bE4 * bE2;

  const sinB = Math.sin(bLatRad);
  const cosB = Math.cos(bLatRad);
  const tanB = Math.tan(bLatRad);
  const N = bA / Math.sqrt(1 - bE2 * sinB * sinB);
  const T = tanB * tanB;
  const C = (bE2 / (1 - bE2)) * cosB * cosB;
  const A = cosB * (bLngRad - lonCenter);

  const M =
    bA *
    ((1 - bE2 / 4 - 3 * bE4 / 64 - 5 * bE6 / 256) * bLatRad -
      (3 * bE2 / 8 + 3 * bE4 / 32 + 45 * bE6 / 1024) * Math.sin(2 * bLatRad) +
      (15 * bE4 / 256 + 45 * bE6 / 1024) * Math.sin(4 * bLatRad) -
      (35 * bE6 / 3072) * Math.sin(6 * bLatRad));

  const M0 =
    bA *
    ((1 - bE2 / 4 - 3 * bE4 / 64 - 5 * bE6 / 256) * latCenter -
      (3 * bE2 / 8 + 3 * bE4 / 32 + 45 * bE6 / 1024) * Math.sin(2 * latCenter) +
      (15 * bE4 / 256 + 45 * bE6 / 1024) * Math.sin(4 * latCenter) -
      (35 * bE6 / 3072) * Math.sin(6 * latCenter));

  const A2 = A * A;

  const x =
    falseEasting +
    scaleFactor *
      N *
      (A +
        ((1 - T + C) * A * A2) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * (bE2 / (1 - bE2))) * A * A2 * A2) / 120);

  const y =
    falseNorthing +
    scaleFactor *
      (M -
        M0 +
        N *
          tanB *
          (A2 / 2 +
            ((5 - T + 9 * C + 4 * C * C) * A2 * A2) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * (bE2 / (1 - bE2))) * A2 * A2 * A2) / 720));

  return { x, y };
}

// ── API 호출 함수 ──

/** 반경 내 주유소 검색 (aroundAll.do) */
export async function getAroundStations(
  katecX: number,
  katecY: number,
  radius: number = 5000,
  prodCd: string = PROD_CD.GASOLINE,
  sort: 1 | 2 = 1 // 1:가격순, 2:거리순
): Promise<AroundStation[]> {
  const url = `${OPINET_BASE_URL}/aroundAll.do?code=${API_KEY}&x=${katecX}&y=${katecY}&radius=${radius}&sort=${sort}&prodcd=${prodCd}&out=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Opinet API error: ${res.status}`);
  const data = await res.json();
  return data.RESULT.OIL;
}

/** 주유소 상세 조회 (detailById.do) */
export async function getStationDetail(
  uniId: string
): Promise<StationDetail> {
  const url = `${OPINET_BASE_URL}/detailById.do?code=${API_KEY}&id=${uniId}&out=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Opinet API error: ${res.status}`);
  const data = await res.json();
  return data.RESULT.OIL[0];
}
