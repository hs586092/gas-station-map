"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

interface AuthModalProps {
  onClose: () => void;
}

export default function AuthModal({ onClose }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle } = useAuth();
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
              {/* Google 로그인 */}
              <button
                onClick={signInWithGoogle}
                className="w-full py-2.5 bg-white text-gray-700 text-[13px] font-semibold rounded-lg border border-gray-300 cursor-pointer flex items-center justify-center gap-2 hover:bg-gray-50 transition-all mb-4"
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google로 시작하기
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
