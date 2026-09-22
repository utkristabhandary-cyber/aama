import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Role } from '../../types';
import {
  GraduationCap,
  ShieldCheck,
  Briefcase,
  User,
  Eye,
  EyeOff,
  Lock,
  UserCircle,
} from 'lucide-react';

const DEMO_PASSWORD = 'AaMS@#2026!';

const DEMO_ACCOUNTS: Record<Role, { username: string; label: string }> = {
  admin: { username: 'admin', label: 'admin' },
  teacher: { username: 'tch-3', label: 'tch-3' },
  student: { username: 'std-1', label: 'std-1' },
};

export const LoginView: React.FC = () => {
  const { login, isLoading } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username) {
      setError('Please enter your AAMS username.');
      return;
    }
    try {
      await login(username, password);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDemoFill = async (targetRole: Role) => {
    setError(null);
    const account = DEMO_ACCOUNTS[targetRole];
    setUsername(account.username);
    setPassword(DEMO_PASSWORD);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        {/* Branding Logo */}
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 mb-3">
            <GraduationCap className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900">AAMS Academic Portal</h2>
          <p className="text-xs text-slate-500 mt-1.5 max-w-xs leading-relaxed">
            Institutional Attendance Management & Academic Operations System
          </p>
        </div>

        {/* Login Form Card */}
        <div className="mt-8 bg-white py-8 px-6 shadow-xl shadow-slate-900/5 rounded-2xl sm:px-10 border border-slate-200">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium leading-relaxed">
                {error}
              </div>
            )}

            <Input
              label="AAMS Username"
              type="text"
              placeholder="e.g. admin, tch-3, std-1"
              value={username}
              onChange={e => setUsername(e.target.value)}
              leftIcon={<UserCircle className="w-4 h-4" />}
              autoComplete="username"
              required
            />

            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter account password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-slate-400 hover:text-slate-600 focus:outline-none"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                required
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Sign In to Portal
            </Button>
          </form>

          {/* Developer demo sign-in (build-time convenience, not a product surface) */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Developer demo sign-in
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">
                Seed accounts
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleDemoFill('admin')}
                disabled={isLoading}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all text-center group cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center mb-1.5">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-800">Admin</span>
                <span className="text-[10px] text-slate-500">admin</span>
              </button>

              <button
                type="button"
                onClick={() => handleDemoFill('teacher')}
                disabled={isLoading}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all text-center group cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center mb-1.5">
                  <Briefcase className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-800">Teacher</span>
                <span className="text-[10px] text-slate-500">tch-3</span>
              </button>

              <button
                type="button"
                onClick={() => handleDemoFill('student')}
                disabled={isLoading}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all text-center group cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center mb-1.5">
                  <User className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold text-slate-800">Student</span>
                <span className="text-[10px] text-slate-500">std-1</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-400 text-center mt-3">
              Demo accounts share the password{' '}
              <code className="text-slate-500 font-mono">AaMS@#2026!</code>
            </p>
          </div>
        </div>

        {/* Institutional Notice */}
        <p className="text-center text-xs text-slate-400 mt-6">
          AAMS Academic Portal • Secure Institutional API
        </p>
      </div>
    </div>
  );
};
