/**
 * 발표용 데모 스크립트.
 *
 * 목적: KAIST AI 모임 발표에서 "검증 레이어가 작동하는 실제 사례 한 장면"
 * 을 보여주기 위한 오염 프롬프트 시뮬레이션. 프로덕션 코드는 아니고
 * scripts/ 폴더에서 수동 실행한다.
 *
 *   npx tsx scripts/ai-briefing-guard-demo.ts
 *
 * 3개 시나리오:
 *   A. suggestedRange 를 {min:0, max:0} 으로 주입 → 3a/3b 발동 기대
 *   B. competitorProfiles 이름을 X1, X2, X3 로 치환 → 룰 2 발동 기대
 *   C. myPrice = 9999 로 주입 → 룰 1 발동 기대
 *
 * 각 시나리오마다 "정상 vs 오염 vs 검증 결과" 3단을 출력.
 *
 * 외부 호출: dashboard-insights API + Anthropic API.
 * Anthropic API 는 .env.local 의 ANTHROPIC_API_KEY 가 필요하다.
 */

// .env.local 의 ANTHROPIC_API_KEY 를 사용하려면:
//   npx tsx --env-file=.env.local scripts/ai-briefing-guard-demo.ts
import Anthropic from "@anthropic-ai/sdk";
import {
  buildBriefingContext,
  type BriefingContext,
} from "../src/lib/dashboard/ai-briefing-context";
import { runGuards } from "../src/lib/dashboard/ai-briefing-guard";

const PROD_BASE = "https://slpanalytics.vercel.app";
const STATION_ID = "A0003453";

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

const client = new Anthropic();

async function fetchAll() {
  const urls = [
    `${PROD_BASE}/api/stations/${STATION_ID}/dashboard-insights`,
    `${PROD_BASE}/api/stations/${STATION_ID}/sales-analysis`,
    `${PROD_BASE}/api/stations/${STATION_ID}/timing-analysis`,
    `${PROD_BASE}/api/weather`,
    `${PROD_BASE}/api/stations/${STATION_ID}/weather-sales-analysis`,
    `${PROD_BASE}/api/stations/${STATION_ID}/forecast-review`,
    `${PROD_BASE}/api/stations/${STATION_ID}/cross-insights?compact=1`,
    `${PROD_BASE}/api/stations/${STATION_ID}/integrated-forecast`,
  ];
  const responses = await Promise.all(
    urls.map((u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null))
  );
  const [insights, salesAnalysis, timingData, weatherData, weatherImpactData, forecastData, crossData, integratedData] = responses;
  return {
    insights,
    salesAnalysis,
    timingData,
    weatherData,
    weatherImpactData,
    forecastData,
    crossData,
    integratedData,
  };
}

async function callClaude(prompt: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

function divider(label: string) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(78));
}

function printValidation(text: string, ctx: BriefingContext) {
  const { result } = runGuards(text, ctx);
  console.log(`  validation.passed = ${result.passed}`);
  console.log(`  warnings (${result.warnings.length}):`);
  for (const w of result.warnings) {
    console.log(`    [${w.severity}] ${w.rule} L${w.line}: ${w.detail}`);
  }
  if (result.recommendationLineOverride) {
    console.log(`  recommendationLineOverride: ${result.recommendationLineOverride}`);
  }
}

