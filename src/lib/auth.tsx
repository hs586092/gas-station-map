"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient, type User, type Session } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 클라이언트 사이드 전용 Supabase 클라이언트
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);

export interface UserProfile {
  id: string;
  nickname: string;
  station_name: string | null;
  region: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabaseAuth
      .from("users_profile")
      .select("*")
      .eq("id", userId)
      .single();
    setProfile(data);
  }, []);

  useEffect(() => {
    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = async (email: string, password: string, nickname: string) => {
    const { data, error } = await supabaseAuth.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      const { error: profileError } = await supabaseAuth
        .from("users_profile")
        .insert({ id: data.user.id, nickname });
      if (profileError) return { error: profileError.message };
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signInWithGoogle = async () => {
    await supabaseAuth.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const signOut = async () => {
    await supabaseAuth.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, signUp, signIn, signInWithGoogle, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { supabaseAuth };
