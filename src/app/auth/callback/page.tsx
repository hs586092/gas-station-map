"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/auth";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const { error } = await supabaseAuth.auth.getSession();
      if (error) {
        console.error("Auth callback error:", error);
      }

      // Google 소셜 로그인 후 프로필이 없으면 자동 생성
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (user) {
        const { data: profile } = await supabaseAuth
          .from("users_profile")
          .select("id")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile) {
          const nickname =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "사용자";

          await supabaseAuth.from("users_profile").insert({
            id: user.id,
            nickname,
          });
        }
      }

      router.replace("/");
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-navy rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[14px] text-gray-500">로그인 처리 중...</p>
      </div>
    </div>
  );
}
