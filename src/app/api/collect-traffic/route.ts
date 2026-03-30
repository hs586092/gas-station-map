import { NextResponse } from "next/server";

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const CRON_SECRET = process.env.CRON_SECRET!;

/**
 * GET /api/collect-traffic
 *
 * Vercel Cron → Supabase Edge Function 프록시
 * ITS API(포트 9443)는 Vercel 서버리스에서 접근 불가하므로
 * Supabase Edge Function에서 실행 (ITS 응답 10~60초 변동)
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/collect-traffic`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "x-cron-secret": CRON_SECRET,
        },
        signal: AbortSignal.timeout(150000),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Edge Function call failed: ${msg}` },
      { status: 502 }
    );
  }
}
