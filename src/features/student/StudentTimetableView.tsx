import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { TimetableSlot } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { DAYS, TIME_SLOTS } from '../timetable/constants';

export const StudentTimetableView: React.FC = () => {
  const { user } = useAuth();
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [sectionName, setSectionName] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const student = await studentService.getCurrentStudent(user);
      if (cancelled || !student) return;
      setSectionName(student.sectionName || '');
      const list = await studentService.getMyTimetable(student.id, student.sectionId);
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
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Class Schedule & Timetable</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Weekly academic lectures for Section {sectionName}
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

                      return (
                        <td key={sIdx} className="p-2 border-r border-slate-200 align-top">
                          <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200/90 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-indigo-900 text-[11px]">
                                {slot.subjectCode}
                              </span>
                              <span className="text-[9px] font-mono bg-white px-1 rounded text-indigo-700 border border-indigo-200">
                                {slot.room}
                              </span>
                            </div>
                            <p className="font-medium text-slate-800 text-[11px] line-clamp-1">
                              {slot.subjectName}
                            </p>
                            <span className="text-[10px] text-slate-500 block pt-0.5">
                              {slot.teacherName}
                            </span>
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
