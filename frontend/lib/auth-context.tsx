"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { Session, User, AuthError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  refreshSession: () => Promise<{
    session: Session | null;
    error: AuthError | null;
  }>;
  signOut: () => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function logAccessToken(session: Session | null) {
  if (session?.access_token) {
    console.debug("Supabase session.access_token", session.access_token);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    logAccessToken(nextSession);
  }, []);

  const refreshSession = useCallback(async () => {
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
    let isMounted = true;

    async function loadInitialSession() {
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
      accessToken: session?.access_token ?? null,
      loading,
      refreshSession,
      signOut,
    }),
    [loading, refreshSession, session, signOut, user],
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
