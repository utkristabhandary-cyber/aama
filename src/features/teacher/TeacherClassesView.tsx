import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { sectionService } from '../../services/sectionService';
import { reportService } from '../../services/reportService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { BookOpen, Users, CheckCircle2, ArrowRight, Layers, Clock, ListChecks } from 'lucide-react';

export const TeacherClassesView: React.FC<{
  onStartAttendance: (sessionId?: string) => void;
  onViewAttendanceHistory?: (subjectId?: string) => void;
}> = ({ onStartAttendance, onViewAttendanceHistory }) => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [inspectingClass, setInspectingClass] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionNames, setSectionNames] = useState<Record<string, string>>({});
  const [atRiskByStudent, setAtRiskByStudent] = useState<Record<string, { percentage: number; marked: number }>>({});

  const loadClasses = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const teacher = await teacherService.getCurrentTeacher(user);
      if (teacher) {
        const [teacherClasses, sections, summary] = await Promise.all([
          teacherService.getTeacherClasses(teacher.id),
          sectionService.getSections().catch(() => []),
          reportService.getScopedSummary().catch(() => null),
        ]);
        setClasses(teacherClasses);
        setSectionNames(Object.fromEntries(sections.map(s => [s.id, s.name.replace(/^Section\s+/i, '')])));
        // Server-computed at-risk students (below the 75% threshold) scoped to
        // this teacher's own sessions. Students without marked records are not
        // in this list and are shown as "No data" rather than a fake percentage.
        const risk: Record<string, { percentage: number; marked: number }> = {};
        (summary?.studentsAtRisk || []).forEach(s => {
          risk[String(s.studentId)] = { percentage: s.percentage, marked: s.marked };
        });
        setAtRiskByStudent(risk);
      }
    } catch (err) {
      console.error('Error loading teacher classes', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClasses();
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">My Classes</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Teaching assignments, combined lecture groups, and student rosters
          </p>
        </div>
      </div>

      {loading && classes.length === 0 ? (
        <div className="p-12 text-center text-xs text-slate-400">
          Loading your assigned teaching classes...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {classes.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                icon={<BookOpen className="w-6 h-6" />}
                title="No classes assigned"
                description="Contact the institutional administrator to assign curriculum teaching sessions to your profile."
              />
            </div>
          ) : (
            classes.map(item => (
              <Card key={item.id} className="hover:border-emerald-300 transition-all flex flex-col justify-between shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      {item.subject?.code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline">{item.session.classType || item.subject?.type}</Badge>
                      {item.isCombined && (
                        <Badge variant="warning" className="gap-1">
                          <Layers className="w-3 h-3" /> Combined
                        </Badge>
                      )}
                    </div>
                  </div>

                  <CardTitle className="text-base mt-2.5 line-clamp-1">{item.subject?.name}</CardTitle>
                  <CardDescription className="flex items-center gap-1 text-slate-600 font-medium">
                    {item.semester?.name} • Section {item.sectionLabels}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0 space-y-3.5">
                  <div className="flex items-center justify-between text-xs py-2.5 border-y border-slate-100 bg-slate-50/50 px-3 rounded-lg">
                    <span className="text-slate-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-400" /> Total Enrolled
                    </span>
                    <span className="font-bold text-slate-900 font-mono">{item.totalStudents} Students</span>
                  </div>

                  {item.session.room && (
                    <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
                      <span>Room: <strong className="text-slate-700">{item.session.room}</strong></span>
                      <span>Schedule: <strong className="text-slate-700">{item.session.startTime}–{item.session.endTime}</strong></span>
                    </div>
                  )}

                  {/* 3 Explicit Actions: Take Attendance, View Attendance, Class Roster */}
                  <div className="space-y-2 pt-1">
                    <Button
                      size="sm"
                      variant="primary"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 shadow-sm"
                      onClick={() => onStartAttendance(item.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Take Attendance
                    </Button>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => {
                          if (onViewAttendanceHistory) {
                            onViewAttendanceHistory(item.subject?.id);
                          } else {
                            onStartAttendance(item.id);
                          }
                        }}
                      >
                        <ListChecks className="w-3.5 h-3.5" /> Attendance Log
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1"
                        onClick={() => setInspectingClass(item)}
                      >
                        <Users className="w-3.5 h-3.5" /> Class Roster
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Class Roster Modal */}
      {inspectingClass && (
        <Modal
          isOpen={!!inspectingClass}
          onClose={() => setInspectingClass(null)}
          title={`Class Roster: ${inspectingClass.subject?.code} (${inspectingClass.session.classType})`}
          description={`${inspectingClass.students.length} Enrolled Students across Section ${inspectingClass.sectionLabels}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {inspectingClass.students.map((stu: any) => {
                const stats = atRiskByStudent[stu.id];
                const studentSection = sectionNames[stu.sectionId];

                return (
                  <div key={stu.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-slate-500 text-xs w-6">{stu.rollNo}</span>
                      <img
                        src={stu.avatar}
                        alt={stu.name}
                        className="w-8 h-8 rounded-full object-cover border border-slate-200 bg-slate-100"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-xs">{stu.name}</span>
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            Sec {studentSection || '—'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">{stu.studentId}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {stats ? (
                        <>
                          <span className={`text-xs font-mono font-bold ${stats.percentage < 75 ? 'text-rose-600' : 'text-slate-800'}`}>
                            {stats.percentage}% Attended
                          </span>
                          <Badge variant={stats.percentage >= 75 ? 'success' : 'danger'}>
                            {stats.percentage >= 75 ? 'Eligible' : 'Deficit'}
                          </Badge>
                        </>
                      ) : (
                        <Badge variant="default">No data yet</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                Total: {inspectingClass.students.length} students enrolled
              </span>
              <Button variant="outline" size="sm" onClick={() => setInspectingClass(null)}>
                Close Roster
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
