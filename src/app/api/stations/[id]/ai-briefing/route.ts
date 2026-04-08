import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const client = new Anthropic();

const SYSTEM_PROMPT = `당신은 주유소 옆에서 20년간 장사한 선배 사장님입니다. 후배 사장님에게 오늘 가격 전략을 조언합니다.

규칙:
- 사실을 나열하지 마세요. 사실 사이의 연결과 의미를 해석하세요.
- 상충하는 신호가 있으면 반드시 짚으세요 (예: 경쟁사는 올리는데 유가는 내리는 상황)
- 행동의 리스크도 말하세요 (예: 지금 올리면 2주 후 다시 내려야 할 수 있다)
- 타이밍을 조언하세요 (오늘 할지, 내일까지 기다릴지, 이번 주는 관망할지)
- 경쟁사가 왜 그렇게 움직였는지 추측하세요 (유가 반영? 선제 전략? 따라가기?)

구조 (총 7줄 이내):
1줄: 핵심 추천 + 금액
2~4줄: 인사이트 (왜 이렇게 추천하는지, 상충 신호는 뭔지, 리스크는 뭔지)
5줄: 내일 주의할 점
[뉴스] 헤드라인 한 줄 (20자 이내)
[영향] 실시간 유가 영향 한 줄

절대 지키기:
- 7줄 초과 금지. 뉴스 없으면 5줄로 끝내기.
- "~입니다" "~합니다" 체. 이모지 금지.
- 나쁜 예 (사실 나열): "경쟁사 9곳 인상. 평균 1,980원. 예상 판매량 29,412L."
- 좋은 예 (인사이트): "경쟁사가 유가 상승분을 반영 중이지만, 휴전 뉴스로 유가가 급락하고 있어 지금 큰 폭 인상은 위험합니다. 10원만 보수적으로 올려 시장 흐름에 발을 맞추되, 유가 하락이 확인되면 추가 인상은 보류하세요."

[뉴스] 예시:
[뉴스] 이란-미국 2주 휴전 합의
[영향] Brent $95.8, 전일 대비 -$3.2 하락 중`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 1. 기존 API에서 데이터 수집 ──
  const baseUrl = request.nextUrl.origin;

  let insights: Record<string, unknown> | null = null;
  let salesAnalysis: Record<string, unknown> | null = null;
  let timingData: Record<string, unknown> | null = null;
  let weatherData: Record<string, unknown> | null = null;
  let weatherImpactData: Record<string, unknown> | null = null;

  try {
    const [insightsRes, salesRes, timingRes, weatherRes, weatherImpactRes] = await Promise.all([
      fetch(`${baseUrl}/api/stations/${id}/dashboard-insights`, { next: { revalidate: 1800 } }),
      fetch(`${baseUrl}/api/stations/${id}/sales-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/timing-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/weather`, { next: { revalidate: 600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/weather-sales-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
    ]);

    if (insightsRes.ok) insights = await insightsRes.json();
    if (salesRes?.ok) salesAnalysis = await salesRes.json();
    if (timingRes?.ok) timingData = await timingRes.json();
    if (weatherRes?.ok) weatherData = await weatherRes.json();
    if (weatherImpactRes?.ok) weatherImpactData = await weatherImpactRes.json();
  } catch {
    // 데이터 수집 실패 시 insights 없이 진행
  }

  if (!insights) {
    return NextResponse.json(
      { aiBriefing: null, fallback: true, error: "데이터 수집 실패" },
      { status: 500 }
    );
  }

  // ── 2. 프롬프트용 데이터 정리 (토큰 최소화) ──
  const ins = insights as Record<string, any>;
  const sales = salesAnalysis as Record<string, any> | null;
  const timing = timingData as Record<string, any> | null;

  const compPattern = ins.competitorPattern || {};
  const oilTrend = ins.oilWeekTrend || {};
  const weeklyTrend = ins.weeklyTrend || {};
  const rec = ins.recommendation || {};
  const rank = ins.rankChange?.gasoline || {};
  const bf = ins.briefingFactors || {};

  // 경쟁사 가격 차이 (주요 4곳)
  const compProfiles = (ins.competitorProfiles || []).slice(0, 5);

  let dataPrompt = `[오늘의 데이터]\n`;
  dataPrompt += `내가격: 휘발유 ${bf.position?.myPrice?.toLocaleString() ?? "?"}원`;
  if (rank.today) dataPrompt += ` (${rank.today.rank}위/${rank.today.total}곳)`;
  if (rank.diff != null && rank.diff !== 0) dataPrompt += ` 어제대비 ${rank.diff > 0 ? "▼" : "▲"}${Math.abs(rank.diff)}단계`;
  dataPrompt += `\n`;

  dataPrompt += `경쟁사평균: ${bf.position?.avgPrice?.toLocaleString() ?? "?"}원 (차이: ${bf.position?.priceDiff > 0 ? "+" : ""}${bf.position?.priceDiff ?? "?"}원)\n`;
  dataPrompt += `포지션: ${ins.myPosition === "expensive" ? "평균보다 비쌈" : ins.myPosition === "cheap" ? "평균보다 저렴" : "평균 수준"}\n`;

  dataPrompt += `경쟁사오늘: 인상${compPattern.risingCount ?? 0}곳 인하${compPattern.fallingCount ?? 0}곳 유지${compPattern.stableCount ?? 0}곳\n`;

  if (compProfiles.length > 0) {
    dataPrompt += `주요경쟁사: `;
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
    dataPrompt += `판매량: 30일평균 ${sales.summary.avg30d?.gasoline?.toLocaleString() ?? "?"}L/일`;
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
  const wx = weatherData as Record<string, any> | null;
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

  // 날씨 기반 판매량 예측 (weather-sales-analysis)
  const wsa = weatherImpactData as Record<string, any> | null;
  if (wsa?.todayForecast) {
    const f = wsa.todayForecast;
    dataPrompt += `날씨기반예상판매량: ${f.expectedVolume?.toLocaleString()}L (${f.explanation})`;
    if (f.confidence) dataPrompt += ` [신뢰도:${f.confidence}]`;
    dataPrompt += `\n`;
    // 본격 비 영향 (과거 관측)
    const heavy = (wsa.byIntensity as Array<any> | undefined)?.find((b) => b.key === "heavy");
    if (heavy && heavy.n >= 10) {
      dataPrompt += `과거 본격비(≥5mm) 영향: 판매량 ${heavy.adjustedDiffPct >= 0 ? "+" : ""}${heavy.adjustedDiffPct}% (n=${heavy.n}, 요일보정)`;
      if (wsa.tTest?.significant) dataPrompt += ` [통계 유의]`;
      dataPrompt += `\n`;
    }
  }

  dataPrompt += `\n기존규칙기반추천: ${rec.message || "없음"} (타입: ${rec.type || "?"})`;
  if (rec.suggestedRange) dataPrompt += ` 권장범위: ${rec.suggestedRange.min}~${rec.suggestedRange.max}원`;

  // ── 3. Claude API 호출 (web_search 도구 포함) ──
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: "web_search_20250305" as const,
          name: "web_search",
          max_uses: 3,
        },
      ],
      messages: [{ role: "user", content: dataPrompt }],
    }, { timeout: 30000 });

    // web_search 사용 시 여러 content block이 올 수 있음 — text만 합치기
    const textParts = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    const aiBriefing = textParts.join("\n") || null;

    return NextResponse.json(
      {
        aiBriefing,
        fallback: false,
        recommendationType: rec.type || "hold",
        webSearchUsed: message.content.some((b) => b.type === "web_search_tool_result"),
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" } }
    );
  } catch (err) {
    console.error("Claude API error:", err);
    return NextResponse.json(
      {
        aiBriefing: null,
        fallback: true,
        fallbackMessage: rec.message || "분석 데이터를 불러올 수 없습니다.",
        recommendationType: rec.type || "hold",
        error: "Claude API 호출 실패",
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  }
}
