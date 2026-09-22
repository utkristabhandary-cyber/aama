import { ApiTimesheetEntryStatus, ApiTimesheetEntryType } from '../../types/api';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'error'
  | 'info'
  | 'purple'
  | 'outline';

export const TIMESHEET_TYPE_LABELS: Record<ApiTimesheetEntryType, string> = {
  class: 'Class',
  duty: 'Duty',
  other: 'Other',
};

export const TIMESHEET_STATUS_LABELS: Record<ApiTimesheetEntryStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

const STATUS_BADGE_VARIANT: Record<ApiTimesheetEntryStatus, BadgeVariant> = {
  draft: 'warning',
  submitted: 'info',
  confirmed: 'success',
  rejected: 'danger',
};

export function statusBadgeVariant(status: ApiTimesheetEntryStatus): BadgeVariant {
  return STATUS_BADGE_VARIANT[status];
}

export function typeLabel(type: ApiTimesheetEntryType): string {
  return TIMESHEET_TYPE_LABELS[type];
}

/** Backend TimeField values arrive as HH:mm:ss; the UI only ever shows HH:mm. */
export function formatTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '—';
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function sectionsLabel(sectionNames: string[]): string {
  return sectionNames.length ? sectionNames.join(' + ') : '—';
}