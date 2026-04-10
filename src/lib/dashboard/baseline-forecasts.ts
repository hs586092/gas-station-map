/**
 * 베이스라인 예측 함수 2종.
 *
 * forecast-review.ts 의 통합 모델과 같은 정확도 지표(MAPE 변형:
 * `100 - mean(|act - pred| / pred * 100)`) 로 공정 비교하기 위한 trivial
 * 베이스라인을 제공한다. 새 테이블 없이 sales_data 를 직접 읽어 계산하며,
 * 스냅샷 rebuild 시 동적으로 계산되어 forecast-review 응답에 포함된다.
 *
 * 중요한 설계 원칙:
 * - **데이터 누수 방지**: 각 target 날짜의 예측은 그 날짜 "이전" 데이터만 본다.
 *   (자기 자신을 평균에 포함시키면 치팅)
 * - **임의 폴백 금지**: 샘플이 부족하면 null 을 반환하고, 호출자가 해당 날짜를
 *   비교 대상에서 제외한다. 임의 값으로 채우지 않는다.
 * - **단위 함수**: 입력/출력이 명확하고 DB 를 직접 호출하지 않는다.
 *   호출자가 sales_data 를 한 번 읽어 dayMap 을 만들어 넘긴다.
 */

/** 요일별 가중치 없는 산술 평균 베이스라인 */
export function calcDowMeanBaseline(
  targetDate: string,
  dayMap: Map<string, number>
): number | null {
  const targetDow = dowFromDateStr(targetDate);
  const sameDow: number[] = [];
  for (const [date, vol] of dayMap) {
    if (date >= targetDate) continue; // 자기 자신 + 미래 제외
    if (dowFromDateStr(date) !== targetDow) continue;
    sameDow.push(vol);
  }
  if (sameDow.length === 0) return null;
  return sameDow.reduce((a, b) => a + b, 0) / sameDow.length;
}

/** 직전 7일 이동평균 베이스라인 (결측이 있으면 있는 것만으로 평균) */
export function calc7dayMABaseline(
  targetDate: string,
  dayMap: Map<string, number>
): number | null {
  const vals: number[] = [];
  const target = new Date(targetDate + "T00:00:00Z");
  for (let i = 1; i <= 7; i++) {
    const d = new Date(target);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const v = dayMap.get(key);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * 주어진 (date, actual, modelPrediction) 튜플 리스트에 대해 세 모델의
 * 오차율(평균 절대 백분율 오차)을 계산한다.
 *
 * - 공식: `avgErrorPct = mean(|actual - predicted| / predicted * 100)`
 * - `accuracy = 100 - avgErrorPct`  (forecast-review.ts 와 동일)
 * - 공정 비교를 위해 **세 모델 모두 예측값을 낼 수 있는 샘플만** 사용한다.
 *   한 모델이라도 null 이면 해당 날짜는 비교에서 제외되고, 제외된 개수는
 *   `droppedCount` 로 반환된다.
 * - 결과 샘플이 0 이면 null 을 반환한다.
 */
export type BaselineComparisonEntry = {
  avgErrorPct: number;
  accuracy: number;
  count: number;
} | null;

export type BaselineComparison = {
  window: "7d" | "30d";
  model: BaselineComparisonEntry;
  dowMean: BaselineComparisonEntry;
  sevenDayMA: BaselineComparisonEntry;
  /** 세 모델 중 더 나은 베이스라인 대비 모델 정확도 개선폭(%p). 둘 다 null 이면 null */
  improvementOverBestBaselinePct: number | null;
  /** 세 모델 모두 예측 가능한 공통 샘플 수 */
  commonSampleCount: number;
  /** 베이스라인 중 하나라도 예측 불가여서 비교에서 제외된 날짜 수 */
  droppedCount: number;
};

export function compareWithBaselines(
  items: Array<{
    date: string;
    actual: number;
    modelPredicted: number;
    dowBaseline: number | null;
    sevenDayMABaseline: number | null;
  }>,
  window: "7d" | "30d"
): BaselineComparison {
  const usable = items.filter(
    (it) =>
      it.dowBaseline != null &&
      it.sevenDayMABaseline != null &&
      it.modelPredicted > 0 &&
      Number.isFinite(it.actual)
  );
  const dropped = items.length - usable.length;

  function mapeFromPairs(pairs: Array<{ actual: number; predicted: number }>): BaselineComparisonEntry {
    if (pairs.length === 0) return null;
    const errors = pairs.map((p) =>
      p.predicted > 0 ? Math.abs((p.actual - p.predicted) / p.predicted) * 100 : 0
    );
    const avg = errors.reduce((a, b) => a + b, 0) / errors.length;
    return {
      avgErrorPct: +avg.toFixed(1),
      accuracy: +(100 - avg).toFixed(1),
      count: pairs.length,
    };
  }

  const model = mapeFromPairs(
    usable.map((u) => ({ actual: u.actual, predicted: u.modelPredicted }))
  );
  const dowMean = mapeFromPairs(
    usable.map((u) => ({ actual: u.actual, predicted: u.dowBaseline as number }))
  );
  const sevenDayMA = mapeFromPairs(
    usable.map((u) => ({ actual: u.actual, predicted: u.sevenDayMABaseline as number }))
  );

  let improvement: number | null = null;
  if (model && (dowMean || sevenDayMA)) {
    const baselineAccs = [dowMean?.accuracy, sevenDayMA?.accuracy].filter(
      (x): x is number => x != null
    );
    if (baselineAccs.length > 0) {
      const bestBaselineAcc = Math.max(...baselineAccs);
      improvement = +(model.accuracy - bestBaselineAcc).toFixed(1);
    }
  }

  return {
    window,
    model,
    dowMean,
    sevenDayMA,
    improvementOverBestBaselinePct: improvement,
    commonSampleCount: usable.length,
    droppedCount: dropped,
  };
}

// ── 유틸: YYYY-MM-DD → 0(일)~6(토) ──
function dowFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
