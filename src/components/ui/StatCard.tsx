import React from 'react';
import { Card, CardContent } from './Card';

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'danger' | 'info' | 'default';
  };
  onClick?: () => void;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  subtitle,
  badge,
  onClick,
  className = '',
}) => {
  const badgeClasses = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  return (
    <Card
      className={`transition-all ${onClick ? 'hover:border-slate-300 hover:shadow-sm cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-600">
            {icon}
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">{value}</span>
          {badge && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium border ${badgeClasses[badge.variant]}`}
            >
              {badge.text}
            </span>
          )}
        </div>

        {subtitle && (
          <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
};
