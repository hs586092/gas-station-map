/**
 * AI 브리핑용 컨텍스트 빌더.
 *
 * 목적: ai-briefing/route.ts 의 인라인 dataPrompt 생성 로직을 순수 함수로
 * 분리하여, (1) 동일한 prompt 문자열을 만들고, (2) 검증 레이어가 사용할
 * 구조화된 ground truth(BriefingContext)도 함께 반환한다.
 *
 * 중요한 설계 원칙:
 * - **fetch 는 호출자가 담당**. 이 함수는 이미 받아온 raw JSON 만 받는다.
 *   덕분에 단위 테스트 가능하고, route.ts 의 캐싱 정책과 분리됨.
 * - **prompt 문자열 동작 보존**. 이 리팩토링의 PR 수락 조건은 "기존 응답과
 *   diff 0". 따라서 기존 분기 순서/공백/줄바꿈/포맷 문자열을 한 글자도 바꾸지
 *   않는다.
 * - **Record<string, any> 회피**. BriefingContext 를 명시 타입으로 선언하여
 *   guard 레이어가 안전하게 소비할 수 있게 한다.
 */

export type RecType = "raise" | "hold" | "lower" | "watch";
export type TimingHint = "오늘" | "내일" | "관망" | null;

export type BriefingContext = {
  myPrice: number | null;
  avgPrice: number | null;
  /** 통합예측 우선, 없으면 날씨기반 예측 fallback */
  expectedVolumeToday: number | null;
  suggestedRange: { min: number; max: number } | null;
  recType: RecType;
  /** timing-analysis 의 currentSituation.urgency 가 none 이 아닐 때만 채워짐 */
  timingHint: TimingHint;
  /** 5km 반경 경쟁사 전체 이름 (프롬프트에 들어간 5개 슬라이스가 아님) */
  competitorNames: string[];
};

/**
 * 8개 raw JSON 을 받아 (prompt 문자열, ground truth context) 둘 다 반환.
 *
 * 입력 형태는 ai-briefing/route.ts 의 Promise.all 결과를 그대로 받는다.
 * null 안전. 누락된 필드는 prompt 에서 자동 생략(기존 동작과 동일).
 */
