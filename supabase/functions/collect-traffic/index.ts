import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ITS_API_KEY = Deno.env.get("ITS_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 서울+경기를 9개 작은 그리드로 분할 (각 ~10K 링크, 응답 2~5초)
const ITS_GRIDS = [
  // 남쪽 행 (lat 37.0-37.4)
  { minX: 126.6, minY: 37.0, maxX: 127.0, maxY: 37.4 },
  { minX: 127.0, minY: 37.0, maxX: 127.4, maxY: 37.4 },
  { minX: 127.4, minY: 37.0, maxX: 127.7, maxY: 37.4 },
  // 중간 행 (lat 37.4-37.7)
  { minX: 126.6, minY: 37.4, maxX: 127.0, maxY: 37.7 },
  { minX: 127.0, minY: 37.4, maxX: 127.4, maxY: 37.7 },
  { minX: 127.4, minY: 37.4, maxX: 127.7, maxY: 37.7 },
  // 북쪽 행 (lat 37.7-38.1)
  { minX: 126.6, minY: 37.7, maxX: 127.0, maxY: 38.1 },
  { minX: 127.0, minY: 37.7, maxX: 127.4, maxY: 38.1 },
  { minX: 127.4, minY: 37.7, maxX: 127.7, maxY: 38.1 },
];

interface ITSItem {
  linkId: string;
  speed: string;
  travelTime: string;
}

async function fetchITSGrid(
  grid: (typeof ITS_GRIDS)[0]
): Promise<ITSItem[]> {
  const params = new URLSearchParams({
    apiKey: ITS_API_KEY,
    type: "all",
    drcType: "all",
    minX: grid.minX.toString(),
    minY: grid.minY.toString(),
    maxX: grid.maxX.toString(),
    maxY: grid.maxY.toString(),
    getType: "json",
  });

  const urls = [
    `https://openapi.its.go.kr:9443/trafficInfo?${params}`,
    `http://openapi.its.go.kr:9080/trafficInfo?${params}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const data = await res.json();
      if (data.header?.resultCode === 0 && data.body?.items) {
        return data.body.items;
      }
    } catch {
      continue;
    }
  }
  return [];
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const authHeader = req.headers.get("x-cron-secret");
    const bearerToken = req.headers
      .get("authorization")
      ?.replace("Bearer ", "");
    if (authHeader !== cronSecret && bearerToken !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const startTime = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. ITS API 9개 그리드 순차 호출 (각 2~5초, 총 ~30초)
  const itsMap = new Map<string, { speed: number; travelTime: number }>();
  let itsTotal = 0;
  let gridsOk = 0;

  for (const grid of ITS_GRIDS) {
    const items = await fetchITSGrid(grid);
    if (items.length > 0) gridsOk++;
    itsTotal += items.length;
    for (const item of items) {
      itsMap.set(item.linkId, {
        speed: parseFloat(item.speed),
        travelTime: parseFloat(item.travelTime),
      });
    }
  }

  if (itsMap.size === 0) {
    return new Response(
      JSON.stringify({
        error: "ITS API returned no data from all grids",
        gridsAttempted: ITS_GRIDS.length,
        elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. its_link_id가 있는 주유소 조회 (페이징)
  const allStations: { id: string; its_link_id: string }[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: page, error } = await supabase
      .from("stations")
      .select("id, its_link_id")
      .not("its_link_id", "is", null)
      .range(offset, offset + pageSize - 1);

    if (error || !page || page.length === 0) break;
    allStations.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  // 3. 매칭
  const now = new Date().toISOString();
  const updates: {
    id: string;
    speed: number;
    travelTime: number;
    linkId: string;
  }[] = [];

  for (const station of allStations) {
    const traffic = itsMap.get(station.its_link_id);
    if (traffic && traffic.speed > 0) {
      updates.push({
        id: station.id,
        speed: traffic.speed,
        travelTime: traffic.travelTime,
        linkId: station.its_link_id,
      });
    }
  }

  // 4. stations.road_speed 배치 업데이트
  let speedUpdated = 0;
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    const results = await Promise.all(
      batch.map((u) =>
        supabase
          .from("stations")
          .update({ road_speed: u.speed, road_speed_updated_at: now })
          .eq("id", u.id)
      )
    );
    speedUpdated += results.filter((r) => !r.error).length;
  }

  // 5. traffic_snapshots INSERT
  let snapshotsInserted = 0;
  const snapshotRows = updates.map((u) => ({
    link_id: u.linkId,
    speed: u.speed,
    travel_time: u.travelTime,
    collected_at: now,
  }));

  for (let i = 0; i < snapshotRows.length; i += 500) {
    const batch = snapshotRows.slice(i, i + 500);
    const { error } = await supabase.from("traffic_snapshots").insert(batch);
    if (!error) snapshotsInserted += batch.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const result = {
    success: true,
    itsTotal,
    itsUniqueLinks: itsMap.size,
    gridsOk,
    gridsTotal: ITS_GRIDS.length,
    stationsWithItsLink: allStations.length,
    stationsMatched: updates.length,
    speedUpdated,
    snapshotsInserted,
    elapsed: `${elapsed}s`,
    timestamp: now,
  };

  console.log("[collect-traffic]", JSON.stringify(result));
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
