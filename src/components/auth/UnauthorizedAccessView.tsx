import React from 'react';
import { ShieldAlert, ArrowLeft, Lock } from 'lucide-react';
import { Button } from '../ui/Button';
import { Role } from '../../types';

interface UnauthorizedAccessViewProps {
  currentRole: Role;
  attemptedView: string;
  onReturnToDashboard: () => void;
}

export const UnauthorizedAccessView: React.FC<UnauthorizedAccessViewProps> = ({
  currentRole,
  attemptedView,
  onReturnToDashboard,
}) => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-5 shadow-sm">
        <ShieldAlert className="w-8 h-8" />
      </div>

      <span className="text-xs font-bold uppercase tracking-wider text-rose-600 bg-rose-50 px-3 py-1 rounded-full border border-rose-200 mb-3 inline-flex items-center gap-1.5">
        <Lock className="w-3 h-3" /> Access Boundary Enforced
      </span>

      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
        Restricted Navigation View
      </h2>

      <p className="text-sm text-slate-600 max-w-md mt-2">
        The view <code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-rose-700 font-semibold">{attemptedView}</code> is not accessible to the <strong className="capitalize">{currentRole}</strong> role.
      </p>

      {/* Institutional Security Notice */}
      <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 max-w-lg text-left text-xs text-amber-900 leading-relaxed">
        <div className="font-bold mb-1 flex items-center gap-1.5 text-amber-950">
          Academic Attendance Management System (AAMS)
        </div>
        <p className="text-amber-800">
          Frontend view protection is enforced for role-scoped visibility and workflow isolation. In production, institutional security and object-level permissions are strictly validated by Django REST Framework + PostgreSQL database layers.
        </p>
      </div>

      <div className="mt-6">
        <Button onClick={onReturnToDashboard} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Return to My Dashboard
        </Button>
      </div>
    </div>
  );
};
