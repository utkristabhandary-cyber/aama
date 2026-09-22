"""Pure helpers for the teacher timesheet domain.

The rules live here so the views and the tests share one implementation:

- ``find_overlapping_entry`` — same teacher + same day, overlapping time range.
  Rejected entries never block future work (a teacher may log and re-submit a
  withdrawn range), matching the confirmed "holidays and overlaps are surfaced,
  rejected entries don't stand" policy.
- ``holiday_on`` — look up whether a given date is an institutional holiday.
  Holidays are informational: they do NOT block entries, the API surfaces
  ``is_holiday`` / ``holiday_title`` on every entry instead.
"""

from apps.academics.models import Holiday

from .models import TimesheetEntry, TimesheetEntryStatus


def find_overlapping_entry(teacher_id, entry_date, start_time, end_time, exclude_id=None):
    """Return the first entry overlapping the given range, or ``None``.

    Two ranges overlap when ``start < other.end`` and ``end > other.start``,
    so an entry ending exactly when another starts (``end == start``) is legal.
    """
    queryset = TimesheetEntry.objects.filter(
        teacher_id=teacher_id, entry_date=entry_date
    ).exclude(status=TimesheetEntryStatus.REJECTED)
    if exclude_id is not None:
        queryset = queryset.exclude(pk=exclude_id)
    for entry in queryset:
        if start_time < entry.end_time and end_time > entry.start_time:
            return entry
    return None


def holiday_on(entry_date):
    """Return the ``Holiday`` covering ``entry_date`` or ``None``."""
    return Holiday.objects.filter(date=entry_date).first()