/**
 * AI 브리핑 검증 레이어 (3-Guard).
 *
 * Claude 응답을 사후 검증해서, 규칙 엔진의 ground truth 와 어긋나는
 * 경우를 잡아낸다. 순수 함수, DB 호출 없음.
 *
 * 룰:
 *   0. 구조      — 정확히 5줄, 접두사 순서, 종결부 (잘림 감지)
 *   3a. 방향    — Claude 인상/유지/인하 vs context.recType
 *   3b. 범위    — Claude ±N원 절댓값이 suggestedRange 안에 있는가
 *   3c. 타이밍  — Claude 타이밍 vs context.timingHint (timingHint 가 있을 때만)
 *   2.  경쟁사  — Claude 가 언급한 고유명사가 competitorNames 안에 있는가
 *   1.  숫자    — 축소판: myPrice / avgPrice / expectedVolumeToday 3개만
 *                 ±1% 허용으로 비교
 *
 * 실패 정책 (호출자가 결정):
 *   - 기본: C (원본 + 경고 배지) — warnings 배열만 채워 반환
 *   - 예외: 3a 가 severity:"error" 인 경우, 호출자가 [추천] 줄을 정적
 *     폴백 메시지로 교체 (B). 이 함수는 어떤 줄을 교체할지만 알려준다.
 */

import type { BriefingContext, RecType } from "./ai-briefing-context";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export type GuardRule =
  | "structure"
  | "direction"
  | "range"
  | "timing"
  | "competitor"
  | "number";

export type GuardSeverity = "error" | "warning";

export type GuardWarning = {
  rule: GuardRule;
  severity: GuardSeverity;
  /** 1-5, 0 이면 전체 응답 */
  line: number;
  detail: string;
};

export type ValidationResult = {
  passed: boolean;
  warnings: GuardWarning[];
  /** B 옵션 발동 시 호출자가 [추천] 줄을 교체할 텍스트. null 이면 교체 안 함 */
  recommendationLineOverride: string | null;
};

export type ParsedBriefing = {
  /** 5개 줄 (성공 시). 줄 수가 다르면 null */
  lines: [string, string, string, string, string] | null;
  /** [추천] 줄에서 추출한 방향. "관망" 은 시스템 프롬프트엔 없지만 방어용 */
  direction: "인상" | "유지" | "인하" | "관망" | null;
  /** [추천] 줄의 폭 절댓값(원). ±0원 → 0. 추출 실패 시 null */
  amountAbs: number | null;
  /** 방향 부호 적용된 amount: 인상=+, 인하=-, 유지=0 */
  amountSigned: number | null;
  /** [추천] 줄의 타이밍 */
  timing: "오늘" | "내일" | "관망" | null;
};

// ─────────────────────────────────────────────────────────────
// 파서
// ─────────────────────────────────────────────────────────────

const LINE_PREFIXES = ["[추천]", "[경쟁사]", "[리스크]", "[판매량]", "[내일]"] as const;

export function parseBriefing(text: string | null | undefined): ParsedBriefing {
  if (!text || typeof text !== "string") {
    return { lines: null, direction: null, amountAbs: null, amountSigned: null, timing: null };
  }
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let lines: ParsedBriefing["lines"] = null;
  if (rawLines.length === 5) {
    // 모든 접두사가 순서대로 매치되어야 함
    const ok = LINE_PREFIXES.every((p, i) => rawLines[i].startsWith(p));
    if (ok) {
      lines = [rawLines[0], rawLines[1], rawLines[2], rawLines[3], rawLines[4]];
    }
  }

  const recLine = lines?.[0] ?? rawLines[0] ?? "";

  // 방향
  let direction: ParsedBriefing["direction"] = null;
  for (const d of ["인상", "유지", "인하", "관망"] as const) {
    if (recLine.includes(d)) {
      direction = d;
      break;
    }
  }

  // 폭: ±0원 / +N원 / -N원 / ±N원 / N원 (방향이 있을 때만 N원 매치)
  let amountAbs: number | null = null;
  const m1 = recLine.match(/±\s*(\d+)\s*원/);
  if (m1) {
    amountAbs = parseInt(m1[1], 10);
  } else {
    const m2 = recLine.match(/[+\-−–]\s*(\d+)\s*원/);
    if (m2) amountAbs = parseInt(m2[1], 10);
    else {
      // 방향이 있고 단순 "N원" 형태인 경우 (예: "유지 0원")
      const m3 = recLine.match(/(\d+)\s*원/);
      if (m3) amountAbs = parseInt(m3[1], 10);
    }
  }

  let amountSigned: number | null = null;
  if (amountAbs != null) {
    if (direction === "유지" || direction === "관망") amountSigned = 0;
    else if (direction === "인상") amountSigned = amountAbs;
    else if (direction === "인하") amountSigned = -amountAbs;
  }

  // 타이밍
  let timing: ParsedBriefing["timing"] = null;
  const tm = recLine.match(/\(\s*타이밍\s*[:：]\s*(오늘|내일|관망)\s*\)/);
  if (tm) {
    timing = tm[1] as "오늘" | "내일" | "관망";
  }

  return { lines, direction, amountAbs, amountSigned, timing };
}

