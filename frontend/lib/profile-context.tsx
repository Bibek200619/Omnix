"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";

export type UserProfile = {
  user_id: string;
  email?: string | null;
  handle?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UserProfileUpdate = {
  display_name?: string;
  username?: string;
  avatar_url?: string | null;
  remove_avatar?: boolean;
};

type ProfileContextType = {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
  updateProfile: (payload: UserProfileUpdate) => Promise<UserProfile>;
};

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      const data = await apiClient.get<UserProfile>("/profile");
      setProfile(data);
      setError(null);
    } catch (err) {
      logClientError("Failed to load profile", err, { endpoint: "/profile" });
      setError("Unable to load profile.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const updateProfile = useCallback(async (payload: UserProfileUpdate) => {
    const updated = await apiClient.patch<UserProfile>("/profile", payload);
    setProfile(updated);
    setError(null);
    return updated;
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const value = useMemo(
    () => ({ profile, loading, error, refreshProfile, updateProfile }),
    [error, loading, profile, refreshProfile, updateProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}
