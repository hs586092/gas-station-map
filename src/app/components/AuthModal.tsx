"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const { signIn, signUp, signInWithKakao } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "login") {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        onClose();
      }
    } else {
      if (!nickname.trim()) {
        setError("닉네임을 입력해주세요.");
        setLoading(false);
        return;
      }
      const result = await signUp(email, password, nickname.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setSignupSuccess(true);
      }
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-[400px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="bg-navy px-6 py-5">
          <h2 className="text-white text-[18px] font-bold m-0">
            {mode === "login" ? "로그인" : "회원가입"}
          </h2>
          <p className="text-gray-400 text-[12px] mt-1">
            커뮤니티 이용을 위해 로그인해주세요
          </p>
        </div>

        <div className="p-6">
          {signupSuccess ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-accent-green/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold text-gray-900 mb-1">회원가입 완료!</p>
              <p className="text-[13px] text-gray-500 mb-4">
                이메일 인증 후 로그인할 수 있습니다.
              </p>
              <button
                onClick={() => { setMode("login"); setSignupSuccess(false); }}
                className="w-full py-2.5 bg-navy text-white text-[13px] font-semibold rounded-lg border-none cursor-pointer"
              >
                로그인하기
              </button>
            </div>
          ) : (
            <>
              {/* 카카오 로그인 */}
              <button
                onClick={signInWithKakao}
                className="w-full py-2.5 bg-[#FEE500] text-[#3C1E1E] text-[13px] font-semibold rounded-lg border-none cursor-pointer flex items-center justify-center gap-2 hover:brightness-95 transition-all mb-4"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#3C1E1E">
                  <path d="M12 3C6.48 3 2 6.58 2 10.94c0 2.8 1.86 5.27 4.66 6.67-.15.53-.96 3.4-.99 3.62 0 0-.02.17.09.23.11.07.24.01.24.01.32-.04 3.7-2.42 4.28-2.84.56.08 1.14.12 1.72.12 5.52 0 10-3.58 10-7.81S17.52 3 12 3" />
                </svg>
                카카오로 시작하기
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[11px] text-gray-400">또는</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* 이메일 로그인/회원가입 */}
              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === "signup" && (
                  <input
                    type="text"
                    placeholder="닉네임"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-navy transition-colors bg-white text-gray-900"
                    required
                  />
                )}
                <input
                  type="email"
                  placeholder="이메일"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-navy transition-colors bg-white text-gray-900"
                  required
                />
                <input
                  type="password"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-navy transition-colors bg-white text-gray-900"
                  minLength={6}
                  required
                />

                {error && (
                  <p className="text-[12px] text-red-500 m-0">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-navy text-white text-[13px] font-semibold rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
                </button>
              </form>

              <p className="text-center text-[12px] text-gray-400 mt-4">
                {mode === "login" ? (
                  <>
                    계정이 없으신가요?{" "}
                    <button
                      onClick={() => { setMode("signup"); setError(null); }}
                      className="text-navy font-semibold bg-transparent border-none cursor-pointer p-0"
                    >
                      회원가입
                    </button>
                  </>
                ) : (
                  <>
                    이미 계정이 있으신가요?{" "}
                    <button
                      onClick={() => { setMode("login"); setError(null); }}
                      className="text-navy font-semibold bg-transparent border-none cursor-pointer p-0"
                    >
                      로그인
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
