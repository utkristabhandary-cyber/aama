import React, { useState, useEffect, useMemo } from 'react';
import { timetableLiveApi } from '../../services/timetableLiveApi';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { teacherService } from '../../services/teacherService';
import {
  TimetableSlot,
  Semester,
  Section,
  Subject,
  Teacher,
} from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { AddTimetableModal } from './AddTimetableModal';
import { TimetableImportWizard } from './import/TimetableImportWizard';
import { ImportTemplateCard } from '../imports/ImportTemplateCard';
import { ImportHistoryModal } from './import/ImportHistoryModal';
import { ExportTimetableModal } from './ExportTimetableModal';
import { DAYS, TIME_SLOTS } from './constants';
import {
  Clock,
  Plus,
  Trash2,
  Edit2,
  Calendar,
  AlertTriangle,
  Layers,
  Briefcase,
  BookOpen,
  FileSpreadsheet,
  Download,
  Filter,
  Users,
  Search,
  CheckCircle,
  HelpCircle,
  History,
  DoorClosed,
} from 'lucide-react';

type ViewMode = 'section' | 'teacher' | 'semester' | 'combined' | 'weekly';

export const TimetableAdminView: React.FC = () => {
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // View Mode: 'section' | 'teacher' | 'semester' | 'combined' | 'weekly'
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');

  // Filters
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterTeacher, setFilterTeacher] = useState<string>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [filterTeachingType, setFilterTeachingType] = useState<string>('all');
  const [filterDay, setFilterDay] = useState<string>('all');
  const [filterRoom, setFilterRoom] = useState<string>('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const [selectedSlotForEdit, setSelectedSlotForEdit] = useState<TimetableSlot | null>(null);
  const [slotToDelete, setSlotToDelete] = useState<TimetableSlot | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { showToast } = useToast();

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [slots, sems, secs, subs, tchs] = await Promise.all([
        timetableLiveApi.getTimetable(),
        semesterService.getSemesters(),
        sectionService.getSections(),
        subjectService.getSubjects(),
        teacherService.getTeachers(),
      ]);
      setTimetable(slots);
      setSemesters(sems);
      setSections(secs);
      setSubjects(subs);
      setTeachers(tchs);
    } catch (err: any) {
      showToast({ title: 'Load Failed', message: err.message || 'Could not load timetable data.', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Map of section name -> id for resolving backend-provided section_names.
  const sectionIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const sec of sections) map[sec.name.toLowerCase()] = sec.id;
    return map;
  }, [sections]);

  /** Resolve all participating section ids for a slot (backend `section_names` is authoritative). */
  const getParticipatingSectionIds = (slot: TimetableSlot): string[] => {
    if (slot.sectionIds && slot.sectionIds.length > 0) return slot.sectionIds;
    if (slot.sectionNames && slot.sectionNames.length > 0) {
      const ids = slot.sectionNames
        .map(name => sectionIdByName[name.toLowerCase()])
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) return ids;
    }
    return slot.sectionId ? [slot.sectionId] : [];
  };

  // Filtered timetable slots
  const filteredSlots = useMemo(() => {
    return timetable.filter(slot => {
      if (viewMode === 'combined' && !slot.isCombined && (!slot.sectionIds || slot.sectionIds.length <= 1) && (!slot.sectionNames || slot.sectionNames.length <= 1)) {
        return false;
      }
      if (filterSemester !== 'all' && slot.semesterId !== filterSemester) {
        return false;
      }
      if (filterSection !== 'all') {
        const hasSec = getParticipatingSectionIds(slot).includes(filterSection);
        if (!hasSec) return false;
      }
      if (filterTeacher !== 'all' && slot.teacherId !== filterTeacher) {
        return false;
      }
      if (filterSubject !== 'all' && slot.subjectId !== filterSubject) {
        return false;
      }
      if (filterTeachingType !== 'all' && slot.classType !== filterTeachingType) {
        return false;
      }
      if (filterDay !== 'all' && slot.day !== filterDay) {
        return false;
      }
      if (filterRoom.trim() && !slot.room.toLowerCase().includes(filterRoom.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [
    timetable,
    viewMode,
    filterSemester,
    filterSection,
    filterTeacher,
    filterSubject,
    filterTeachingType,
    filterDay,
    filterRoom,
    sectionIdByName,
  ]);

  const handleSaveSlot = async (slotData: Omit<TimetableSlot, 'id'>) => {
    try {
      if (selectedSlotForEdit) {
        await timetableLiveApi.updateSlot(selectedSlotForEdit.id, slotData);
        showToast({ title: 'Slot Updated', message: 'Timetable session updated successfully.', type: 'success' });
      } else {
        await timetableLiveApi.createSlot(slotData);
        showToast({ title: 'Slot Created', message: 'New timetable session added to schedule.', type: 'success' });
      }
      loadData();
    } catch (err: any) {
      // Rethrow so the AddTimetableModal can surface the server conflict
      // (e.g. teacher/room/section collision) inline and keep the form open.
      throw err;
    }
  };

  const handleDelete = async () => {
    if (!slotToDelete) return;
    try {
      await timetableLiveApi.deleteSlot(slotToDelete.id);
      showToast({ title: 'Slot Deleted', message: 'Session removed from timetable.', type: 'info' });
      setSlotToDelete(null);
      setIsDeleteDialogOpen(false);
      loadData();
    } catch (err: any) {
      showToast({ title: 'Delete Failed', message: err.message || 'Error deleting timetable slot.', type: 'error' });
    }
  };

  const getParticipatingSectionsText = (slot: TimetableSlot) => {
    if (slot.sectionNames && slot.sectionNames.length > 0) {
      return slot.sectionNames.join(' + ');
    }
    if (slot.sectionIds && slot.sectionIds.length > 0) {
      return slot.sectionIds
        .map(id => sections.find(s => s.id === id)?.name || id)
        .join(' + ');
    }
    const sec = sections.find(s => s.id === slot.sectionId);
    return sec?.name || 'Section';
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Timetable Management</h1>
            <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-50 font-medium">
              Enterprise Relational Engine
            </Badge>
          </div>
          <p className="text-slate-500 text-xs mt-1">
            Configure institutional schedules, multi-section combined lectures, lab allocations, and data ingestion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsHistoryModalOpen(true)}
            className="text-slate-700"
          >
            <History className="w-4 h-4 mr-1.5 text-slate-500" />
            Import History
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExportModalOpen(true)}
            className="text-slate-700"
          >
            <Download className="w-4 h-4 mr-1.5 text-slate-500" />
            Export
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsImportWizardOpen(true)}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 bg-emerald-50/40"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
            Import Excel / CSV
          </Button>

          <ImportTemplateCard kind="timetable" exportOnly />

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedSlotForEdit(null);
              setIsAddModalOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Timetable
          </Button>
        </div>
      </div>

      {/* FILTER BAR & VIEW TOGGLES */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        {/* View Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('weekly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'weekly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Weekly Grid
            </button>
            <button
              onClick={() => setViewMode('section')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'section' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Section-wise
            </button>
            <button
              onClick={() => setViewMode('teacher')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'teacher' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Teacher-wise
            </button>
            <button
              onClick={() => setViewMode('semester')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'semester' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semester-wise
            </button>
            <button
              onClick={() => setViewMode('combined')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 ${
                viewMode === 'combined' ? 'bg-purple-600 text-white shadow-xs' : 'text-purple-700 hover:bg-purple-50'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Combined / Group Sessions
            </button>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <span className="font-bold text-slate-900">{filteredSlots.length}</span> of {timetable.length} sessions
          </div>
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
          {/* Academic Year */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Academic Year</label>
            <select
              value={filterAcademicYear}
              onChange={e => setFilterAcademicYear(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Years</option>
              <option value="2026">2026 - 2027</option>
              <option value="2025">2025 - 2026</option>
            </select>
          </div>

          {/* Semester */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Semester</label>
            <select
              value={filterSemester}
              onChange={e => setFilterSemester(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Semesters</option>
              {semesters.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Section */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Section</label>
            <select
              value={filterSection}
              onChange={e => setFilterSection(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Sections</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Teacher */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Teacher</label>
            <select
              value={filterTeacher}
              onChange={e => setFilterTeacher(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Faculty</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Subject</label>
            <select
              value={filterSubject}
              onChange={e => setFilterSubject(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Subjects</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Teaching Type */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Teaching Type</label>
            <select
              value={filterTeachingType}
              onChange={e => setFilterTeachingType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="Lecture">Lecture</option>
              <option value="Practical">Practical</option>
              <option value="Tutorial">Tutorial</option>
            </select>
          </div>

          {/* Day */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Day</label>
            <select
              value={filterDay}
              onChange={e => setFilterDay(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Days</option>
              {DAYS.map(d => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Room */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Classroom / Room</label>
            <input
              type="text"
              placeholder="e.g. Hall 1"
              value={filterRoom}
              onChange={e => setFilterRoom(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-blue-500 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-12 text-center">
          <div className="inline-flex items-center gap-2 text-slate-500 text-sm">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading timetable data...
          </div>
        </div>
      )}

      {/* VIEW RENDERER */}
      {!isLoading && viewMode === 'weekly' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              Institutional Master Timetable Matrix
            </h3>
            <span className="text-xs text-slate-500">Weekly Time Blocks (Sunday – Friday)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 text-xs font-bold border-b border-slate-200">
                  <th className="p-3.5 text-left w-36 border-r border-slate-200">Day / Period</th>
                  {TIME_SLOTS.map(slot => (
                    <th key={slot} className="p-3 text-center border-r border-slate-200 min-w-[160px]">
                      {slot}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {DAYS.map(dayName => (
                  <tr key={dayName} className="hover:bg-slate-50/50">
                    <td className="p-3.5 font-bold text-slate-900 border-r border-slate-200 bg-slate-50/70">
                      {dayName}
                    </td>
                    {TIME_SLOTS.map(timeRange => {
                      const [start, end] = timeRange.split(' - ');
                      const matchingSlots = filteredSlots.filter(
                        s => s.day === dayName && s.startTime === start
                      );

                      return (
                        <td key={timeRange} className="p-2 border-r border-slate-200 align-top">
                          {matchingSlots.length === 0 ? (
                            <div className="h-16 flex items-center justify-center text-slate-300 font-mono text-[11px]">
                              —
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {matchingSlots.map(slot => {
                                const sub = subjects.find(s => s.id === slot.subjectId);
                                const tch = teachers.find(t => t.id === slot.teacherId);
                                const isCombined = slot.isCombined || (slot.sectionIds && slot.sectionIds.length > 1);

                                return (
                                  <div
                                    key={slot.id}
                                    className={`p-2 rounded-xl border text-left transition group relative shadow-xs ${
                                      isCombined
                                        ? 'bg-purple-50/70 border-purple-200 hover:border-purple-400'
                                        : slot.classType === 'Practical'
                                        ? 'bg-emerald-50/60 border-emerald-200 hover:border-emerald-400'
                                        : 'bg-white border-slate-200 hover:border-blue-400'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span
                                        className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                          isCombined
                                            ? 'bg-purple-200/80 text-purple-900'
                                            : 'bg-slate-100 text-slate-800'
                                        }`}
                                      >
                                        {sub?.code || 'CS101'}
                                      </span>
                                      <span
                                        className={`text-[10px] font-semibold px-1.5 py-0.2 rounded-full ${
                                          slot.classType === 'Practical'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : slot.classType === 'Tutorial'
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-blue-100 text-blue-800'
                                        }`}
                                      >
                                        {slot.classType}
                                      </span>
                                    </div>

                                    <p className="font-semibold text-slate-900 truncate" title={sub?.name}>
                                      {sub?.name || 'Subject'}
                                    </p>

                                    <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 truncate">
                                      <Users className="w-3 h-3 text-purple-600 shrink-0" />
                                      <span className={isCombined ? 'font-bold text-purple-800' : 'text-slate-700'}>
                                        {getParticipatingSectionsText(slot)}
                                      </span>
                                    </div>

                                    <div className="text-[11px] text-slate-500 flex items-center justify-between mt-1">
                                      <span className="truncate">{tch?.name?.split(' ')[0] || 'Teacher'}</span>
                                      <span className="font-mono text-slate-600 bg-slate-100 px-1 rounded">
                                        {slot.room}
                                      </span>
                                    </div>

                                    {/* Action buttons on hover */}
                                    <div className="absolute top-1 right-1 hidden group-hover:flex items-center space-x-1 bg-white/90 rounded-md p-0.5 shadow-xs">
                                      <button
                                        onClick={() => {
                                          setSelectedSlotForEdit(slot);
                                          setIsAddModalOpen(true);
                                        }}
                                        className="p-1 hover:text-blue-600 text-slate-400 rounded"
                                        title="Edit Slot"
                                      >
                                        <Edit2 className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setSlotToDelete(slot);
                                          setIsDeleteDialogOpen(true);
                                        }}
                                        className="p-1 hover:text-rose-600 text-slate-400 rounded"
                                        title="Delete Slot"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COMBINED / GROUP TIMETABLE VIEW */}
      {!isLoading && viewMode === 'combined' && (
        <div className="space-y-4">
          <div className="p-4 bg-purple-50 rounded-2xl border border-purple-200 flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-purple-950">Combined Teaching Sessions</h3>
                <p className="text-xs text-purple-800 mt-0.5">
                  One single lecture conducted for multiple participating sections (e.g. F1 + F2 + F3). Students in each section maintain distinct attendance records.
                </p>
              </div>
            </div>
            <Badge variant="outline" className="border-purple-300 text-purple-800 bg-white font-mono">
              {filteredSlots.length} Combined Sessions
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSlots.map(slot => {
              const sem = semesters.find(s => s.id === slot.semesterId);
              const sub = subjects.find(s => s.id === slot.subjectId);
              const tch = teachers.find(t => t.id === slot.teacherId);

              return (
                <div
                  key={slot.id}
                  className="bg-white rounded-2xl border-2 border-purple-200 p-5 shadow-xs space-y-3 relative group"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-purple-800 bg-purple-100 px-2 py-0.5 rounded">
                      {sub?.code || 'CS101'}
                    </span>
                    <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-50 text-xs">
                      Combined {slot.classType}
                    </Badge>
                  </div>

                  <div>
                    <h4 className="text-base font-bold text-slate-900">{sub?.name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{sem?.name}</p>
                  </div>

                  <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-100 space-y-1.5 text-xs text-purple-900">
                    <div className="flex items-center justify-between">
                      <span className="text-purple-600 font-medium">Participating Sections:</span>
                      <span className="font-bold">{getParticipatingSectionsText(slot)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-purple-600 font-medium">Assigned Faculty:</span>
                      <span className="font-semibold">{tch?.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-purple-600 font-medium">Slot & Venue:</span>
                      <span className="font-bold">
                        {slot.day}, {slot.startTime}–{slot.endTime} ({slot.room})
                      </span>
                    </div>
                  </div>

                  {slot.notes && (
                    <p className="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                      Note: {slot.notes}
                    </p>
                  )}

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedSlotForEdit(slot);
                        setIsAddModalOpen(true);
                      }}
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        setSlotToDelete(slot);
                        setIsDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION-WISE / TEACHER-WISE / SEMESTER-WISE VIEWS */}
      {!isLoading && (viewMode === 'section' || viewMode === 'teacher' || viewMode === 'semester') && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider capitalize">
              {viewMode}-wise Detailed Breakdown ({filteredSlots.length} Sessions)
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Day & Time</th>
                  <th className="px-4 py-3">Subject / Course</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Semester</th>
                  <th className="px-4 py-3">Participating Section(s)</th>
                  <th className="px-4 py-3">Faculty</th>
                  <th className="px-4 py-3">Room / Venue</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSlots.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-400">
                      No timetable sessions found matching the active filters.
                    </td>
                  </tr>
                ) : (
                  filteredSlots.map(slot => {
                    const sem = semesters.find(s => s.id === slot.semesterId);
                    const sub = subjects.find(s => s.id === slot.subjectId);
                    const tch = teachers.find(t => t.id === slot.teacherId);
                    const isCombined = slot.isCombined || (slot.sectionIds && slot.sectionIds.length > 1);

                    return (
                      <tr key={slot.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                          {slot.day}, {slot.startTime}–{slot.endTime}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-slate-900">{sub?.name}</span>
                          <span className="text-[11px] font-mono text-slate-500 ml-1.5">({sub?.code})</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={
                              slot.classType === 'Practical'
                                ? 'success'
                                : slot.classType === 'Tutorial'
                                ? 'warning'
                                : 'default'
                            }
                            className="text-[10px] py-0"
                          >
                            {slot.classType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{sem?.name}</td>
                        <td className="px-4 py-3">
                          {isCombined ? (
                            <span className="inline-flex items-center text-purple-700 bg-purple-50 px-2 py-0.5 rounded font-semibold text-[11px]">
                              Combined: {getParticipatingSectionsText(slot)}
                            </span>
                          ) : (
                            <span className="text-slate-700">{getParticipatingSectionsText(slot)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">{tch?.name}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{slot.room}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end space-x-1">
                            <button
                              onClick={() => {
                                setSelectedSlotForEdit(slot);
                                setIsAddModalOpen(true);
                              }}
                              className="p-1 hover:text-blue-600 text-slate-400 rounded"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setSlotToDelete(slot);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1 hover:text-rose-600 text-slate-400 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Timetable Add / Edit Modal */}
      <AddTimetableModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleSaveSlot}
        initialSlot={selectedSlotForEdit}
        semesters={semesters}
        sections={sections}
        subjects={subjects}
        teachers={teachers}
      />

      {/* Live 3-Step Timetable Import Wizard */}
      <TimetableImportWizard
        isOpen={isImportWizardOpen}
        onClose={() => setIsImportWizardOpen(false)}
        onImportComplete={() => {
          loadData();
          setIsImportWizardOpen(false);
        }}
      />

      {/* Import History Modal */}
      <ImportHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
      />

      {/* Export Timetable Modal */}
      <ExportTimetableModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        filteredSlots={filteredSlots}
        activeFilterSummary={`View: ${viewMode}, Semester: ${filterSemester}, Type: ${filterTeachingType}`}
        semesters={semesters}
      />

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Delete Timetable Session"
        description="Are you sure you want to remove this session from the academic schedule? This action cannot be undone."
      />
    </div>
  );
};
