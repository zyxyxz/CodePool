import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface AdminProfile {
  email: string;
  installed: boolean;
}

interface AuthContextValue {
  token: string | null;
  profile: AdminProfile | null;
  login: (token: string, profile: AdminProfile) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'TEAMKEY_ADMIN_TOKEN';
const PROFILE_KEY = 'TEAMKEY_ADMIN_PROFILE';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [profile, setProfile] = useState<AdminProfile | null>(() => {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  });

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [token]);

  useEffect(() => {
    if (profile) {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_KEY);
    }
  }, [profile]);

  const value = useMemo(
    () => ({
      token,
      profile,
      login: (nextToken: string, nextProfile: AdminProfile) => {
        setToken(nextToken);
        setProfile(nextProfile);
      },
      logout: () => {
        setToken(null);
        setProfile(null);
      },
    }),
    [token, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
};
