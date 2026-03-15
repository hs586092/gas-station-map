import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data, error } = await supabase
    .from("stations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "주유소 정보를 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  const prices: { product: string; price: number }[] = [];
  if (data.gasoline_price) prices.push({ product: "B027", price: data.gasoline_price });
  if (data.diesel_price) prices.push({ product: "D047", price: data.diesel_price });
  if (data.premium_price) prices.push({ product: "B034", price: data.premium_price });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    brand: data.brand,
    oldAddress: data.old_address,
    newAddress: data.new_address,
    tel: data.tel,
    lat: data.lat,
    lng: data.lng,
    hasLpg: data.lpg_yn === "Y",
    hasCarWash: data.car_wash_yn === "Y",
    hasCvs: data.cvs_yn === "Y",
    prices,
  });
}
