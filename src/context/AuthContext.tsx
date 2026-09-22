import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Role } from '../types';
import { authService } from '../services/authService';
import { useToast } from './ToastContext';

interface AuthContextType {
  user: User | null;
  role: Role | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True while the account still holds its temporary bootstrap password. */
  mustChangePassword: boolean;
  login: (username: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Self-service password change; clears `mustChangePassword` on success. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { showToast } = useToast();

  useEffect(() => {
    async function initAuth() {
      try {
        const u = await authService.getCurrentUser();
        const t = authService.getToken();
        setUser(u);
        setToken(t);
      } catch (err) {
        console.error('Failed to restore authentication session:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initAuth();

    const handleAuthChange = (e: Event) => {
      const custom = e as CustomEvent<{ user: User | null }>;
      setUser(custom.detail.user);
      setToken(authService.getToken());
    };

    window.addEventListener('aams_auth_change', handleAuthChange);
    return () => window.removeEventListener('aams_auth_change', handleAuthChange);
  }, []);

  // A 401 anywhere in the app (expired/invalid token) ends the session.
  useEffect(() => {
    if (!token) return;
    const handleUnauthorized = () => {
      setUser(null);
      setToken(null);
      showToast({
        title: 'Session expired',
        description: 'Your session has expired. Please sign in again.',
        type: 'danger',
      });
    };
    window.addEventListener('aams:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('aams:unauthorized', handleUnauthorized);
  }, [token, showToast]);

  const login = async (username: string, password?: string) => {
    setIsLoading(true);
    try {
      const res = await authService.login(username, password);
      setUser(res.user);
      setToken(res.token);
      showToast({
        title: 'Logged in successfully',
        description: `Welcome back, ${res.user.name} (${res.user.role.toUpperCase()})`,
        type: 'success',
      });
    } catch (err) {
      showToast({
        title: 'Authentication Failed',
        description: (err as Error).message || 'Invalid credentials',
        type: 'danger',
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authService.logout();
      setUser(null);
      setToken(null);
      showToast({
        title: 'Logged out',
        description: 'You have been securely signed out of AAMS.',
        type: 'info',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    setIsLoading(true);
    try {
      const updated = await authService.changePassword(currentPassword, newPassword);
      setUser(updated);
      setToken(authService.getToken());
      showToast({
        title: 'Password updated',
        description: 'Your institutional password has been changed and other sessions were signed out.',
        type: 'success',
      });
    } catch (err) {
      showToast({
        title: 'Password not changed',
        description: (err as Error).message || 'The password policy rejected the new value.',
        type: 'danger',
      });
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        token,
        isAuthenticated: !!user,
        isLoading,
        mustChangePassword: user?.mustChangePassword === true,
        login,
        logout,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};