import React, { useState, useEffect } from 'react';
import {
  TimetableSlot,
  DayOfWeek,
  Semester,
  Section,
  Subject,
  Teacher,
  SubjectType,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import { DAYS } from './constants';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import {
  AlertTriangle,
  Users,
  CheckCircle2,
  Clock,
  MapPin,
  BookOpen,
} from 'lucide-react';

interface AddTimetableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (slot: Omit<TimetableSlot, 'id'>) => Promise<void>;
  initialSlot?: TimetableSlot | null;
  semesters: Semester[];
  sections: Section[];
  subjects: Subject[];
  teachers: Teacher[];
}

export const AddTimetableModal: React.FC<AddTimetableModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSlot,
  semesters,
  sections,
  subjects,
  teachers,
}) => {
  const { showToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const [semesterId, setSemesterId] = useState(initialSlot?.semesterId || semesters[0]?.id || '');
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>(
    initialSlot?.sectionIds || (initialSlot?.sectionId ? [initialSlot.sectionId] : [])
  );
  const [subjectId, setSubjectId] = useState(initialSlot?.subjectId || '');
  const [teacherId, setTeacherId] = useState(initialSlot?.teacherId || teachers[0]?.id || '');
  const [classType, setClassType] = useState<SubjectType>(initialSlot?.classType || 'Lecture');
  const [day, setDay] = useState<DayOfWeek>(initialSlot?.day || 'Sunday');
  const [startTime, setStartTime] = useState(initialSlot?.startTime || '09:00');
  const [endTime, setEndTime] = useState(initialSlot?.endTime || '10:00');
  const [room, setRoom] = useState(initialSlot?.room || 'Lecture Hall 1');
  const [notes, setNotes] = useState(initialSlot?.notes || '');

  // Filter sections and subjects for chosen semester
  const availableSections = sections.filter(s => s.semesterId === semesterId);
  const availableSubjects = subjects.filter(s => s.semesterId === semesterId);

  // Initialize or synchronize when modal opens or semester changes
  useEffect(() => {
    setConflictWarning(null);
    if (initialSlot) {
      setSemesterId(initialSlot.semesterId);
      setSelectedSectionIds(initialSlot.sectionIds || [initialSlot.sectionId]);
      setSubjectId(initialSlot.subjectId);
      setTeacherId(initialSlot.teacherId);
      setClassType(initialSlot.classType);
      setDay(initialSlot.day);
      setStartTime(initialSlot.startTime);
      setEndTime(initialSlot.endTime);
      setRoom(initialSlot.room);
      setNotes(initialSlot.notes || '');
    } else {
      const firstSem = semesters[0]?.id || '';
      setSemesterId(firstSem);
      const semSecs = sections.filter(s => s.semesterId === firstSem);
      const semSubs = subjects.filter(s => s.semesterId === firstSem);
      setSelectedSectionIds(semSecs[0] ? [semSecs[0].id] : []);
      setSubjectId(semSubs[0]?.id || '');
      setTeacherId(teachers[0]?.id || '');
      setClassType('Lecture');
      setDay('Sunday');
      setStartTime('09:00');
      setEndTime('10:00');
      setRoom('Lecture Hall 1');
      setNotes('');
    }
  }, [isOpen, initialSlot, semesters]);

  // If Practical is chosen, enforce single section
  const handleSectionToggle = (secId: string) => {
    if (classType === 'Practical') {
      setSelectedSectionIds([secId]);
      return;
    }

    // For Lecture or Tutorial, allow multi-selection
    if (selectedSectionIds.includes(secId)) {
      if (selectedSectionIds.length > 1) {
        setSelectedSectionIds(selectedSectionIds.filter(id => id !== secId));
      } else {
        showToast({
          title: 'Section Required',
          message: 'At least one participating section must be selected.',
          type: 'warning',
        });
      }
    } else {
      setSelectedSectionIds([...selectedSectionIds, secId]);
    }
  };

  const handleClassTypeChange = (newType: SubjectType) => {
    setClassType(newType);
    if (newType === 'Practical' && selectedSectionIds.length > 1) {
      // Retain only the first section to comply with Practical rule
      setSelectedSectionIds([selectedSectionIds[0]]);
      showToast({
        title: 'Practical Constraint Enforced',
        message: 'Practical labs are restricted to a single section. Reduced selection to 1 section.',
        type: 'info',
      });
    }
  };

  // Server-side conflict detection happens on save: the backend is the single
  // source of truth for teacher/room/section collisions and business rules.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSectionIds.length === 0) {
      showToast({ title: 'Section Missing', message: 'Please select at least one participating section.', type: 'error' });
      return;
    }
    if (!subjectId) {
      showToast({ title: 'Subject Missing', message: 'Please select a subject.', type: 'error' });
      return;
    }
    if (startTime >= endTime) {
      showToast({ title: 'Invalid Time', message: 'End time must be strictly after start time.', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setConflictWarning(null);
    try {
      const isCombined = selectedSectionIds.length > 1;
      await onSave({
        semesterId,
        sectionId: selectedSectionIds[0],
        sectionIds: selectedSectionIds,
        subjectId,
        teacherId,
        day,
        startTime,
        endTime,
        room,
        classType,
        notes,
        isCombined,
      });
      onClose();
    } catch (err: any) {
      // The server rejected the slot (conflict or business rule). Surface the
      // reason inline and keep the form open so the admin can adjust.
      setConflictWarning(err.message || 'The server rejected this schedule entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSubjectObj = subjects.find(s => s.id === subjectId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialSlot ? 'Edit Timetable Session' : 'Add Timetable Session'}
      description="Define academic schedule, participating sections, faculty assignment, and venue."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Conflict Warning Callout */}
        {conflictWarning && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Collision Conflict</p>
              <p className="mt-0.5">{conflictWarning}</p>
            </div>
          </div>
        )}

        {/* Semester & Teaching Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Semester"
            value={semesterId}
            onChange={e => {
              const semId = e.target.value;
              setSemesterId(semId);
              const semSecs = sections.filter(s => s.semesterId === semId);
              const semSubs = subjects.filter(s => s.semesterId === semId);
              setSelectedSectionIds(semSecs[0] ? [semSecs[0].id] : []);
              setSubjectId(semSubs[0]?.id || '');
            }}
            options={semesters.map(s => ({ value: s.id, label: `${s.name} (${s.code})` }))}
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Teaching Type
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['Lecture', 'Practical', 'Tutorial'] as SubjectType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleClassTypeChange(type)}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
                    classType === type
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION PARTICIPATION SELECTOR (CRITICAL FEATURE) */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-purple-600" />
              Participating Section(s)
            </label>
            <span className="text-[11px] font-medium text-slate-500">
              {classType === 'Lecture'
                ? 'Select multiple for combined lecture (e.g. F1 + F2 + F3)'
                : 'Single section allocation for practical lab'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
            {availableSections.map(sec => {
              const isChecked = selectedSectionIds.includes(sec.id);
              return (
                <label
                  key={sec.id}
                  className={`flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer text-xs font-medium transition ${
                    isChecked
                      ? 'bg-purple-50 border-purple-300 text-purple-900 font-semibold'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type={classType === 'Practical' ? 'radio' : 'checkbox'}
                    name="participatingSections"
                    checked={isChecked}
                    onChange={() => handleSectionToggle(sec.id)}
                    className="rounded text-purple-600 focus:ring-purple-500 border-slate-300"
                  />
                  <span>{sec.name}</span>
                </label>
              );
            })}
          </div>

          {selectedSectionIds.length > 1 && (
            <div className="text-[11px] text-purple-700 bg-purple-100/60 p-2 rounded-lg font-medium flex items-center gap-1.5">
              <span className="font-bold">Combined Teaching Session:</span> Attended by{' '}
              {selectedSectionIds
                .map(id => availableSections.find(s => s.id === id)?.name)
                .filter(Boolean)
                .join(' + ')}{' '}
              simultaneously.
            </div>
          )}
        </div>

        {/* Subject & Module Code */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Select
              label="Subject / Module"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              options={availableSubjects.map(s => ({
                value: s.id,
                label: `${s.name} (${s.code}) • ${s.credits} Credits`,
              }))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Module Code</label>
            <div className="px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-700">
              {selectedSubjectObj?.code || '—'}
            </div>
          </div>
        </div>

        {/* Faculty / Teacher */}
        <Select
          label="Assigned Faculty / Teacher"
          value={teacherId}
          onChange={e => setTeacherId(e.target.value)}
          options={teachers.map(t => ({
            value: t.id,
            label: `${t.name} (${t.designation}, ${t.department})`,
          }))}
        />

        {/* Day, Start, End, Room */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Select
            label="Day of Week"
            value={day}
            onChange={e => setDay(e.target.value as DayOfWeek)}
            options={DAYS.map(d => ({ value: d, label: d }))}
          />
          <Input
            label="Start Time"
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
          />
          <Input
            label="End Time"
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
          />
          <Input
            label="Classroom / Venue"
            value={room}
            onChange={e => setRoom(e.target.value)}
            placeholder="e.g. Hall 1 or Lab 2"
          />
        </div>

        <Input
          label="Notes / Instructions (Optional)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Bring laptops, combined session"
        />

        <div className="flex justify-end space-x-3 pt-3 border-t border-slate-200">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" isLoading={isSubmitting}>
            {initialSlot ? 'Update Session' : 'Create Session'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
