import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, X, BookOpen, Layers, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { teacherService } from '../../services/teacherService';
import { subjectService } from '../../services/subjectService';
import { sectionService } from '../../services/sectionService';

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (viewId: string, params?: Record<string, string>) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { role, user } = useAuth();
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<{
    students: any[];
    teachers: any[];
    subjects: any[];
    sections: any[];
  }>({ students: [], teachers: [], subjects: [], sections: [] });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Live directory source: students/teachers/subjects/sections come from the
  // DRF API (the same lists the CRUD views use). Never falls back to local
  // demo records.
  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (role === 'teacher' && user) {
        const current = await teacherService.getCurrentTeacher(user);
        let teacherRoster: any[] = [];
        if (current) {
          teacherRoster = await teacherService.getTeacherStudents(current.id);
        }
        const subjects = await subjectService.getSubjects();
        setDirectory({ students: teacherRoster, teachers: [], subjects, sections: [] });
      } else if (role === 'student') {
        const subjects = await subjectService.getSubjects();
        setDirectory({ students: [], teachers: [], subjects, sections: [] });
      } else {
        const [students, teachers, subjects, sections] = await Promise.all([
          studentService.getStudents(),
          teacherService.getTeachers(),
          subjectService.getSubjects(),
          sectionService.getSections(),
        ]);
        setDirectory({ students, teachers, subjects, sections });
      }
    } catch {
      setLoadError('Search unavailable right now. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  }, [role, user]);

  useEffect(() => {
    if (isOpen) loadDirectory();
  }, [isOpen, loadDirectory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { students: [], teachers: [], subjects: [], sections: [] };

    // Role-based visibility enforcement. `directory` holds the already-scoped
    // live lists (teachers search only their own students; students search
    // only subjects), so this layer only filters.
    const { students: rawStudents, teachers: rawTeachers, subjects, sections } = directory;

    const students = rawStudents
      .filter(
        s =>
          s.name.toLowerCase().includes(q) ||
          String(s.studentId || s.student_id || '').toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          String(s.rollNo || s.roll_no || '').includes(q)
      )
      .slice(0, 5);

    const teachers = rawTeachers
      .filter(
        t =>
          t.name.toLowerCase().includes(q) ||
          String(t.teacherId || t.teacher_id || '').toLowerCase().includes(q) ||
          t.email.toLowerCase().includes(q) ||
          t.department.toLowerCase().includes(q)
      )
      .slice(0, 4);

    const subjectsOnly = subjects
      .filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 4);

    const sectionsOnly = sections
      .filter(s => s.name.toLowerCase().includes(q) || s.room.toLowerCase().includes(q))
      .slice(0, 4);

    return { students, teachers, subjects: subjectsOnly, sections: sectionsOnly };
  }, [query, directory]);

  if (!isOpen) return null;

  const totalResults =
    results.students.length +
    results.teachers.length +
    results.subjects.length +
    results.sections.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-16 sm:pt-24 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-10 animate-in zoom-in-95 duration-150">
        <div className="flex items-center px-4 py-3 border-b border-slate-100 gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={
              role === 'student'
                ? 'Search subjects and academic schedule...'
                : role === 'teacher'
                ? 'Search enrolled students, subjects, sections...'
                : 'Search students, faculty, subjects, sections...'
            }
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {loadError ? (
            <div className="py-8 text-center text-xs text-rose-500">{loadError}</div>
          ) : loading ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Loading directory…
            </div>
          ) : query.trim() === '' ? (
            <div className="py-8 text-center text-xs text-slate-400">
              {role === 'student'
                ? 'Search your enrolled courses and lecture schedule.'
                : 'Type a name, roll number, course code (e.g. CS101), or section.'}
            </div>
          ) : totalResults === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No matching records found for "{query}".
            </div>
          ) : (
            <div className="space-y-3">
              {results.students.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1">
                    Enrolled Students ({results.students.length})
                  </p>
                  {results.students.map(s => (
                    <button
                      key={s.id}
                      onClick={() => {
                        if (role === 'teacher') {
                          onNavigate('teacher-students');
                        } else {
                          onNavigate('students', { studentId: s.id });
                        }
                        onClose();
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-medium text-xs shrink-0">
                          {s.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{s.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {s.studentId} • Roll #{s.rollNo}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {results.teachers.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1">
                    Faculty & Teachers
                  </p>
                  {results.teachers.map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onNavigate('teachers', { teacherId: t.id });
                        onClose();
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center font-medium text-xs shrink-0">
                          {t.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{t.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {t.teacherId} • {t.department}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {results.subjects.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1">
                    Subjects & Courses
                  </p>
                  {results.subjects.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => {
                        if (role === 'teacher') onNavigate('my-classes');
                        else if (role === 'student') onNavigate('my-timetable');
                        else onNavigate('subjects');
                        onClose();
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-medium text-xs shrink-0">
                          <BookOpen className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{sub.name}</p>
                          <p className="text-[11px] text-slate-500">
                            Code: {sub.code} • {sub.credits} Credits • {sub.type}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-amber-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {results.sections.length > 0 && role === 'admin' && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2.5 py-1">
                    Sections
                  </p>
                  {results.sections.map(sec => (
                    <button
                      key={sec.id}
                      onClick={() => {
                        onNavigate('sections');
                        onClose();
                      }}
                      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-slate-50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center font-medium text-xs shrink-0">
                          <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{sec.name}</p>
                          <p className="text-[11px] text-slate-500">{sec.room}</p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-purple-600 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            Role scope: <strong className="capitalize text-slate-600 font-semibold">{role}</strong>
          </span>
          <span>Press ESC to exit</span>
        </div>
      </div>
    </div>
  );
};
