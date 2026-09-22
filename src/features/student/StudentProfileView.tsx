import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { Student, Semester, Section } from '../../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  User,
  GraduationCap,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Award,
} from 'lucide-react';

export const StudentProfileView: React.FC = () => {
  const { user } = useAuth();
  const [student, setStudent] = useState<Student | null>(null);
  const [semester, setSemester] = useState<Semester | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [summary, setSummary] = useState({ total: 0, present: 0, absent: 0, late: 0, percentage: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const stu = await studentService.getCurrentStudent(user);
        if (stu) {
          setStudent(stu);
          const [sem, sec, attendance] = await Promise.all([
            semesterService.getSemesterById(stu.semesterId).catch(() => null),
            sectionService.getSectionById(stu.sectionId).catch(() => null),
            studentService.getMyAttendance(stu.id).catch(() => null),
          ]);
          setSemester(sem || null);
          setSection(sec || null);
          if (attendance) {
            setSummary({
              total: attendance.overallTotal,
              present: attendance.overallPresent,
              absent: attendance.overallTotal - attendance.overallPresent,
              late: 0,
              percentage: Math.round(attendance.overallPercentage),
            });
          }
        }
      } catch (err) {
        console.error('Failed loading student profile', err);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  if (loading && !student) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400 text-sm">
        Loading personal student profile...
      </div>
    );
  }

  if (!student) {
    return (
      <EmptyState
        icon={<User className="w-8 h-8" />}
        title="Student Profile Not Found"
        description="No institutional student record found matching your active authenticated account."
      />
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">My Profile</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Official institutional student credentials and enrollment record
        </p>
      </div>

      {/* Primary Profile Card */}
      <Card className="overflow-hidden border-slate-200">
        <div className="h-24 bg-indigo-700" />
        <CardContent className="pt-0 relative px-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 mb-6">
            <div className="flex items-end gap-4">
              <img
                src={student.avatar}
                alt={student.name}
                className="w-24 h-24 rounded-2xl border-4 border-white shadow-md object-cover bg-slate-100"
                referrerPolicy="no-referrer"
              />
              <div className="mb-1">
                <h3 className="text-xl font-bold text-slate-900">{student.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {student.studentId}
                  </span>
                  <span className="text-xs text-slate-500">Roll No: {student.rollNo}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={student.status === 'active' ? 'success' : 'default'}>
                Academic Status: {student.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
            {/* Academic Enrollment Information */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <GraduationCap className="w-4 h-4 text-indigo-600" /> Academic Enrollment
              </h4>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Enrolled Semester</span>
                  <span className="font-bold text-slate-900">{semester?.name || '—'}</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Assigned Section</span>
                  <span className="font-bold text-slate-900">{section?.name || 'Unallocated'} ({section?.room || 'Main Block'})</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Admission Year</span>
                  <span className="font-mono font-semibold text-slate-800">{student.admissionYear}</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Academic Standing</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Good Standing
                  </span>
                </div>
              </div>
            </div>

            {/* Attendance & Eligibility Status */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Award className="w-4 h-4 text-indigo-600" /> Cumulative Attendance Summary
              </h4>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between p-3 rounded-lg bg-indigo-50/50 border border-indigo-100">
                  <span className="text-indigo-900 font-medium">Cumulative Attendance</span>
                  <span className="font-mono text-base font-bold text-indigo-950">{summary.percentage}%</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Total Recorded Sessions</span>
                  <span className="font-mono font-semibold text-slate-800">{summary.total} Sessions</span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Present / Late / Absent</span>
                  <span className="font-mono text-slate-800 font-semibold">
                    <span className="text-emerald-600">{summary.present}</span> / <span className="text-amber-600">{summary.late}</span> / <span className="text-rose-600">{summary.absent}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-slate-500">Exam Permit Clearance</span>
                  <Badge variant={summary.percentage >= 75 ? 'success' : 'danger'}>
                    {summary.percentage >= 75 ? 'Approved for Semester Exams' : 'Subject Attendance Deficit'}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Contact Details */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
              Official Contact & Registry Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 text-slate-700 border border-slate-100">
                <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="truncate">{student.email}</span>
              </div>
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 text-slate-700 border border-slate-100">
                <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{student.phone || '+977 9800000000'}</span>
              </div>
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-slate-50 text-slate-700 border border-slate-100">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{student.address || 'Kathmandu, Nepal'}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
