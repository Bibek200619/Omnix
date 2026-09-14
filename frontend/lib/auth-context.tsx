"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { Session, User, AuthError } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase, supabaseConfigError } from "./supabase";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  /**
   * @deprecated Use `getAccessToken()` instead to minimize token exposure.
   * This field will be removed in a future release.
   */
  accessToken: string | null;
  /** Retrieve the current access token on demand. Prefer this over `accessToken`. */
  getAccessToken: () => string | null;
  loading: boolean;
  isConfigured: boolean;
  authError: string | null;
  refreshSession: () => Promise<{
    session: Session | null;
    error: AuthError | null;
  }>;
  signOut: () => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const tokenRef = useRef<string | null>(null);

  const applySession = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    tokenRef.current = nextSession?.access_token ?? null;
  }, []);

  const getAccessToken = useCallback((): string | null => {
    return tokenRef.current;
  }, []);

  const refreshSession = useCallback(async () => {
    if (!supabase) {
      applySession(null);
      return { session: null, error: null };
    }

    const {
      data: { session: nextSession },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error("Unable to load Supabase session", error);
      applySession(null);
      return { session: null, error };
    }

    applySession(nextSession);
    return { session: nextSession, error: null };
  }, [applySession]);

  useEffect(() => {
    if (!supabase) {
      applySession(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadInitialSession() {
      if (!supabase) return;

      const {
        data: { session: nextSession },
        error,
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (error) {
        console.error("Unable to load Supabase session", error);
        applySession(null);
      } else {
        applySession(nextSession);
      }

      setLoading(false);
    }

    loadInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      applySession(null);
      return { error: null };
    }

    const { error } = await supabase.auth.signOut();

    if (!error) {
      applySession(null);
    }

    return { error };
  }, [applySession]);

  const value = useMemo(
    () => ({
      session,
      user,
      accessToken: tokenRef.current,
      getAccessToken,
      loading,
      isConfigured: isSupabaseConfigured,
      authError: supabaseConfigError,
      refreshSession,
      signOut,
    }),
    [getAccessToken, loading, refreshSession, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

