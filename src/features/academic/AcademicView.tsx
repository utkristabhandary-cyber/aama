import React, { useState, useEffect } from 'react';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { studentService } from '../../services/studentService';
import { errorMessage } from '../../services/apiClient';
import { Semester, Section, Subject, Student } from '../../types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  Layers,
  GraduationCap,
  BookOpen,
  Users,
  ChevronDown,
  ChevronRight,
  Plus,
  ArrowRight,
  CalendarDays,
  ExternalLink,
} from 'lucide-react';

export interface AcademicViewProps {
  onNavigate: (viewId: string, params?: Record<string, string>) => void;
  onOpenCreateSemester?: () => void;
  onOpenCreateSection?: () => void;
  onOpenCreateSubject?: () => void;
}

export const AcademicView: React.FC<AcademicViewProps> = ({
  onNavigate,
  onOpenCreateSemester,
  onOpenCreateSection,
  onOpenCreateSubject,
}) => {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSemesters, setExpandedSemesters] = useState<Record<string, boolean>>({ 'sem-1': true });
  const [selectedSectionStudents, setSelectedSectionStudents] = useState<{ section: Section; students: Student[] } | null>(null);

  useEffect(() => {
    loadAcademicData();
  }, []);

  const loadAcademicData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [semestersRes, sectionsRes, subjectsRes, studentsRes] = await Promise.all([
        semesterService.getSemesters(),
        sectionService.getSections(),
        subjectService.getSubjects(),
        studentService.getStudents(),
      ]);
      setSemesters(semestersRes);
      setSections(sectionsRes);
      setSubjects(subjectsRes);
      setStudents(studentsRes);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSemester = (id: string) => {
    setExpandedSemesters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Academic Hierarchy</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Structured relational overview: Semesters → Sections → Students & Subjects
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<CalendarDays className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('semesters')}
          >
            Manage Semesters
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Layers className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('sections')}
          >
            Manage Sections
          </Button>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<BookOpen className="w-3.5 h-3.5" />}
            onClick={() => onNavigate('subjects')}
          >
            Manage Curriculum
          </Button>
        </div>
      </div>

      {/* Visual Hierarchy Cards */}
      {isLoading && (
        <div className="text-center py-16 text-sm text-slate-500">
          Loading academic hierarchy...
        </div>
      )}

      {!isLoading && loadError && (
        <div className="p-8 text-center space-y-3 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">Failed to load academic hierarchy</p>
          <p className="text-xs text-red-600">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => loadAcademicData()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !loadError && semesters.length === 0 && (
        <div className="text-center py-16 text-sm text-slate-500">
          No semesters yet. Create a semester to start building the academic structure.
        </div>
      )}

      {!isLoading && !loadError && semesters.length > 0 && (
      <div className="space-y-6">
        {semesters.map(semester => {
          const semSections = sections.filter(s => s.semesterId === semester.id);
          const semSubjects = subjects.filter(s => s.semesterId === semester.id);
          const semStudents = students.filter(s => s.semesterId === semester.id);
          const isExpanded = !!expandedSemesters[semester.id];

          return (
            <Card key={semester.id} className="border-slate-200">
              <div
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                onClick={() => toggleSemester(semester.id)}
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-700 shrink-0">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-bold text-slate-900">{semester.name}</h3>
                      <Badge variant={semester.status === 'active' ? 'success' : 'default'}>
                        {semester.status.toUpperCase()}
                      </Badge>
                      <span className="text-xs font-mono text-slate-500">{semester.code}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Academic Year: <span className="font-semibold text-slate-700">{semester.academicYear}</span> • Term: {semester.startDate} to {semester.endDate}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6 self-end sm:self-center">
                  <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
                    <div className="text-center">
                      <span className="block font-bold text-slate-900 text-sm">{semSections.length}</span>
                      <span className="text-[11px] text-slate-400">Sections</span>
                    </div>
                    <div className="text-center">
                      <span className="block font-bold text-slate-900 text-sm">{semSubjects.length}</span>
                      <span className="text-[11px] text-slate-400">Subjects</span>
                    </div>
                    <div className="text-center">
                      <span className="block font-bold text-slate-900 text-sm">{semStudents.length}</span>
                      <span className="text-[11px] text-slate-400">Enrolled</span>
                    </div>
                  </div>

                  <div className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </div>
                </div>
              </div>

              {/* Collapsible Tree Detail */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50/40 space-y-5 animate-in fade-in duration-150">
                  {/* Row 1: Sections */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-slate-500" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                          Class Sections ({semSections.length})
                        </h4>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        Click section to inspect enrolled students
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {semSections.map(sec => {
                        const secStudents = students.filter(s => s.sectionId === sec.id);
                        return (
                          <div
                            key={sec.id}
                            onClick={() => setSelectedSectionStudents({ section: sec, students: secStudents })}
                            className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-xs transition-all cursor-pointer group"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h5 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                                  {sec.name}
                                </h5>
                                <p className="text-xs text-slate-500 mt-0.5">{sec.room}</p>
                              </div>
                              <Badge variant="info">{secStudents.length} Students</Badge>
                            </div>

                            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                              <span>Capacity: {sec.capacity} seats</span>
                              <span className="text-indigo-600 font-semibold group-hover:underline flex items-center gap-1">
                                View Roster <ArrowRight className="w-3 h-3" />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Row 2: Curriculum Subjects for this Semester */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="w-4 h-4 text-slate-500" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Curriculum Subjects ({semSubjects.length})
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {semSubjects.map(sub => (
                        <div
                          key={sub.id}
                          className="p-3.5 rounded-xl bg-white border border-slate-200"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                              {sub.code}
                            </span>
                            <Badge variant="outline">{sub.type}</Badge>
                          </div>
                          <h5 className="text-xs font-bold text-slate-800 leading-tight">
                            {sub.name}
                          </h5>
                          <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between">
                            <span>Credits: {sub.credits}</span>
                            <span className="capitalize text-emerald-600 font-medium">● {sub.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      )}

      {/* Roster Modal if Section Clicked */}
      {selectedSectionStudents && (
        <Card className="border-indigo-200 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between bg-indigo-50/50">
            <div>
              <CardTitle>
                Student Roster — {selectedSectionStudents.section.name}
              </CardTitle>
              <CardDescription>
                {selectedSectionStudents.section.room} • {selectedSectionStudents.students.length} Enrolled Students
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedSectionStudents(null)}
            >
              Close Roster
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3">Roll</th>
                    <th className="px-5 py-3">Student Name</th>
                    <th className="px-5 py-3">Student ID</th>
                    <th className="px-5 py-3">Email Address</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedSectionStudents.students.map(stu => (
                    <tr key={stu.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono font-bold text-slate-700">{stu.rollNo}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-[10px]">
                            {stu.name[0]}
                          </div>
                          <span className="font-semibold text-slate-900">{stu.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-slate-500">{stu.studentId}</td>
                      <td className="px-5 py-3 text-slate-600">{stu.email}</td>
                      <td className="px-5 py-3">
                        <Badge variant="success">Active</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => onNavigate('students', { studentId: stu.id })}
                          className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                        >
                          View Profile →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
