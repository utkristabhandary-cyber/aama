import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import {
  GraduationCap,
  Eye,
  EyeOff,
  Lock,
  KeyRound,
  ShieldCheck,
  LogOut,
  AlertTriangle,
} from 'lucide-react';

/**
 * Forced password-change gate (Phase D).
 *
 * Shown instead of the whole portal when the authenticated account still holds
 * the importer-generated temporary password (`me.must_change_password`). All
 * normal navigation is unreachable until the holder sets a real password —
 * the backend enforces this too: every other endpoint stays blocked while the
 * flag is set. The bootstrap password is never displayed anywhere.
 */
export const ForcedPasswordChangeView: React.FC = () => {
  const { user, changePassword, logout, isLoading } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Enter your current temporary password.');
      return;
    }
    if (newPassword.length < 8) {
      setError('The new password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two password fields do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current password.');
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError((err as Error).message || 'The password policy rejected your new password.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Institutional Pattern */}
      <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4">
        {/* Branding */}
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xl shadow-amber-500/20 mb-3 border border-amber-400/30">
            <KeyRound className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">Set a New Password</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
            Your account was provisioned with a temporary password that must be replaced before you can use the portal.
          </p>
        </div>

        {/* Who is being transitioned */}
        <div className="mt-6 bg-slate-800/80 backdrop-blur rounded-xl border border-slate-700 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{user?.name || 'Account holder'}</p>
            <p className="text-[11px] text-slate-400 font-mono truncate">
              {user?.username} • {user?.role.toUpperCase()}
            </p>
          </div>
          <Badge variant="warning" className="ml-auto shrink-0">Temp password</Badge>
        </div>

        {/* Form */}
        <div className="mt-4 bg-white py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-slate-100">
          <div className="mb-5 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-relaxed">
              The temporary password is never shown to anyone. If you do not have it, ask an administrator to reset
              your account. Your existing sessions on other devices will be signed out when you save.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium leading-relaxed">
                {error}
              </div>
            )}

            <Input
              label="Current Password"
              type={showCurrent ? 'text' : 'password'}
              placeholder="The temporary password issued with your account"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              leftIcon={<Lock className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label="Toggle current password visibility"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              autoComplete="current-password"
              required
            />

            <Input
              label="New Password"
              type={showNew ? 'text' : 'password'}
              placeholder="At least 8 characters, with a letter, digit and symbol"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              leftIcon={<KeyRound className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label="Toggle new password visibility"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              autoComplete="new-password"
              helperText="Must not resemble your username or email."
              required
            />

            <Input
              label="Confirm New Password"
              type={showConfirm ? 'text' : 'password'}
              placeholder="Re-enter the new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              leftIcon={<KeyRound className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="text-slate-400 hover:text-slate-600 focus:outline-none"
                  aria-label="Toggle confirmation password visibility"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
              autoComplete="new-password"
              required
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Save & Activate Account
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={() => logout()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out instead
            </button>
          </div>
        </div>

        {/* Institutional Notice */}
        <p className="text-center text-xs text-slate-400 mt-6 flex items-center justify-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5" />
          AAMS Academic Portal • Account Lifecycle Security
        </p>
      </div>
    </div>
  );
};