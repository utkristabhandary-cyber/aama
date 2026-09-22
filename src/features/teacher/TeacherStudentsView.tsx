import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { EmptyState } from '../../components/ui/EmptyState';
import { Users, Search, GraduationCap, Mail, Phone, BookOpen, CheckCircle2 } from 'lucide-react';

export const TeacherStudentsView: React.FC = () => {
  const { user } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState('');

  const loadStudents = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const teacher = await teacherService.getCurrentTeacher(user);
      if (teacher) {
        const teacherStudents = await teacherService.getTeacherStudents(teacher.id);
        setStudents(teacherStudents);
      }
    } catch (err) {
      console.error('Error loading teacher students', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, [user]);

  // Unique sections taught
  const availableSections = Array.from(new Set(students.map(s => s.sectionName))).filter(Boolean);

  const formatSectionName = (name?: string | null) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Unassigned';
    return /^section\b/i.test(trimmed) ? trimmed : `Section ${trimmed}`;
  };

  const filteredStudents = students.filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.rollNo.includes(searchQuery);
    const matchesSection = !selectedSection || s.sectionName === selectedSection;
    return matchesSearch && matchesSection;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">My Students</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Student directory scoped strictly to sections and lectures taught by your faculty profile
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="info" className="text-xs font-mono">
            {students.length} Total Enrolled Students
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search enrolled students by name, roll number, or ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <div className="w-full sm:w-56">
            <Select
              value={selectedSection}
              onChange={e => setSelectedSection(e.target.value)}
              options={[
                { value: '', label: 'All Assigned Sections' },
                ...availableSections.map(sec => ({ value: sec, label: formatSectionName(sec) })),
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Students Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Student Name</th>
                  <th className="px-5 py-3">Roll & ID</th>
                  <th className="px-5 py-3">Assigned Class Section</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3 text-right">Attendance Rate</th>
                  <th className="px-5 py-3 text-center">Permit Clearance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      Loading enrolled student directory...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No enrolled students found matching the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map(student => {
                    const pct = student.attendanceSummary?.percentage;
                    const isGood = pct != null && pct >= 75;

                    return (
                      <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <img
                              src={student.avatar}
                              alt={student.name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-200 bg-slate-100"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <div className="font-bold text-slate-900">{student.name}</div>
                              <div className="text-[11px] text-slate-400">{student.semesterName}</div>
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 font-mono text-slate-700">
                          <div className="font-bold text-slate-900">Roll #{student.rollNo}</div>
                          <div className="text-[11px] text-indigo-600">{student.studentId}</div>
                        </td>

                        <td className="px-5 py-3.5">
                          <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-xs">
                            {formatSectionName(student.sectionName)}
                          </span>
                        </td>

                        <td className="px-5 py-3.5 text-slate-600">
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <Mail className="w-3 h-3 text-slate-400" /> {student.email}
                          </div>
                          {student.phone && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                              <Phone className="w-3 h-3" /> {student.phone}
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-right font-mono font-bold">
                          {pct == null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className={isGood ? 'text-emerald-600' : 'text-rose-600'}>
                              {pct}%
                            </span>
                          )}
                          {pct == null && (
                            <span className="text-[10px] text-slate-400 block">No records yet</span>
                          )}
                        </td>

                        <td className="px-5 py-3.5 text-center">
                          {pct == null ? (
                            <Badge variant="default">N/A</Badge>
                          ) : (
                            <Badge variant={isGood ? 'success' : 'danger'}>
                              {isGood ? 'Clear' : 'Shortage'}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
