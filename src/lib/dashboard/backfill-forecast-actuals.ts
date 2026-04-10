import { createServiceClient } from "@/lib/supabase";

/**
 * forecast_history.actual_* 값을 sales_data / carwash_daily 로부터 채운다.
 *
 * ## 왜 필요한가
 * 대시보드는 `dashboard_snapshot` 테이블의 캐시된 JSON을 읽는다.
 * 스냅샷이 만들어지는 시점에 `forecast_history.actual_*` 가 null 이면
 * 스냅샷이 `actual: null` 로 얼어붙어 이후 동기화가 반영되지 않는다.
 *
 * 그래서 스냅샷을 만들기 "직전"에 반드시 이 함수를 await 해야 한다.
 * 호출 지점:
 *   1) `/api/sync-sales` 완료 직후 (GAS → sales_data 갱신 후)
 *   2) `/api/snapshot/rebuild` 시작 전 (수동 새로고침 + 크론)
 *
 * ## 왜 서비스 키를 쓰는가
 * forecast_history 의 RLS 는 현재 anon UPDATE 를 허용하지만, 이 헬퍼는
 * 크론/서버 사이드에서만 돌고 사용자 토큰에 의존하지 않으므로
 * service role 로 고정해둔다. 추후 RLS 가 조여져도 이 경로는 영향 없다.
 *
 * ## 대상 컬럼
 * - actual_volume  ← sales_data.gasoline_volume + diesel_volume
 * - actual_count   ← sales_data.gasoline_count  + diesel_count
 * - actual_carwash ← carwash_daily.total_count
 */
export async function backfillForecastActuals(
  stationId: string
): Promise<{ updated: number; error: string | null }> {
  const svc = createServiceClient();

  // 최근 60일치만 대상 (과거 아주 오래된 레코드는 건드리지 않는다)
  const sixtyAgo = new Date(Date.now() - 60 * 86400000)
    .toISOString()
    .split("T")[0];

  // 1. 대상 레코드 수집
  const { data: rows, error: rowErr } = await svc
    .from("forecast_history")
    .select("id, forecast_date, actual_volume, actual_count, actual_carwash")
    .eq("station_id", stationId)
    .gte("forecast_date", sixtyAgo);

  if (rowErr) return { updated: 0, error: rowErr.message };
  if (!rows || rows.length === 0) return { updated: 0, error: null };

  // 2. 해당 날짜 범위의 sales / carwash 실측 한 번에 조회
  const dates = rows.map((r) => r.forecast_date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const [salesRes, cwRes] = await Promise.all([
    svc
      .from("sales_data")
      .select("date, gasoline_volume, diesel_volume, gasoline_count, diesel_count")
      .eq("station_id", stationId)
      .gte("date", minDate)
      .lte("date", maxDate),
    svc
      .from("carwash_daily")
      .select("date, total_count")
      .eq("station_id", stationId)
      .gte("date", minDate)
      .lte("date", maxDate),
  ]);

  if (salesRes.error) return { updated: 0, error: salesRes.error.message };
  // carwash 조회 실패는 치명적이지 않다 (carwash 가 없는 주유소도 있을 수 있음)
  // → 에러 로깅만 하고 카워시 부분은 건너뛴다.

  const salesVol = new Map<string, number>();
  const salesCnt = new Map<string, number>();
  for (const s of salesRes.data ?? []) {
    const vol = (Number(s.gasoline_volume) || 0) + (Number(s.diesel_volume) || 0);
    const cnt = (Number(s.gasoline_count) || 0) + (Number(s.diesel_count) || 0);
    salesVol.set(s.date, vol);
    salesCnt.set(s.date, cnt);
  }
  const cwCnt = new Map<string, number>();
  for (const c of cwRes.data ?? []) {
    cwCnt.set(c.date, Number(c.total_count) || 0);
  }

  // 3. 각 레코드에 대해 필요한 필드만 UPDATE
  //    "값이 없거나(null), 동기화 전 0으로 찍혔지만 이제 실제값이 들어온 경우,
  //     혹은 현재값이 실측과 다른 경우" 모두 갱신.
  let updated = 0;
  for (const fc of rows) {
    const updates: Record<string, number> = {};

    // 부동소수점 반올림 오차(예: 22407.559999999998 vs 22407.56)는 무시
    const vol = salesVol.get(fc.forecast_date);
    if (vol != null) {
      const cur = fc.actual_volume;
      if (cur == null || (Number(cur) === 0 && vol > 0) || Math.abs(Number(cur) - vol) > 0.01) {
        updates.actual_volume = vol;
      }
    }

    const cnt = salesCnt.get(fc.forecast_date);
    if (cnt != null) {
      const cur = fc.actual_count;
      if (cur == null || (Number(cur) === 0 && cnt > 0) || Number(cur) !== cnt) {
        updates.actual_count = cnt;
      }
    }

    const cw = cwCnt.get(fc.forecast_date);
    if (cw != null) {
      const cur = fc.actual_carwash;
      if (cur == null || (Number(cur) === 0 && cw > 0) || Number(cur) !== cw) {
        updates.actual_carwash = cw;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    const { error: upErr } = await svc
      .from("forecast_history")
      .update(updates)
      .eq("id", fc.id);

    if (upErr) {
      return { updated, error: upErr.message };
    }
    updated += 1;
  }

  return { updated, error: null };
}
