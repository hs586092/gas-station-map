import { NextRequest, NextResponse } from "next/server";
import { evaluateShadowCorrection } from "@/lib/dashboard/forecast-correction-evaluate";

/**
 * GET /api/stations/[id]/correction-shadow
 *
 * Phase 1 Shadow Mode 의 평가 결과를 반환한다.
 *
 * 응답
 *   - 정책 상태 (mode, shadowStartedAt, meanResidualL 등)
 *   - 평가 메트릭 (beforeMape, afterMape, improvementPp, worseDaysRatio)
 *   - 일별 타임라인 (최대 14개)
 *   - Go/No-Go verdict + 사유
 *
 * 안전성
 *   - 이 라우트는 SELECT 전용. DB 어떤 컬럼도 UPDATE 하지 않음.
 *   - shadow 보정 계산은 별도 경로 (/api/snapshot/rebuild) 에서 수행.
 *
 * 캐시
 *   self-diagnosis 와 동일한 30분 캐시 (s-maxage=1800).
 *   shadow 데이터는 매일 1회 갱신되므로 짧은 캐시도 무의미.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("timelineLimit") ?? "14");

  const data = await evaluateShadowCorrection(id, limit);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=300",
    },
  });
}
