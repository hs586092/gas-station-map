/**
 * AI 브리핑 검증 통계.
 *
 *   npx tsx scripts/ai-briefing-stats.ts [--days=14]
 *
 * 출력:
 *   - 전체 호출 수
 *   - 검증 통과 / 경고 / 차단 건수
 *   - 가장 흔한 룰 위반 top 3
 *   - 가장 최근 차단 사례 1건의 상세
 *
 * 발표 슬라이드 수치 생성용. 프로덕션 코드는 아니다.
 */

import "dotenv/config";
import { createServiceClient } from "../src/lib/supabase";

type Warning = { rule: string; severity: "error" | "warning"; line: number; detail: string };
type Row = {
  id: number;
  station_id: string;
  called_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  briefing_text: string | null;
  validation_passed: boolean;
  warnings: Warning[] | null;
  recommendation_type: string | null;
  rule_rec_type: string | null;
};

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? parseInt(daysArg.slice(7), 10) : 14;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("ai_briefing_log")
    .select("*")
    .gte("called_at", since)
    .order("called_at", { ascending: false });

  if (error) {
    console.error("query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  const total = rows.length;

  if (total === 0) {
    console.log(`지난 ${days}일간 ai_briefing_log 에 기록된 호출 없음.`);
    return;
  }

  const passed = rows.filter((r) => r.validation_passed).length;
  const blocked = rows.filter((r) => (r.warnings ?? []).some((w) => w.severity === "error")).length;
  const warned = rows.filter(
    (r) =>
      (r.warnings ?? []).length > 0 &&
      !(r.warnings ?? []).some((w) => w.severity === "error")
  ).length;

  console.log(`\n=== AI 브리핑 검증 통계 (지난 ${days}일) ===\n`);
  console.log(`총 호출 수      : ${total}`);
  console.log(`검증 통과       : ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`경고 발생       : ${warned} (${((warned / total) * 100).toFixed(1)}%)`);
  console.log(`error 차단      : ${blocked} (${((blocked / total) * 100).toFixed(1)}%)`);

  // 룰 위반 빈도 top 3
  const ruleCount = new Map<string, number>();
  for (const r of rows) {
    for (const w of r.warnings ?? []) {
      ruleCount.set(w.rule, (ruleCount.get(w.rule) ?? 0) + 1);
    }
  }
  const top = [...ruleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`\n가장 흔한 룰 위반 top 3:`);
  if (top.length === 0) {
    console.log(`  (없음)`);
  } else {
    for (const [rule, n] of top) {
      console.log(`  - ${rule}: ${n}건`);
    }
  }

  // 가장 최근 차단(error) 사례
  const lastBlocked = rows.find((r) => (r.warnings ?? []).some((w) => w.severity === "error"));
  if (lastBlocked) {
    console.log(`\n가장 최근 차단 사례:`);
    console.log(`  called_at  : ${lastBlocked.called_at}`);
    console.log(`  rule_rec   : ${lastBlocked.rule_rec_type}`);
    console.log(`  warnings   :`);
    for (const w of lastBlocked.warnings ?? []) {
      console.log(`    - [${w.severity}] ${w.rule} L${w.line}: ${w.detail}`);
    }
    console.log(`  briefing[:120]: ${(lastBlocked.briefing_text ?? "").slice(0, 120)}...`);
  } else {
    console.log(`\n차단 사례 없음 (지난 ${days}일).`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
