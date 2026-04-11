import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildBriefingContext } from "@/lib/dashboard/ai-briefing-context";
import { runGuards, applyOverride } from "@/lib/dashboard/ai-briefing-guard";
import { createServiceClient } from "@/lib/supabase";

const client = new Anthropic();

const SYSTEM_PROMPT = `당신은 주유소 옆에서 20년간 장사한 선배 사장님입니다. 후배 사장님에게 오늘 가격 전략을 조언합니다.

반드시 아래 정확히 5줄 구조를 지켜서 작성하세요. 줄 수를 늘리거나 구조를 바꾸지 마세요.

[추천] (인상/유지/인하) ±N원 → 변경 후 가격. (타이밍: 오늘/내일/관망)
[경쟁사] 핵심 경쟁사 움직임 + 왜 움직였는지 해석(유가 반영? 선제 전략? 따라가기?) + 나와의 관계. 선제형이 주도했는지, 추종형이 따라간 것인지 구분할 것.
[리스크] 추천대로 했을 때의 위험 요소 하나. 상충 신호가 있으면 반드시 짚을 것(예: 경쟁사는 올리는데 유가는 내리는 상황).
[판매량] 오늘 예상 판매량 + 내일 전망 + 전략적 의미(가격 변동이 판매에 미칠 영향).
[내일] 내일 주의할 점 한 줄. 구체적 모니터링 포인트 포함.

절대 지키기:
- 정확히 5줄. 각 줄은 반드시 [추천], [경쟁사], [리스크], [판매량], [내일]로 시작.
- 5줄 구조를 반드시 완성된 문장으로 끝내세요. 중간에 잘리지 않도록 각 줄을 간결하게 작성하고, 마지막 [내일] 줄까지 반드시 온점(.)으로 마무리하세요.
- 줄 추가, 빈 줄, 줄바꿈, 머리말/꼬리말 금지.
- "~입니다" "~합니다" 체. 이모지 금지.
- 사실을 나열하지 마세요. 사실 사이의 연결과 의미를 해석하세요.`;

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
  let forecastData: Record<string, unknown> | null = null;
  let crossData: Record<string, unknown> | null = null;
  let integratedData: Record<string, unknown> | null = null;

  try {
    const [insightsRes, salesRes, timingRes, weatherRes, weatherImpactRes, forecastRes, crossRes, integratedRes] = await Promise.all([
      fetch(`${baseUrl}/api/stations/${id}/dashboard-insights`, { next: { revalidate: 1800 } }),
      fetch(`${baseUrl}/api/stations/${id}/sales-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/timing-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/weather`, { next: { revalidate: 600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/weather-sales-analysis`, { next: { revalidate: 3600 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/forecast-review?t=${Date.now()}`, { cache: "no-store" }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/cross-insights?compact=1`, { next: { revalidate: 1800 } }).catch(() => null),
      fetch(`${baseUrl}/api/stations/${id}/integrated-forecast`, { next: { revalidate: 1800 } }).catch(() => null),
    ]);

    if (insightsRes.ok) insights = await insightsRes.json();
    if (salesRes?.ok) salesAnalysis = await salesRes.json();
    if (timingRes?.ok) timingData = await timingRes.json();
    if (weatherRes?.ok) weatherData = await weatherRes.json();
    if (weatherImpactRes?.ok) weatherImpactData = await weatherImpactRes.json();
    if (forecastRes?.ok) forecastData = await forecastRes.json();
    if (crossRes?.ok) crossData = await crossRes.json();
    if (integratedRes?.ok) integratedData = await integratedRes.json();
  } catch {
    // 데이터 수집 실패 시 insights 없이 진행
  }

  if (!insights) {
    return NextResponse.json(
      { aiBriefing: null, fallback: true, error: "데이터 수집 실패" },
      { status: 500 }
    );
  }

  // ── 2. 프롬프트 + ground truth context 빌드 ──
  // dataPrompt 생성 로직은 buildBriefingContext 로 분리되었다. 동작은 동일
  // (한 글자도 바뀌지 않음). context 는 검증 레이어(runGuards) 가 사용한다.
  const { prompt: dataPrompt, context: briefingContext } = buildBriefingContext({
    insights,
    salesAnalysis,
    timingData,
    weatherData,
    weatherImpactData,
    forecastData,
    crossData,
    integratedData,
  });

  // 응답 조립부에서 사용하는 rec 만 별도 추출 (recommendationType 응답용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = ((insights as Record<string, any>) ?? {}).recommendation || {};

  // ── 3. Claude API 호출 ──
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: dataPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const aiBriefing = textBlock && textBlock.type === "text" ? textBlock.text : null;

    // ── 4. 검증 레이어 (3-Guard) ──
    // 정책: 기본 C(원본 + 경고 배지). 단 3a(방향 불일치 error) 시 [추천]
    // 줄만 폴백 텍스트로 교체. 나머지 4줄은 그대로.
    let validation: {
      passed: boolean;
      warnings: ReturnType<typeof runGuards>["result"]["warnings"];
    } = { passed: true, warnings: [] };
    let aiBriefingOverridden: string | null = null;
    if (aiBriefing) {
      const { parsed, result } = runGuards(aiBriefing, briefingContext);
      validation = { passed: result.passed, warnings: result.warnings };
      if (result.recommendationLineOverride) {
        aiBriefingOverridden = applyOverride(
          aiBriefing,
          parsed,
          result.recommendationLineOverride
        );
      }
    }

    // ── 5. 감사 로그 (fire-and-forget) ──
    // 발표용 집계 수치를 위한 인프라. INSERT 실패해도 사용자 응답은 정상 처리.
    // service role 키 사용 (RLS silent failure 방지).
    try {
      const svc = createServiceClient();
      svc
        .from("ai_briefing_log")
        .insert({
          station_id: id,
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
          briefing_text: aiBriefing,
          validation_passed: validation.passed,
          warnings: validation.warnings,
          recommendation_type: rec.type || null,
          rule_rec_type: briefingContext.recType,
        })
        .then(({ error }) => {
          if (error) console.error("ai_briefing_log insert failed:", error.message);
        });
    } catch (e) {
      console.error("ai_briefing_log setup error:", e);
    }

    return NextResponse.json(
      {
        aiBriefing,
        aiBriefingOverridden,
        validation,
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
