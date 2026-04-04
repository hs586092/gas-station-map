import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `당신은 주유소 경영 분석 전문가입니다. 사장님에게 직접 조언하듯 오늘의 경영 브리핑을 작성하세요.

핵심 질문: "오늘 가격을 바꿔야 하나? 바꾼다면 얼마나?"

작성 규칙:
- 첫 줄: 핵심 추천 한 문장 (예: "현 가격 유지가 적절합니다" 또는 "10~20원 인상을 검토하세요")
- 이후: 판단 근거 3~4가지를 각각 1~2문장으로
- 구체적 숫자(가격, 판매량, 순위)를 반드시 포함
- 경쟁사 이름을 언급하며 구체적으로 설명
- 마지막에 "주의할 점" 또는 "내일 확인할 것" 1줄
- 전체 길이: 150~250자 이내
- 이모지 사용하지 마세요
- "~입니다" "~합니다" 체로 작성`;

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

  try {
    const [insightsRes, salesRes, timingRes] = await Promise.all([
      fetch(`${baseUrl}/api/stations/${id}/dashboard-insights`, { next: { revalidate: 1800 } }),
      fetch(`${baseUrl}/api/stations/${id}/sales-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/timing-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
    ]);

    if (insightsRes.ok) insights = await insightsRes.json();
    if (salesRes?.ok) salesAnalysis = await salesRes.json();
    if (timingRes?.ok) timingData = await timingRes.json();
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

  dataPrompt += `\n기존규칙기반추천: ${rec.message || "없음"} (타입: ${rec.type || "?"})`;
  if (rec.suggestedRange) dataPrompt += ` 권장범위: ${rec.suggestedRange.min}~${rec.suggestedRange.max}원`;

  // ── 3. Claude API 호출 ──
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: dataPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const aiBriefing = textBlock ? textBlock.text : null;

    return NextResponse.json(
      {
        aiBriefing,
        fallback: false,
        recommendationType: rec.type || "hold",
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
