import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** 서버 사이드 전용 (service role key 사용) */
export function createServiceClient() {
  return createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** 세차장 Supabase 클라이언트 (서버 사이드 전용) */
export function createCarwashClient() {
  return createClient(
    process.env.CARWASH_SUPABASE_URL!,
    process.env.CARWASH_SUPABASE_SERVICE_ROLE_KEY!
  );
}
