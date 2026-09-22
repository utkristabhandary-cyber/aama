import React, { useState, useEffect } from 'react';
import { assignmentService } from '../../services/assignmentService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { teacherService } from '../../services/teacherService';
import { errorMessage } from '../../services/apiClient';
import { TeacherAssignment, Teacher, Semester, Section, Subject } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { UserCheck, Plus, Trash2, BookOpen, Layers, Users, Briefcase } from 'lucide-react';

export const AssignmentsView: React.FC = () => {
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // Filter
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [assignmentToDelete, setAssignmentToDelete] = useState<TeacherAssignment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { showToast } = useToast();

  // Form
  const [formData, setFormData] = useState({
    teacherId: '',
    semesterId: '',
    sectionId: '',
    subjectId: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [semList, secList, subList, tchList, asgList] = await Promise.all([
        semesterService.getSemesters(),
        sectionService.getSections(),
        subjectService.getSubjects(),
        teacherService.getTeachers(),
        assignmentService.getAssignments(),
      ]);
      setSemesters(semList);
      setSections(secList);
      setSubjects(subList);
      setTeachers(tchList);
      setAssignments(asgList);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    const semId = semesters[0]?.id || '';
    const semSecs = sections.filter(s => s.semesterId === semId);
    const semSubs = subjects.filter(s => s.semesterId === semId);

    setFormData({
      teacherId: teachers[0]?.id || '',
      semesterId: semId,
      sectionId: semSecs[0]?.id || '',
      subjectId: semSubs[0]?.id || '',
    });
    setIsModalOpen(true);
  };

  const handleSemesterChangeInModal = (semId: string) => {
    const semSecs = sections.filter(s => s.semesterId === semId);
    const semSubs = subjects.filter(s => s.semesterId === semId);
    setFormData({
      ...formData,
      semesterId: semId,
      sectionId: semSecs[0]?.id || '',
      subjectId: semSubs[0]?.id || '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.teacherId || !formData.semesterId || !formData.sectionId || !formData.subjectId) {
      showToast({ title: 'Validation Error', description: 'All fields must be selected.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      await assignmentService.createAssignment({
        ...formData,
        status: 'active',
      });
      showToast({ title: 'Assignment Created', description: 'Faculty member assigned to class section.', type: 'success' });
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      showToast({ title: 'Assignment Failed', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!assignmentToDelete) return;
    setIsSubmitting(true);
    try {
      await assignmentService.deleteAssignment(assignmentToDelete.id);
      showToast({ title: 'Assignment Removed', description: 'Teacher assignment unlinked.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setAssignmentToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Error', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredAssignments = assignments.filter(asg => {
    const matchesTeacher = teacherFilter === 'all' || asg.teacherId === teacherFilter;
    const matchesSem = semesterFilter === 'all' || asg.semesterId === semesterFilter;
    return matchesTeacher && matchesSem;
  });

  const modalSections = sections.filter(s => s.semesterId === formData.semesterId);
  const modalSubjects = subjects.filter(s => s.semesterId === formData.semesterId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Teacher Course Assignments</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Link faculty members with target semesters, class sections, and course curriculum
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openCreateModal}
        >
          Assign Teacher
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <select
          value={teacherFilter}
          onChange={e => setTeacherFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Faculty Members</option>
          {teachers.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.teacherId})</option>
          ))}
        </select>

        <select
          value={semesterFilter}
          onChange={e => setSemesterFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Semesters</option>
          {semesters.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="text-center py-16 text-sm text-slate-500">
          Loading assignments...
        </div>
      )}

      {!isLoading && loadError && (
        <div className="p-8 text-center space-y-3 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-sm font-semibold text-red-700">Failed to load assignments</p>
          <p className="text-xs text-red-600">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => loadData()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !loadError && assignments.length === 0 && (
        <EmptyState
          title="No teacher assignments yet"
          description="Assign faculty members to semesters, sections, and subjects to start."
          action={{ label: 'Assign Teacher', onClick: openCreateModal }}
          icon={<UserCheck className="w-6 h-6" />}
        />
      )}

      {!isLoading && !loadError && assignments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3">Faculty Instructor</th>
                    <th className="px-5 py-3">Course / Subject</th>
                    <th className="px-5 py-3">Semester</th>
                    <th className="px-5 py-3">Assigned Section</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAssignments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8">
                        <EmptyState
                          icon={<UserCheck className="w-6 h-6" />}
                          title="No assignments found"
                          description="Assign teachers to subjects and sections to enable attendance marking."
                          action={{ label: 'Assign Teacher', onClick: openCreateModal }}
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredAssignments.map(asg => {
                      const tch = teachers.find(t => t.id === asg.teacherId);
                      const sub = subjects.find(s => s.id === asg.subjectId);
                      const sem = semesters.find(s => s.id === asg.semesterId);
                      const sec = sections.find(s => s.id === asg.sectionId);

                      return (
                        <tr key={asg.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs shrink-0">
                                {tch?.name?.[0] || 'T'}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{tch?.name}</div>
                                <div className="text-[11px] text-slate-400 font-mono">{tch?.teacherId}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-900">{sub?.name}</div>
                            <div className="text-[11px] text-indigo-600 font-mono font-bold">{sub?.code}</div>
                          </td>
                          <td className="px-5 py-3.5 text-slate-700 font-medium">
                            {sem?.name}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-800">{sec?.name}</div>
                            <div className="text-[11px] text-slate-400">{sec?.room}</div>
                          </td>
                          <td className="px-5 py-3.5">
                            <Badge variant="success">Active</Badge>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => {
                                setAssignmentToDelete(asg);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                              title="Remove Assignment"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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
      )}

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Assign Faculty Member"
        description="Allocate teacher to teach a specific subject in a section."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Faculty Teacher"
            value={formData.teacherId}
            onChange={e => setFormData({ ...formData, teacherId: e.target.value })}
            options={teachers.map(t => ({ value: t.id, label: `${t.name} (${t.teacherId}) - ${t.department}` }))}
          />

          <Select
            label="Academic Semester"
            value={formData.semesterId}
            onChange={e => handleSemesterChangeInModal(e.target.value)}
            options={semesters.map(s => ({ value: s.id, label: `${s.name} (${s.academicYear})` }))}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Class Section"
              value={formData.sectionId}
              onChange={e => setFormData({ ...formData, sectionId: e.target.value })}
              options={modalSections.map(sec => ({ value: sec.id, label: `${sec.name} (${sec.room})` }))}
            />

            <Select
              label="Subject / Course"
              value={formData.subjectId}
              onChange={e => setFormData({ ...formData, subjectId: e.target.value })}
              options={modalSubjects.map(sub => ({ value: sub.id, label: `${sub.code}: ${sub.name}` }))}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              Confirm Assignment
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Remove Teacher Assignment?"
        message="Are you sure you want to unassign this faculty member from the section? Timetable classes will remain."
        confirmText="Remove Assignment"
        isLoading={isSubmitting}
      />
    </div>
  );
};
