import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { TimetableSlot } from '../../types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DAYS, TIME_SLOTS } from '../timetable/constants';
import { CheckCircle2, Clock } from 'lucide-react';

export const TeacherTimetableView: React.FC<{
  onStartAttendance: (slotId?: string) => void;
}> = ({ onStartAttendance }) => {
  const { user } = useAuth();
  const [slots, setSlots] = useState<TimetableSlot[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const teacher = await teacherService.getCurrentTeacher(user);
      if (cancelled || !teacher) return;
      const list = await teacherService.getTeacherTimetable(teacher.id);
      if (!cancelled) setSlots(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Faculty Teaching Timetable</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Weekly lecture commitments, laboratory hours, and room assignments
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left min-w-[700px]">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">
                <th className="p-4 w-28 border-r border-slate-200">Day</th>
                {TIME_SLOTS.map((time, idx) => (
                  <th key={idx} className="p-4 text-center border-r border-slate-200 font-mono text-[11px]">
                    {time}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {DAYS.map(day => {
                const daySlots = slots.filter(s => s.day === day);

                return (
                  <tr key={day} className="hover:bg-slate-50/50">
                    <td className="p-4 font-bold text-xs text-slate-900 border-r border-slate-200 bg-slate-50/40">
                      {day}
                    </td>
                    {TIME_SLOTS.map((slotRange, sIdx) => {
                      const [startTime] = slotRange.split(' - ');
                      const slot = daySlots.find(s => s.startTime.startsWith(startTime.trim()));

                      if (!slot) {
                        return (
                          <td key={sIdx} className="p-2 border-r border-slate-200 text-center bg-slate-50/10">
                            <span className="text-[11px] text-slate-300">—</span>
                          </td>
                        );
                      }

                      const isCombined = slot.isCombined || (slot.sectionIds && slot.sectionIds.length > 1);
                      const sectionsLabel = slot.sectionNames?.length
                        ? slot.sectionNames.join(' + ')
                        : (slot.sectionName || 'Section');

                      return (
                        <td key={sIdx} className="p-2 border-r border-slate-200 align-top">
                          <div
                            className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                              isCombined
                                ? 'bg-purple-50/80 border-purple-200'
                                : 'bg-emerald-50 border-emerald-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`font-bold text-[11px] ${
                                  isCombined ? 'text-purple-900' : 'text-emerald-900'
                                }`}
                              >
                                {slot.subjectCode}
                              </span>
                              <span className="text-[9px] font-mono bg-white px-1 rounded text-slate-700 border border-slate-200">
                                {slot.room}
                              </span>
                            </div>
                            <p className="font-medium text-slate-800 text-[11px] line-clamp-1">
                              {slot.subjectName}
                            </p>
                            {isCombined && (
                              <span className="inline-block text-[9px] font-bold text-purple-700 bg-purple-100/80 px-1 py-0.2 rounded">
                                Combined Lecture
                              </span>
                            )}
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[10px] text-slate-700 font-semibold truncate max-w-[90px]" title={sectionsLabel}>
                                {sectionsLabel}
                              </span>
                              <button
                                onClick={() => onStartAttendance(slot.id)}
                                className={`text-[10px] font-bold flex items-center gap-0.5 ${
                                  isCombined
                                    ? 'text-purple-700 hover:text-purple-900'
                                    : 'text-emerald-700 hover:text-emerald-900'
                                }`}
                              >
                                Take Roll
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
