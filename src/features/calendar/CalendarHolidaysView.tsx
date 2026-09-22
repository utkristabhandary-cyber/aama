import React, { useState, useEffect } from 'react';
import { holidayService } from '../../services/holidayService';
import { Holiday, HolidayType } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import {
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Sun,
  Flag,
  Sparkles,
} from 'lucide-react';

export const CalendarHolidaysView: React.FC = () => {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [holidayToDelete, setHolidayToDelete] = useState<Holiday | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  // Current viewed month: September 2026
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(8); // 0-indexed, 8 = September

  const [formData, setFormData] = useState({
    title: '',
    date: '2026-09-18',
    type: 'institutional' as HolidayType,
    description: '',
  });

  const loadData = async () => {
    const list = await holidayService.getHolidays();
    setHolidays(list);
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setFormData({
      title: '',
      date: '2026-09-15',
      type: 'institutional',
      description: '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.date) {
      showToast({ title: 'Validation Error', description: 'Title and date are required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      await holidayService.declareHoliday(formData);
      showToast({
        title: 'Holiday Declared',
        description: `"${formData.title}" declared. Class sessions suspended for ${formData.date}.`,
        type: 'success',
      });
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      showToast({ title: 'Error', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!holidayToDelete) return;
    setIsSubmitting(true);
    try {
      await holidayService.deleteHoliday(holidayToDelete.id);
      showToast({ title: 'Holiday Revoked', description: 'Holiday removed from calendar.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setHolidayToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Error', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build calendar matrix for September 2026
  // Sep 1, 2026 is Tuesday (day 2 in Sun=0). 30 days in September.
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Academic Calendar & Holidays</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Institutional schedule, statutory breaks, and class session suspension management
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openCreateModal}
        >
          Declare Holiday
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Calendar Grid (2 Cols) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                {monthNames[currentMonth]} {currentYear}
              </CardTitle>
              <CardDescription>Academic Term: Fall 2026</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setCurrentYear(2026);
                  setCurrentMonth(8);
                }}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700"
              >
                Today
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {/* Days of week header */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[11px] text-slate-400 uppercase tracking-wider mb-2">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {/* Calendar Cells */}
            <div className="grid grid-cols-7 gap-1.5">
              {/* Padding empty cells */}
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-[72px] p-1.5 rounded-lg bg-slate-50/40 border border-transparent" />
              ))}

              {/* Days */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const monthStr = String(currentMonth + 1).padStart(2, '0');
                const dayStr = String(dayNum).padStart(2, '0');
                const dateKey = `${currentYear}-${monthStr}-${dayStr}`;

                const isToday = dateKey === '2026-09-06';
                const holidayMatch = holidays.find(h => h.date === dateKey);

                return (
                  <div
                    key={dayNum}
                    className={`min-h-[72px] p-1.5 rounded-lg border transition-all flex flex-col justify-between ${
                      holidayMatch
                        ? 'bg-amber-50/70 border-amber-300'
                        : isToday
                        ? 'bg-indigo-50/50 border-indigo-400 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-bold leading-none ${
                          isToday
                            ? 'w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center font-mono'
                            : 'text-slate-700'
                        }`}
                      >
                        {dayNum}
                      </span>
                      {holidayMatch && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      )}
                    </div>

                    {holidayMatch ? (
                      <div className="mt-1">
                        <span className="text-[10px] font-semibold text-amber-900 bg-amber-100 px-1 py-0.5 rounded block truncate">
                          {holidayMatch.title}
                        </span>
                      </div>
                    ) : isToday ? (
                      <span className="text-[9px] font-bold text-indigo-700">Today</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Holidays List Card */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-base">Institutional Holiday Roster</CardTitle>
            <CardDescription>Official non-instructional calendar dates</CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto max-h-[460px] divide-y divide-slate-100">
            {holidays.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No holidays recorded for this academic year.
              </div>
            ) : (
              holidays.map(h => (
                <div key={h.id} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-slate-900">{h.title}</h4>
                        <Badge variant={h.type === 'national' ? 'purple' : h.type === 'institutional' ? 'warning' : 'default'}>
                          {h.type}
                        </Badge>
                      </div>
                      <p className="text-[11px] font-mono text-indigo-600 font-semibold mt-1">
                        {h.date}
                      </p>
                      {h.description && (
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {h.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setHolidayToDelete(h);
                        setIsDeleteDialogOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                      title="Revoke Holiday"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Declare Holiday Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Declare Institutional Holiday"
        description="Schedule a statutory holiday or emergency recess. Attendance marking will be automatically suspended."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Holiday Title / Observance"
            placeholder="e.g. University Foundation Day"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Observance Date"
              type="date"
              value={formData.date}
              onChange={e => setFormData({ ...formData, date: e.target.value })}
              required
            />
            <Select
              label="Classification"
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value as HolidayType })}
              options={[
                { value: 'institutional', label: 'Institutional Holiday' },
                { value: 'national', label: 'National Public Holiday' },
                { value: 'restricted', label: 'Restricted / Optional Holiday' },
                { value: 'emergency', label: 'Emergency / Weather Closure' },
              ]}
            />
          </div>

          <Input
            label="Official Description / Notice"
            placeholder="e.g. Academic classes and laboratories remain suspended."
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
          />

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Declaring this holiday will immediately trigger warning notices in the Teacher and Student dashboards and halt timetable roll call.
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              Commit Holiday Declaration
            </Button>
          </div>
        </form>
      </Modal>

      {/* Revoke Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Revoke Declared Holiday?"
        message={`Are you sure you want to remove "${holidayToDelete?.title}" from the calendar? Regular classes and attendance will resume.`}
        confirmText="Revoke Holiday"
        isLoading={isSubmitting}
      />
    </div>
  );
};
