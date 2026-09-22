import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { studentService } from '../../services/studentService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { Teacher, Student, Semester, Section } from '../../types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  User,
  Mail,
  Phone,
  Shield,
  BookOpen,
  Calendar,
  Building,
  GraduationCap,
} from 'lucide-react';

export const UserProfileView: React.FC = () => {
  const { user, role } = useAuth();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [semester, setSemester] = useState<Semester | null>(null);
  const [section, setSection] = useState<Section | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (role === 'teacher') {
          const current = await teacherService.getCurrentTeacher(user);
          if (!cancelled) setTeacher(current ?? null);
        } else if (role === 'student') {
          const current = await studentService.getCurrentStudent(user);
          if (cancelled) return;
          setStudent(current ?? null);
          if (current) {
            const [sem, sec] = await Promise.all([
              semesterService.getSemesterById(current.semesterId),
              sectionService.getSectionById(current.sectionId),
            ]);
            if (!cancelled) {
              setSemester(sem ?? null);
              setSection(sec ?? null);
            }
          }
        }
      } catch {
        // Profile resolution is non-critical; leave rows unpopulated.
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  const academicYear = student ? semester?.academicYear || '—' : '—';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Institutional Profile</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Verified academic credentials, department affiliation, and institutional security
        </p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-24 h-24 rounded-2xl object-cover border-2 border-indigo-200 shadow-sm"
              />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-3xl font-bold border-2 border-indigo-200 shadow-sm shrink-0">
                {user?.name?.[0] || 'U'}
              </div>
            )}
            <div className="flex-1 text-center sm:text-left space-y-1">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h3 className="text-lg font-bold text-slate-900">{user?.name}</h3>
                <Badge variant={role === 'admin' ? 'purple' : role === 'teacher' ? 'success' : 'info'}>
                  {role.toUpperCase()}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 font-mono">
                {student ? `Student ID: ${student.studentId} • Roll: ${student.rollNo}` : teacher ? `Faculty ID: ${teacher.teacherId} • ${teacher.designation}` : 'Administrator'}
              </p>
              <div className="pt-3 flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  {user?.email}
                </span>
                {teacher && (
                  <span className="flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-slate-400" />
                    {teacher.department}
                  </span>
                )}
                {student && (
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
                    {semester?.name} ({section?.name})
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-sm">Academic Details</CardTitle>
            <CardDescription>Official institutional status</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Institution:</span>
              <span className="font-semibold text-slate-800">AAMS Academic Attendance Management System</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Academic Year:</span>
              <span className="font-semibold text-slate-800">{academicYear}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Account Status:</span>
              <Badge variant="success">Active / Enrolled</Badge>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Role Authority:</span>
              <span className="font-mono text-indigo-700 font-bold">{role}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-sm">Security & Access</CardTitle>
            <CardDescription>Authentication parameters</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Auth Method:</span>
              <span className="font-semibold text-slate-800">Institutional SSO / Role Auth</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Session Integrity:</span>
              <Badge variant="info">Verified</Badge>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">Audit Logging:</span>
              <span className="text-emerald-700 font-semibold">Enabled</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
