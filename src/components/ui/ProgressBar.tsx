import React from 'react';

export interface ProgressBarProps {
  value: number; // 0 - 100
  max?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  colorScheme?: 'auto' | 'indigo' | 'emerald' | 'rose' | 'amber';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  showLabel = false,
  size = 'md',
  className = '',
  colorScheme = 'auto',
}) => {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  const heights = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-3.5',
  };

  let barColor = 'bg-indigo-600';

  if (colorScheme === 'auto') {
    if (percentage >= 85) {
      barColor = 'bg-emerald-500';
    } else if (percentage >= 75) {
      barColor = 'bg-amber-500';
    } else {
      barColor = 'bg-rose-500';
    }
  } else if (colorScheme === 'emerald') {
    barColor = 'bg-emerald-500';
  } else if (colorScheme === 'amber') {
    barColor = 'bg-amber-500';
  } else if (colorScheme === 'rose') {
    barColor = 'bg-rose-500';
  }

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-1">
          <span>Progress</span>
          <span>{percentage}%</span>
        </div>
      )}
      <div className={`w-full bg-slate-100 rounded-full overflow-hidden ${heights[size]}`}>
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
};
