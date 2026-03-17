/**
 * ITS 국가교통정보센터 API 클라이언트
 * - 교통소통정보 (trafficInfo): 도로 구간별 실시간 속도/통행시간
 */

const ITS_API_KEY = process.env.ITS_API_KEY!;
const ITS_BASE_URL = "https://openapi.its.go.kr:9443";

export interface TrafficItem {
  roadName: string;
  roadDrcType: string;
  linkNo: string;
  linkId: string;
  startNodeId: string;
  endNodeId: string;
  speed: string;       // km/h
  travelTime: string;  // seconds
  createdDate: string;  // YYYYMMDDHHmmss
}

interface TrafficResponse {
  header: { resultCode: number; resultMsg: string };
  body: {
    totalCount: number;
    items: TrafficItem[];
  } | string;
}

/**
 * 좌표 범위 내 교통소통정보 조회
 * @param minX 최소 경도
 * @param minY 최소 위도
 * @param maxX 최대 경도
 * @param maxY 최대 위도
 */
export async function getTrafficInfo(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Promise<TrafficItem[]> {
  const params = new URLSearchParams({
    apiKey: ITS_API_KEY,
    type: "all",
    drcType: "all",
    minX: minX.toString(),
    minY: minY.toString(),
    maxX: maxX.toString(),
    maxY: maxY.toString(),
    getType: "json",
  });

  const url = `${ITS_BASE_URL}/trafficInfo?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data: TrafficResponse = await res.json();

  if (data.header.resultCode !== 0) {
    throw new Error(`ITS API error: ${data.header.resultMsg} (code: ${data.header.resultCode})`);
  }

  if (typeof data.body === "string" || !data.body.items) {
    return [];
  }

  return data.body.items;
}

/**
 * 전국을 격자로 나눠서 교통소통정보 수집
 * 대한민국 범위: 경도 125.0~130.0, 위도 33.0~38.5
 * 격자 크기 0.5도 -> 약 10x11 = 110회 호출
 */
export const TRAFFIC_GRID = (() => {
  const grids: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  const STEP = 0.5;
  for (let lng = 125.0; lng < 130.0; lng += STEP) {
    for (let lat = 33.0; lat < 38.5; lat += STEP) {
      grids.push({
        minX: Math.round(lng * 100) / 100,
        minY: Math.round(lat * 100) / 100,
        maxX: Math.round((lng + STEP) * 100) / 100,
        maxY: Math.round((lat + STEP) * 100) / 100,
      });
    }
  }
  return grids;
})();
