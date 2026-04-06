import { NextResponse } from "next/server";

const GAS_WEBAPP_URL = process.env.GAS_SYNC_SALES_URL;

export async function POST() {
  if (!GAS_WEBAPP_URL) {
    return NextResponse.json(
      { error: "GAS_SYNC_SALES_URL 환경변수가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "syncRecentSales" }),
    });

    const data = await res.json();

    if (!data.success) {
      return NextResponse.json(
        { error: data.error || "동기화 실패" },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, message: data.message });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GAS 호출 실패" },
      { status: 502 },
    );
  }
}
