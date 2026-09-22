import React, { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { timesheetService } from '../../services/timesheetService';
import { Subject, Section, Teacher } from '../../types';
import {
  ApiTimesheetEntry,
  ApiTimesheetEntryCreate,
  ApiTimesheetEntryType,
} from '../../types/api';

export interface TimesheetEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Present = edit mode; null = create. */
  entry: ApiTimesheetEntry | null;
  teachers: Teacher[];
  subjects: Subject[];
  sections: Section[];
  isAdmin: boolean;
  onSaved: (entry: ApiTimesheetEntry) => void;
}

interface FormErrors {
  entryDate?: string;
  startTime?: string;
  endTime?: string;
  teacher?: string;
  subject?: string;
  sectionIds?: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Create or edit a timesheet entry. */
export const TimesheetEntryModal: React.FC<TimesheetEntryModalProps> = ({
  isOpen,
  onClose,
  entry,
  teachers,
  subjects,
  sections,
  isAdmin,
  onSaved,
}) => {
  const [entryDate, setEntryDate] = useState('');
  const [type, setType] = useState<ApiTimesheetEntryType>('class');
  const [teacher, setTeacher] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setEntryDate(entry?.entry_date ?? todayIso());
    setType(entry?.type ?? 'class');
    setTeacher(entry ? String(entry.teacher) : '');
    setSubjectId(entry?.subject != null ? String(entry.subject) : '');
    setSectionIds((entry?.section_ids ?? []).map(String));
    setStartTime(entry?.start_time ? entry.start_time.slice(0, 5) : '');
    setEndTime(entry?.end_time ? entry.end_time.slice(0, 5) : '');
    setNote(entry?.note ?? '');
    setErrors({});
    setSaveError('');
  }, [isOpen, entry]);

  // Switching to a non-class type drops the subject/sections the backend
  // forbids for duty/other entries.
  useEffect(() => {
    if (type !== 'class') {
      setSubjectId('');
      setSectionIds([]);
    }
  }, [type]);

  const selectedSubject = subjects.find(s => s.id === subjectId);
  const availableSections = selectedSubject
    ? sections.filter(s => s.semesterId === selectedSubject.semesterId)
    : sections;

  const toggleSection = (id: string) => {
    setSectionIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const validate = (): boolean => {
    const next: FormErrors = {};
    if (!entryDate) next.entryDate = 'Date is required.';
    else if (entryDate > todayIso()) next.entryDate = 'Entry date cannot be in the future.';
    if (!startTime) next.startTime = 'Start time is required.';
    if (!endTime) next.endTime = 'End time is required.';
    if (startTime && endTime && endTime <= startTime) {
      next.endTime = 'End time must be after start time.';
    }
    if (isAdmin && !teacher) next.teacher = 'Teacher is required.';
    if (type === 'class') {
      if (!subjectId) next.subject = 'Subject is required for class entries.';
      if (!subjectId || !selectedSubject) {
        next.subject = 'The selected subject has no semester.';
      }
      if (sectionIds.length === 0) {
        next.sectionIds = 'At least one section is required for class entries.';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setSaveError('');
    try {
      const payload: ApiTimesheetEntryCreate = {
        entry_date: entryDate,
        type,
        start_time: startTime,
        end_time: endTime,
        note: note.trim() || '',
      };
      if (type === 'class') {
        payload.subject = Number(subjectId);
        payload.section_ids = sectionIds.map(Number);
      } else {
        // Explicit null/[] is the wire contract the backend expects for non-class.
        payload.subject = null;
        payload.section_ids = [];
      }
      if (isAdmin && teacher) payload.teacher = Number(teacher);

      const saved = entry
        ? await timesheetService.updateEntry(entry.id, payload)
        : await timesheetService.createEntry(payload);
      onSaved(saved);
    } catch (err) {
      setSaveError((err as Error).message || 'Could not save the entry.');
    } finally {
      setSubmitting(false);
    }
  };

  const subjectOptions = [
    { value: '', label: 'Select a subject' },
    ...subjects.map(sub => ({
      value: sub.id,
      label: `${sub.code}: ${sub.name}`,
    })),
  ];

  const teacherOptions = [
    { value: '', label: 'Select a teacher' },
    ...teachers.map(t => ({
      value: t.id,
      label: `${t.name} (${t.teacherId})`,
    })),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={entry ? 'Edit Timesheet Entry' : 'Log Timesheet Hours'}
      description="Duration is computed from the times you enter; holidays are surfaced, not blocked."
      maxWidth="lg"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Date"
          type="date"
          value={entryDate}
          onChange={e => setEntryDate(e.target.value)}
          error={errors.entryDate}
          max={todayIso()}
        />

        <Select
          label="Type"
          value={type}
          onChange={e => setType(e.target.value as ApiTimesheetEntryType)}
          options={[
            { value: 'class', label: 'Class (subject & sections)' },
            { value: 'duty', label: 'Duty (lab / supervision, no subject)' },
            { value: 'other', label: 'Other work hours' },
          ]}
        />

        {isAdmin && (
          <Select
            label="Teacher"
            value={teacher}
            onChange={e => setTeacher(e.target.value)}
            error={errors.teacher}
            options={teacherOptions}
          />
        )}

        <Input
          label="Start Time"
          type="time"
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          error={errors.startTime}
        />

        <Input
          label="End Time"
          type="time"
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          error={errors.endTime}
        />
      </div>

      {type === 'class' && (
        <div className="mt-4 space-y-4">
          <Select
            label="Subject"
            value={subjectId}
            onChange={e => setSubjectId(e.target.value)}
            error={errors.subject}
            options={subjectOptions}
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Sections
            </label>
            {availableSections.length === 0 ? (
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                Choose a subject to list its sections.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableSections.map(sec => {
                  const checked = sectionIds.includes(sec.id);
                  return (
                    <label
                      key={sec.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        checked
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSection(sec.id)}
                        className="accent-indigo-600 w-3.5 h-3.5"
                      />
                      {sec.name.replace(/^Section\s+/i, '')}
                    </label>
                  );
                })}
              </div>
            )}
            {errors.sectionIds && (
              <p className="text-xs text-rose-600 mt-1 font-medium">{errors.sectionIds}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <Input
          label="Note (optional)"
          placeholder="e.g. Combined lecture, lab supervision..."
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      {saveError && (
        <p className="text-xs text-rose-600 mt-3 font-medium bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {saveError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} isLoading={submitting}>
          {entry ? 'Save Changes' : 'Save Entry'}
        </Button>
      </div>
    </Modal>
  );
};