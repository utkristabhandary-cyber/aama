import React from 'react';
import { ArrowLeft, MapPinOff } from 'lucide-react';
import { Button } from './ui/Button';

interface NotFoundViewProps {
  attemptedView: string;
  onReturnToDashboard: () => void;
}

export const NotFoundView: React.FC<NotFoundViewProps> = ({
  attemptedView,
  onReturnToDashboard,
}) => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-5 shadow-sm">
        <MapPinOff className="w-8 h-8" />
      </div>

      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 mb-3 inline-flex items-center gap-1.5">
        Unknown View
      </span>

      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
        Page Not Found
      </h2>

      <p className="text-sm text-slate-600 max-w-md mt-2">
        The view <code className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-semibold">{attemptedView}</code> does not exist or has not been registered in the portal.
      </p>

      <div className="mt-6">
        <Button onClick={onReturnToDashboard} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Return to My Dashboard
        </Button>
      </div>
    </div>
  );
};