async function main() {
  divider("0. 정상 호출 (대조군)");
  const raw = await fetchAll();
  if (!raw.insights) {
    console.error("dashboard-insights 응답 실패. 종료.");
    process.exit(1);
  }

  const { prompt: cleanPrompt, context: cleanCtx } = buildBriefingContext(raw);
  console.log("[정상 context]");
  console.log(`  myPrice=${cleanCtx.myPrice}`);
  console.log(`  avgPrice=${cleanCtx.avgPrice}`);
  console.log(`  expectedVolumeToday=${cleanCtx.expectedVolumeToday}`);
  console.log(`  recType=${cleanCtx.recType}`);
  console.log(`  suggestedRange=${JSON.stringify(cleanCtx.suggestedRange)}`);
  console.log(`  competitorNames(${cleanCtx.competitorNames.length}): ${cleanCtx.competitorNames.slice(0, 5).join(", ")}...`);

  const cleanResp = await callClaude(cleanPrompt);
  console.log("\n[정상 응답]");
  console.log(cleanResp.split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n[정상 검증]");
  printValidation(cleanResp, cleanCtx);

  // ─────────────────────────────────────────────────────────────
  // 시나리오 A: suggestedRange 를 {min:0, max:0} 으로 강제
  // 의도: rec.type 자체는 그대로 두되 prompt 의 권장범위만 0 으로 만들어
  // Claude 가 "그래도 인상/인하를 추천할까?" 를 본다.
  // ─────────────────────────────────────────────────────────────
  divider("A. suggestedRange={min:0, max:0} 오염 → 3a/3b 발동 기대");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insA = JSON.parse(JSON.stringify(raw.insights)) as any;
  if (insA.recommendation) {
    insA.recommendation.suggestedRange = { min: 0, max: 0 };
    insA.recommendation.message = "강제 오염: 권장범위 0~0";
    insA.recommendation.type = "raise"; // 일부러 raise 로 고정해서 prompt 와 ctx 가 충돌하게
  }
  const { prompt: pA, context: ctxA } = buildBriefingContext({ ...raw, insights: insA });
  console.log(`[오염 ctx] recType=${ctxA.recType}, suggestedRange=${JSON.stringify(ctxA.suggestedRange)}`);
  const respA = await callClaude(pA);
  console.log("\n[오염 응답]");
  console.log(respA.split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n[오염 검증]");
  printValidation(respA, ctxA);

  // ─────────────────────────────────────────────────────────────
  // 시나리오 B: competitorProfiles 이름을 X1, X2, X3 로 치환
  // 의도: Claude 가 메모리에서 진짜 경쟁사 이름을 끌어와 hallucinate 하는지 본다.
  // 화이트리스트는 X1/X2/... 만 있으므로 어떤 한국어 이름이 나와도 룰 2 발동.
  // ─────────────────────────────────────────────────────────────
  divider("B. competitorProfiles 이름 치환 → 룰 2 발동 기대");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insB = JSON.parse(JSON.stringify(raw.insights)) as any;
  if (Array.isArray(insB.competitorProfiles)) {
    insB.competitorProfiles = insB.competitorProfiles.map((c: { name?: string }, i: number) => ({
      ...c,
      name: `X${i + 1}`,
    }));
  }
  const { prompt: pB, context: ctxB } = buildBriefingContext({ ...raw, insights: insB });
  console.log(`[오염 ctx] competitorNames(${ctxB.competitorNames.length}): ${ctxB.competitorNames.join(", ")}`);
  const respB = await callClaude(pB);
  console.log("\n[오염 응답]");
  console.log(respB.split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n[오염 검증]");
  printValidation(respB, ctxB);

  // ─────────────────────────────────────────────────────────────
  // 시나리오 C: myPrice = 9999 로 주입
  // 의도: ground truth 의 myPrice 가 9999 인데 Claude 응답에는 그 숫자가
  // 안 나오면 룰 1 (number) 발동.
  // ─────────────────────────────────────────────────────────────
  divider("C. myPrice=9999 오염 → 룰 1 발동 기대");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insC = JSON.parse(JSON.stringify(raw.insights)) as any;
  if (insC.briefingFactors?.position) {
    insC.briefingFactors.position.myPrice = 9999;
  }
  const { prompt: pC, context: ctxC } = buildBriefingContext({ ...raw, insights: insC });
  console.log(`[오염 ctx] myPrice=${ctxC.myPrice}`);
  // 여기선 prompt 는 9999 를 보여주지만 Claude 가 그 숫자를 "이상하다" 며
  // 실제 시장 가격으로 복원할 가능성이 있다 — 그 자체가 발견.
  const respC = await callClaude(pC);
  console.log("\n[오염 응답]");
  console.log(respC.split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n[오염 검증]");
  printValidation(respC, ctxC);

  divider("데모 종료");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