export function buildBriefingContext(rawData: {
  insights: Record<string, unknown> | null;
  salesAnalysis: Record<string, unknown> | null;
  timingData: Record<string, unknown> | null;
  weatherData: Record<string, unknown> | null;
  weatherImpactData: Record<string, unknown> | null;
  forecastData: Record<string, unknown> | null;
  crossData: Record<string, unknown> | null;
  integratedData: Record<string, unknown> | null;
}): { prompt: string; context: BriefingContext } {
  // ── insights / sales / timing 헬퍼 alias (기존 route.ts 와 동일 구조) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ins = (rawData.insights ?? {}) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sales = rawData.salesAnalysis as Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timing = rawData.timingData as Record<string, any> | null;

  const compPattern = ins.competitorPattern || {};
  const oilTrend = ins.oilWeekTrend || {};
  const weeklyTrend = ins.weeklyTrend || {};
  const rec = ins.recommendation || {};
  const rank = ins.rankChange?.gasoline || {};
  const bf = ins.briefingFactors || {};

  // 경쟁사 가격 차이 (주요 4곳) — prompt 용 슬라이스 (기존 동작 보존)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compProfiles = (ins.competitorProfiles || []).slice(0, 5) as Array<any>;

  // ─────────────────────────────────────────────────────────────
  // 아래 dataPrompt 조립 블록은 기존 route.ts(line 87~213) 의 코드를
  // 한 글자도 바꾸지 않고 그대로 옮긴다. 변경하면 PR 수락 조건(diff 0)이
  // 깨진다. 검증 레이어가 추가하고 싶은 줄이 있더라도 이 함수가 아니라
  // guard 쪽에서 처리한다.
  // ─────────────────────────────────────────────────────────────
  let dataPrompt = `[오늘의 데이터]\n`;
  dataPrompt += `내가격: 휘발유 ${bf.position?.myPrice?.toLocaleString() ?? "?"}원`;
  if (rank.today) dataPrompt += ` (${rank.today.rank}위/${rank.today.total}곳)`;
  if (rank.diff != null && rank.diff !== 0) dataPrompt += ` 어제대비 ${rank.diff > 0 ? "▼" : "▲"}${Math.abs(rank.diff)}단계`;
  dataPrompt += `\n`;

  dataPrompt += `경쟁사평균: ${bf.position?.avgPrice?.toLocaleString() ?? "?"}원 (차이: ${bf.position?.priceDiff > 0 ? "+" : ""}${bf.position?.priceDiff ?? "?"}원)\n`;
  dataPrompt += `포지션: ${ins.myPosition === "expensive" ? "평균보다 비쌈" : ins.myPosition === "cheap" ? "평균보다 저렴" : "평균 수준"}\n`;

  dataPrompt += `경쟁사오늘: ${compPattern.message}\n`;

  if (compProfiles.length > 0) {
    dataPrompt += `주요경쟁사: `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataPrompt += compProfiles.map((c: any) => `${c.name}(${c.currentPrice?.toLocaleString() ?? "?"}원, ${c.typeLabel})`).join(", ");
    dataPrompt += `\n`;
  }

  if (bf.oil) {
    dataPrompt += `유가: Brent $${bf.oil.latestBrent?.toFixed(1) ?? "?"}`;
    dataPrompt += ` (2주전대비 ${bf.oil.brent2wChange >= 0 ? "+" : ""}$${bf.oil.brent2wChange?.toFixed(1)})`;
    dataPrompt += ` 반영상태: ${bf.oil.reflectionStatus === "reflected" ? `반영완료(${bf.oil.myPriceChange > 0 ? "+" : ""}${bf.oil.myPriceChange}원)` : bf.oil.reflectionStatus === "not_reflected" ? "미반영" : "해당없음"}`;
    dataPrompt += `\n`;
  }

  dataPrompt += `1주유가추세: ${oilTrend.message || "정보없음"}\n`;
  dataPrompt += `7일경쟁추세: ${weeklyTrend.message || "정보없음"}\n`;

  if (sales?.summary) {
    // 오늘 예상값(integratedForecast.expectedVolume)은 합계 단위(휘발유+경유)이므로
    // 30일평균도 합계 기준으로 제시하여 단위 일치 유지. 이전엔 휘발유 단독값만 주입하여
    // LLM 이 "오늘 합계 vs 30일평균 휘발유" 비교를 출력하는 사고 발생 (2026-04-20).
    const g = sales.summary.avg30d?.gasoline;
    const d = sales.summary.avg30d?.diesel;
    if (typeof g === "number" && typeof d === "number") {
      const total = g + d;
      dataPrompt += `판매량: 30일평균 ${total.toLocaleString()}L/일(합계, 휘발유 ${g.toLocaleString()}L + 경유 ${d.toLocaleString()}L)`;
    } else if (typeof g === "number") {
      // 경유 값 누락 fallback — 휘발유 단독이라는 점 명시
      dataPrompt += `판매량: 30일평균 ${g.toLocaleString()}L/일(휘발유 단독, 경유 데이터 없음)`;
    } else {
      dataPrompt += `판매량: 30일평균 데이터 부족`;
    }
    if (sales.summary.elasticity != null) dataPrompt += ` 탄력성: ${sales.summary.elasticity}(${sales.summary.elasticityLabel})`;
    dataPrompt += `\n`;
    if (sales.events?.[0]) {
      const e = sales.events[0];
      dataPrompt += `최근가격변경: ${e.date?.slice(5)} ${e.priceChange > 0 ? "+" : ""}${e.priceChange}원 → 판매량 ${e.volumeChangeRate > 0 ? "+" : ""}${e.volumeChangeRate}%\n`;
    }
  }

  if (timing?.currentSituation?.urgency && timing.currentSituation.urgency !== "none") {
    dataPrompt += `타이밍경고: ${timing.currentSituation.message}\n`;
  }

  // 날씨 정보 (하남시)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wx = rawData.weatherData as Record<string, any> | null;
  if (wx?.today) {
    const codeMap: Record<number, string> = {
      0: "맑음", 1: "대체로 맑음", 2: "부분 흐림", 3: "흐림",
      45: "안개", 48: "안개", 51: "이슬비", 53: "이슬비", 55: "이슬비",
      61: "비", 63: "비", 65: "강한 비", 71: "눈", 73: "눈", 75: "폭설",
      80: "소나기", 81: "소나기", 82: "강한 소나기", 95: "뇌우",
    };
    const todayLabel = codeMap[wx.today.weatherCode] || "-";
    dataPrompt += `날씨: 하남시 오늘 ${todayLabel}`;
    if (wx.today.tempMin != null && wx.today.tempMax != null) {
      dataPrompt += ` ${Math.round(wx.today.tempMin)}°~${Math.round(wx.today.tempMax)}°`;
    }
    if (wx.today.precipProbMax != null) {
      dataPrompt += ` 강수확률 ${wx.today.precipProbMax}%`;
    }
    if (wx.tomorrow) {
      const tmrLabel = codeMap[wx.tomorrow.weatherCode] || "-";
      dataPrompt += ` / 내일 ${tmrLabel}`;
      if (wx.tomorrow.precipProbMax != null) dataPrompt += ` ${wx.tomorrow.precipProbMax}%`;
    }
    dataPrompt += `\n`;
  }

  // 통합 판매량 예측 (날씨 + 가격 + 경쟁사)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = (rawData.integratedData as Record<string, any>)?.forecast;
  if (ig) {
    dataPrompt += `통합예상판매량: ${ig.expectedVolume?.toLocaleString()}L (${ig.explanation}) [신뢰도:${ig.confidence}]\n`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contribs = (ig.contributions as Array<any> | undefined)?.filter((c: any) => Math.abs(c.value) >= 10);
    if (contribs && contribs.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dataPrompt += `변수분해: ${contribs.map((c: any) => `${c.label} ${c.value > 0 ? "+" : ""}${c.value}L(${c.badge})`).join(", ")}\n`;
    }
    if (ig.weatherOnly && ig.weatherOnly !== ig.expectedVolume) {
      dataPrompt += `날씨만예측: ${ig.weatherOnly?.toLocaleString()}L → 통합모델 차이: ${ig.expectedVolume - ig.weatherOnly > 0 ? "+" : ""}${ig.expectedVolume - ig.weatherOnly}L\n`;
    }
  } else {
    // fallback: 날씨 기반 판매량 예측 (weather-sales-analysis)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsaFallback = rawData.weatherImpactData as Record<string, any> | null;
    if (wsaFallback?.todayForecast) {
      const f = wsaFallback.todayForecast;
      dataPrompt += `날씨기반예상판매량: ${f.expectedVolume?.toLocaleString()}L (${f.explanation})`;
      if (f.confidence) dataPrompt += ` [신뢰도:${f.confidence}]`;
      dataPrompt += `\n`;
    }
  }
  // 본격 비 영향 (과거 관측)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsa = rawData.weatherImpactData as Record<string, any> | null;
  if (wsa) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heavy = (wsa.byIntensity as Array<any> | undefined)?.find((b) => b.key === "heavy");
    if (heavy && heavy.n >= 10) {
      dataPrompt += `과거 본격비(≥5mm) 영향: 판매량 ${heavy.adjustedDiffPct >= 0 ? "+" : ""}${heavy.adjustedDiffPct}% (n=${heavy.n}, 요일보정)`;
      if (wsa.tTest?.significant) dataPrompt += ` [통계 유의]`;
      dataPrompt += `\n`;
    }
  }

  // 세차장 데이터
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = rawData.forecastData as Record<string, any> | null;
  const cwYesterday = fc?.yesterday;
  if (cwYesterday?.carwashCount != null) {
    dataPrompt += `세차: 어제 ${cwYesterday.carwashCount}대`;
    dataPrompt += `\n`;
  }

  // 비 다음날 세차 증가율
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cwWeather = (rawData.weatherImpactData as Record<string, any>)?.carwashWeather;
  if (cwWeather?.lag1Correlation != null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heavy = cwWeather.byIntensity?.find((b: any) => b.key === "heavy");
    if (heavy?.diffPct != null && heavy.n >= 3) {
      dataPrompt += `비다음날세차: 강한비 후 세차 ${heavy.diffPct >= 0 ? "+" : ""}${heavy.diffPct}% (n=${heavy.n})\n`;
    }
  }

  // 크로스 인사이트 (유사 사례)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cx = rawData.crossData as Record<string, any> | null;
  if (cx?.similarDays?.count >= 3) {
    const sd = cx!.similarDays;
    dataPrompt += `유사과거사례: ${sd.count}일 평균 주유 ${sd.avgFuelCount}대, 세차 ${sd.avgCarwashCount}대, 전환율 ${sd.avgConversionPct}% [${sd.confidence}]\n`;
  }
  if (cx?.weatherTriple?.carwashDrivenFuel) {
    dataPrompt += `교차분석: 세차 드리븐 주유 확인 — ${cx.weatherTriple.insight}\n`;
  }

  dataPrompt += `\n기존규칙기반추천: ${rec.message || "없음"} (타입: ${rec.type || "?"})`;
  if (rec.suggestedRange) dataPrompt += ` 권장범위: ${rec.suggestedRange.min}~${rec.suggestedRange.max}원`;

  // ─────────────────────────────────────────────────────────────
  // ground truth context 추출 (검증 레이어가 사용)
  // ─────────────────────────────────────────────────────────────
  const myPrice = typeof bf.position?.myPrice === "number" ? bf.position.myPrice : null;
  const avgPrice = typeof bf.position?.avgPrice === "number" ? bf.position.avgPrice : null;

  let expectedVolumeToday: number | null = null;
  if (typeof ig?.expectedVolume === "number") {
    expectedVolumeToday = ig.expectedVolume;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsaFallback = rawData.weatherImpactData as Record<string, any> | null;
    if (typeof wsaFallback?.todayForecast?.expectedVolume === "number") {
      expectedVolumeToday = wsaFallback.todayForecast.expectedVolume;
    }
  }

  const suggestedRange =
    rec.suggestedRange &&
    typeof rec.suggestedRange.min === "number" &&
    typeof rec.suggestedRange.max === "number"
      ? { min: rec.suggestedRange.min as number, max: rec.suggestedRange.max as number }
      : null;

  const recTypeRaw = typeof rec.type === "string" ? rec.type : "hold";
  const recType: RecType = (["raise", "hold", "lower", "watch"] as const).includes(
    recTypeRaw as RecType
  )
    ? (recTypeRaw as RecType)
    : "hold";

  // timingHint: timing.currentSituation.urgency 가 none 이 아닐 때 메시지에서 추출 시도
  let timingHint: TimingHint = null;
  const timingMsg: string | undefined = timing?.currentSituation?.message;
  if (timingMsg && timing?.currentSituation?.urgency && timing.currentSituation.urgency !== "none") {
    if (timingMsg.includes("오늘")) timingHint = "오늘";
    else if (timingMsg.includes("내일")) timingHint = "내일";
    else if (timingMsg.includes("관망")) timingHint = "관망";
  }

  // 경쟁사 전체 목록 (5개 슬라이스가 아닌 전체 — 화이트리스트용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCompetitors = (ins.competitorProfiles || []) as Array<any>;
  const competitorNames: string[] = allCompetitors
    .map((c) => (typeof c?.name === "string" ? c.name : null))
    .filter((n): n is string => n !== null && n.length > 0);

  const context: BriefingContext = {
    myPrice,
    avgPrice,
    expectedVolumeToday,
    suggestedRange,
    recType,
    timingHint,
    competitorNames,
  };

  return { prompt: dataPrompt, context };
}
