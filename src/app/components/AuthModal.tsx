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
      if (result.error) setError(result.error);
      else onClose();
    } else {
      if (!nickname.trim()) { setError("닉네임을 입력해주세요."); setLoading(false); return; }
      const result = await signUp(email, password, nickname.trim());
      if (result.error) setError(result.error);
      else setSignupSuccess(true);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[2000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-raised rounded-[20px] w-full max-w-[400px] overflow-hidden" style={{ boxShadow: "var(--shadow-xl)" }} onClick={(e) => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="px-6 pt-6 pb-4 text-center relative">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-[10px] hover:bg-surface bg-transparent border-none cursor-pointer transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9BA8B7" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          <div className="w-12 h-12 bg-emerald/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#00C073">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-text-primary m-0">
            {mode === "login" ? "로그인" : "회원가입"}
          </h2>
          <p className="text-[13px] text-text-tertiary mt-1 m-0">SLP Energy Analytics에 오신 것을 환영합니다</p>
        </div>

        <div className="px-6 pb-6">
          {signupSuccess ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-emerald/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00C073" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <p className="text-[16px] font-bold text-text-primary mb-1 m-0">가입 완료!</p>
              <p className="text-[13px] text-text-tertiary mb-5 m-0">이메일 인증 후 로그인할 수 있습니다.</p>
              <button onClick={() => { setMode("login"); setSignupSuccess(false); }} className="w-full h-11 bg-navy text-white text-[14px] font-semibold rounded-[12px] border-none cursor-pointer hover:bg-navy-light transition-colors">로그인하기</button>
            </div>
          ) : (
            <>
              {/* Google */}
              <button onClick={signInWithGoogle} className="w-full h-11 bg-surface-raised text-text-primary text-[13px] font-medium rounded-[12px] border border-border cursor-pointer flex items-center justify-center gap-2.5 hover:bg-surface transition-colors mb-4">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google로 계속하기
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] text-text-tertiary font-medium">또는 이메일로</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === "signup" && (
                  <div>
                    <label className="text-[11px] font-semibold text-text-secondary mb-1 block">닉네임</label>
                    <input type="text" placeholder="닉네임을 입력하세요" value={nickname} onChange={(e) => setNickname(e.target.value)} className="w-full h-10 px-3 text-[13px] border border-border rounded-[10px] outline-none focus:border-navy bg-surface-raised text-text-primary transition-colors" required />
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-semibold text-text-secondary mb-1 block">이메일</label>
                  <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-10 px-3 text-[13px] border border-border rounded-[10px] outline-none focus:border-navy bg-surface-raised text-text-primary transition-colors" required />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-text-secondary mb-1 block">비밀번호</label>
                  <input type="password" placeholder="6자 이상" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full h-10 px-3 text-[13px] border border-border rounded-[10px] outline-none focus:border-navy bg-surface-raised text-text-primary transition-colors" minLength={6} required />
                </div>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-coral-light rounded-[10px]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF5252" strokeWidth="2" className="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                    <p className="text-[12px] text-coral m-0">{error}</p>
                  </div>
                )}

                <button type="submit" disabled={loading} className="w-full h-11 bg-navy text-white text-[14px] font-semibold rounded-[12px] border-none cursor-pointer hover:bg-navy-light disabled:opacity-40 transition-all">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      처리 중
                    </span>
                  ) : mode === "login" ? "로그인" : "가입하기"}
                </button>
              </form>

              <p className="text-center text-[12px] text-text-tertiary mt-4 m-0">
                {mode === "login" ? (
                  <>계정이 없으신가요? <button onClick={() => { setMode("signup"); setError(null); }} className="text-emerald font-semibold bg-transparent border-none cursor-pointer p-0">회원가입</button></>
                ) : (
                  <>이미 계정이 있으신가요? <button onClick={() => { setMode("login"); setError(null); }} className="text-emerald font-semibold bg-transparent border-none cursor-pointer p-0">로그인</button></>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