// ─────────────────────────────────────────────────────────────
// 룰 0: 구조 검증
// ─────────────────────────────────────────────────────────────

export function checkStructure(parsed: ParsedBriefing, rawText: string): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  if (!parsed.lines) {
    warnings.push({
      rule: "structure",
      severity: "error",
      line: 0,
      detail: "5줄 구조가 깨졌습니다 (줄 수 또는 접두사 불일치).",
    });
    return warnings;
  }
  // 종결부 검사: 마지막 줄(=[내일])이 한국어 종결어미 또는 종결부호로 끝나야 함
  // (잘림 사고 재발 방지)
  const last = parsed.lines[4];
  const endsOk = /[다요\.\!\?]$/.test(last) || /합니다\.?$/.test(last);
  if (!endsOk) {
    warnings.push({
      rule: "structure",
      severity: "error",
      line: 5,
      detail: `[내일] 줄이 완성되지 않은 채 끝났습니다: "${last.slice(-20)}"`,
    });
  }
  // 이모지 검사 (BMP 외 + 일반 이모지 범위 단순 검출)
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}]/u;
  if (parsed.lines.some((l) => emojiRe.test(l))) {
    warnings.push({
      rule: "structure",
      severity: "warning",
      line: 0,
      detail: "이모지가 포함되었습니다 (시스템 프롬프트는 금지).",
    });
  }
  // rawText 길이 sanity (아주 짧으면 의심)
  if (rawText.trim().length < 50) {
    warnings.push({
      rule: "structure",
      severity: "error",
      line: 0,
      detail: "응답이 비정상적으로 짧습니다.",
    });
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────
// 룰 3a: 방향 일치
// ─────────────────────────────────────────────────────────────

const REC_TYPE_TO_DIRECTION: Record<RecType, "인상" | "유지" | "인하" | null> = {
  raise: "인상",
  hold: "유지",
  lower: "인하",
  watch: null, // 시스템 프롬프트에 "관망" 선택지가 없어서 매핑 불가 — 검증 생략
};

export function checkDirection(parsed: ParsedBriefing, ctx: BriefingContext): GuardWarning[] {
  if (!parsed.direction) return []; // 파싱 실패는 룰 0 가 잡음
  const expected = REC_TYPE_TO_DIRECTION[ctx.recType];
  if (expected === null) return []; // watch 는 검증 생략 (구조적 벙어리)
  if (parsed.direction === expected) return [];
  // 방향 불일치 — 가장 심각. error.
  return [
    {
      rule: "direction",
      severity: "error",
      line: 1,
      detail: `규칙 엔진은 "${expected}" 권장, Claude 는 "${parsed.direction}" 답변. 방향 불일치.`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// 룰 3b: 크기 범위
// ─────────────────────────────────────────────────────────────

export function checkRange(parsed: ParsedBriefing, ctx: BriefingContext): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  if (parsed.amountAbs == null) return warnings;
  // hold 면 ±0원 외 추천은 모두 위반
  if (ctx.recType === "hold") {
    if (parsed.amountAbs !== 0) {
      warnings.push({
        rule: "range",
        severity: "error",
        line: 1,
        detail: `규칙 엔진은 hold(±0원) 권장, Claude 는 ${parsed.amountAbs}원 추천.`,
      });
    }
    return warnings;
  }
  if (!ctx.suggestedRange) return warnings; // 범위 정보 없으면 검증 생략
  const { min, max } = ctx.suggestedRange;
  const v = parsed.amountAbs;
  if (v < min || v > max) {
    warnings.push({
      rule: "range",
      severity: "warning",
      line: 1,
      detail: `Claude 추천 ${v}원이 권장 범위 ${min}~${max}원 밖.`,
    });
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────
// 룰 3c: 타이밍 일치
// ─────────────────────────────────────────────────────────────

export function checkTiming(parsed: ParsedBriefing, ctx: BriefingContext): GuardWarning[] {
  if (!ctx.timingHint) return []; // 규칙 엔진이 타이밍 힌트를 안 줬으면 검증 생략
  if (!parsed.timing) return [];
  if (parsed.timing === ctx.timingHint) return [];
  return [
    {
      rule: "timing",
      severity: "warning",
      line: 1,
      detail: `규칙 엔진 타이밍 힌트 "${ctx.timingHint}", Claude 는 "${parsed.timing}".`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// 룰 2: 경쟁사명 화이트리스트
// ─────────────────────────────────────────────────────────────

/**
 * Claude 가 언급한 고유 명사가 competitorNames 안에 있는가.
 * 한국어 조사(이/가/은/는/을/를/에/의/로/도/만/와/과) 가 붙어 있을 수 있으므로
 * indexOf 로 부분 일치만 본다. 매칭 후보가 없으면 hallucination 가능성.
 *
 * 주의: 응답에 고유명사가 전혀 안 나오면 PASS (현재 시스템 프롬프트는
 * 고유명사를 강제하지 않음).
 */
export function checkCompetitorNames(
  parsed: ParsedBriefing,
  ctx: BriefingContext
): GuardWarning[] {
  if (!parsed.lines) return [];
  if (ctx.competitorNames.length === 0) return [];

  // [경쟁사] 줄과 [내일] 줄 위주로 검사 (브리핑이 경쟁사명을 거론하는 위치)
  const targetLines: Array<{ line: number; text: string }> = [
    { line: 2, text: parsed.lines[1] },
    { line: 5, text: parsed.lines[4] },
  ];

  // 한국어 주유소명 패턴: "주유소" 또는 "셀프" 또는 "오일" 또는 "에너지" 등으로
  // 끝나는 고유명사. 너무 일반적이면 false positive.
  // 여기서는 **알려진 이름들만 토큰화**해서, 응답에 들어 있는 토큰이
  // 화이트리스트에 없으면 경고하는 방식이 아니라,
  // **응답에 화이트리스트 외 후보 고유명사가 나오는지** 검사한다.
  //
  // 단순화: 응답에서 "주유소"/"셀프"/"오일뱅크"로 끝나는 단어를 추출하고,
  // 그 단어가 어떤 화이트리스트 이름의 부분 문자열이 아니면 경고.
  const warnings: GuardWarning[] = [];
  const candidatePattern = /([\w가-힣㈜()\-\s]{2,30}?(?:주유소|셀프|오일뱅크|에너지))/g;

  for (const { line, text } of targetLines) {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = candidatePattern.exec(text)) !== null) {
      const cand = m[1].trim();
      if (cand.length < 2 || seen.has(cand)) continue;
      seen.add(cand);
      // 화이트리스트의 어떤 이름과도 부분일치하지 않으면 의심
      const matched = ctx.competitorNames.some((name) => {
        const n = name.replace(/\s+/g, "");
        const c = cand.replace(/\s+/g, "");
        return n.includes(c) || c.includes(n);
      });
      if (!matched) {
        warnings.push({
          rule: "competitor",
          severity: "warning",
          line,
          detail: `"${cand}" 가 경쟁사 목록에 없습니다 (hallucination 의심).`,
        });
      }
    }
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────
// 룰 1: 핵심 숫자 (축소판 — 3개만)
// ─────────────────────────────────────────────────────────────

/**
 * 응답 전체에서 "N원" / "N L" 패턴 숫자를 모두 뽑은 뒤,
 * myPrice / avgPrice / expectedVolumeToday 에 ±1% 안에 일치하는 후보가
 * 있는지 본다. 없으면 경고.
 *
 * 정책: "context 의 ground truth 가 응답 어디에도 나오지 않으면 경고".
 * 반대 방향(응답의 모든 숫자가 ground truth 와 매칭되는가) 은 false
 * positive 가 너무 많아서 채택 안 함.
 */
export function checkCoreNumbers(parsed: ParsedBriefing, ctx: BriefingContext): GuardWarning[] {
  if (!parsed.lines) return [];
  const warnings: GuardWarning[] = [];
  const fullText = parsed.lines.join(" ");

  // 모든 "N원" 추출
  const wonValues = new Set<number>();
  const wonRe = /(\d{1,3}(?:,\d{3})+|\d+)\s*원/g;
  let m: RegExpExecArray | null;
  while ((m = wonRe.exec(fullText)) !== null) {
    wonValues.add(parseInt(m[1].replace(/,/g, ""), 10));
  }

  // 모든 "N L" 추출
  const litValues = new Set<number>();
  const litRe = /(\d{1,3}(?:,\d{3})+|\d+)\s*L/g;
  while ((m = litRe.exec(fullText)) !== null) {
    litValues.add(parseInt(m[1].replace(/,/g, ""), 10));
  }

  function withinTolerance(target: number, candidates: Set<number>, tolPct = 1): boolean {
    const tol = (target * tolPct) / 100;
    for (const v of candidates) {
      if (Math.abs(v - target) <= tol) return true;
    }
    return false;
  }

  if (ctx.myPrice != null && wonValues.size > 0 && !withinTolerance(ctx.myPrice, wonValues)) {
    warnings.push({
      rule: "number",
      severity: "warning",
      line: 0,
      detail: `내 가격 ${ctx.myPrice.toLocaleString()}원이 응답 어디에도 나오지 않습니다.`,
    });
  }
  // avgPrice 는 내가격과 ±몇 원 차이일 수 있어 위양성 위험. ±1% 그대로 두되,
  // 내가격과 평균가격의 차이가 1% 미만이면 검증 생략 (둘이 거의 같음).
  if (
    ctx.avgPrice != null &&
    ctx.myPrice != null &&
    Math.abs(ctx.avgPrice - ctx.myPrice) / Math.max(1, ctx.myPrice) > 0.01 &&
    wonValues.size > 0 &&
    !withinTolerance(ctx.avgPrice, wonValues)
  ) {
    warnings.push({
      rule: "number",
      severity: "warning",
      line: 0,
      detail: `경쟁사평균 ${ctx.avgPrice.toLocaleString()}원이 응답 어디에도 나오지 않습니다.`,
    });
  }
  if (
    ctx.expectedVolumeToday != null &&
    litValues.size > 0 &&
    !withinTolerance(ctx.expectedVolumeToday, litValues)
  ) {
    warnings.push({
      rule: "number",
      severity: "warning",
      line: 4,
      detail: `예상 판매량 ${ctx.expectedVolumeToday.toLocaleString()}L 가 응답 어디에도 나오지 않습니다.`,
    });
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

const REC_OVERRIDE_FALLBACK = (recType: RecType): string => {
  switch (recType) {
    case "raise":
      return "[추천] 규칙 엔진: 가격 인상 권장. AI 해석과 방향이 불일치하여 원본을 보류했습니다.";
    case "hold":
      return "[추천] 규칙 엔진: 가격 유지 권장. AI 해석과 방향이 불일치하여 원본을 보류했습니다.";
    case "lower":
      return "[추천] 규칙 엔진: 가격 인하 권장. AI 해석과 방향이 불일치하여 원본을 보류했습니다.";
    case "watch":
      return "[추천] 규칙 엔진: 관망 권장. AI 해석과 방향이 불일치하여 원본을 보류했습니다.";
  }
};

export function runGuards(
  briefingText: string,
  context: BriefingContext
): { parsed: ParsedBriefing; result: ValidationResult } {
  const parsed = parseBriefing(briefingText);
  const warnings: GuardWarning[] = [];

  warnings.push(...checkStructure(parsed, briefingText));
  // 구조가 깨졌으면 나머지 룰은 의미 없으므로 스킵
  const structureBroken = warnings.some(
    (w) => w.rule === "structure" && w.severity === "error" && w.line !== 5
  );
  if (!structureBroken) {
    warnings.push(...checkDirection(parsed, context));
    warnings.push(...checkRange(parsed, context));
    warnings.push(...checkTiming(parsed, context));
    warnings.push(...checkCompetitorNames(parsed, context));
    warnings.push(...checkCoreNumbers(parsed, context));
  }

  // 3a (방향 error) 가 발생하면 [추천] 줄 폴백 교체
  const directionError = warnings.find(
    (w) => w.rule === "direction" && w.severity === "error"
  );
  const recommendationLineOverride = directionError
    ? REC_OVERRIDE_FALLBACK(context.recType)
    : null;

  const passed = warnings.length === 0;

  return {
    parsed,
    result: { passed, warnings, recommendationLineOverride },
  };
}

/**
 * UI 가 최종적으로 보여줄 5줄 텍스트.
 * recommendationLineOverride 가 있으면 [추천] 줄을 교체한 결과를 반환한다.
 * 구조가 깨진 경우(parsed.lines === null) 원본을 그대로 반환한다.
 */
export function applyOverride(
  originalText: string,
  parsed: ParsedBriefing,
  override: string | null
): string {
  if (!override) return originalText;
  if (!parsed.lines) return originalText;
  const newLines = [override, parsed.lines[1], parsed.lines[2], parsed.lines[3], parsed.lines[4]];
  return newLines.join("\n");
}
