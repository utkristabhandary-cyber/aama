import React, { useState, useEffect } from 'react';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { studentService } from '../../services/studentService';
import { errorMessage } from '../../services/apiClient';
import { Semester, SemesterStatus } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  CalendarDays,
  Plus,
  Edit2,
  Trash2,
} from 'lucide-react';

export const SemestersView: React.FC<{ onNavigate?: (viewId: string) => void }> = ({ onNavigate }) => {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSemester, setSelectedSemester] = useState<Semester | null>(null);
  const [semesterToDelete, setSemesterToDelete] = useState<Semester | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, { sections: number; subjects: number; students: number }>>({});
  const { showToast } = useToast();

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    academicYear: '2026-2027',
    startDate: '',
    endDate: '',
    status: 'active' as SemesterStatus,
    description: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await semesterService.getSemesters();
      setSemesters(list);
      const [sections, subjects, students] = await Promise.all([
        sectionService.getSections(),
        subjectService.getSubjects(),
        studentService.getStudents(),
      ]);
      const nextCounts: Record<string, { sections: number; subjects: number; students: number }> = {};
      list.forEach(sem => {
        nextCounts[sem.id] = {
          sections: sections.filter(s => s.semesterId === sem.id).length,
          subjects: subjects.filter(sub => sub.semesterId === sem.id).length,
          students: students.filter(stu => stu.semesterId === sem.id).length,
        };
      });
      setCounts(nextCounts);
    } catch (err) {
      setLoadError(errorMessage((err as { data?: unknown })?.data) || (err as Error).message);
      setSemesters([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setSelectedSemester(null);
    setFormData({
      name: '',
      code: `SEM${semesters.length + 1}-2026`,
      academicYear: '2026-2027',
      startDate: '2026-08-15',
      endDate: '2026-12-20',
      status: 'active',
      description: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (sem: Semester) => {
    setSelectedSemester(sem);
    setFormData({
      name: sem.name,
      code: sem.code,
      academicYear: sem.academicYear,
      startDate: sem.startDate,
      endDate: sem.endDate,
      status: sem.status,
      description: sem.description || '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      showToast({ title: 'Validation Error', description: 'Semester name is required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedSemester) {
        await semesterService.updateSemester(selectedSemester.id, formData);
        showToast({ title: 'Semester Updated', description: `${formData.name} was updated successfully.`, type: 'success' });
      } else {
        await semesterService.createSemester(formData);
        showToast({ title: 'Semester Created', description: `${formData.name} was registered.`, type: 'success' });
      }
      setIsModalOpen(false);
      loadData();
    } catch (err) {
      showToast({ title: 'Operation Failed', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!semesterToDelete) return;
    setIsSubmitting(true);
    try {
      await semesterService.deleteSemester(semesterToDelete.id);
      showToast({ title: 'Semester Deleted', description: 'Semester was deleted successfully.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setSemesterToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Cannot Delete Semester', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Semester Management</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure academic cohorts, terms, and session cycles
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openCreateModal}
        >
          Add Semester
        </Button>
      </div>

      {/* Semesters Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Semester</th>
                  <th className="px-5 py-3">Academic Year</th>
                  <th className="px-5 py-3">Duration (Dates)</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Sections</th>
                  <th className="px-5 py-3">Subjects</th>
                  <th className="px-5 py-3">Students</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-medium">Loading semesters…</span>
                      </div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={8} className="p-8">
                      <EmptyState
                        icon={<CalendarDays className="w-6 h-6" />}
                        title="Unable to load semesters"
                        description={loadError}
                        action={{ label: 'Retry', onClick: loadData }}
                      />
                    </td>
                  </tr>
                ) : semesters.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8">
                      <EmptyState
                        icon={<CalendarDays className="w-6 h-6" />}
                        title="No semesters found"
                        description="Start by creating an academic semester for the current term."
                        action={{ label: 'Create Semester', onClick: openCreateModal }}
                      />
                    </td>
                  </tr>
                ) : (
                  semesters.map(sem => {
                    const semCounts = counts[sem.id] || { sections: 0, subjects: 0, students: 0 };

                    const statusVariants = {
                      active: 'success',
                      upcoming: 'info',
                      completed: 'default',
                    } as const;

                    return (
                      <tr key={sem.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-4 font-bold text-slate-900">
                          <div>{sem.name}</div>
                          <div className="text-[11px] font-mono text-slate-400 font-normal">{sem.code}</div>
                        </td>
                        <td className="px-5 py-4 font-medium text-slate-700">{sem.academicYear}</td>
                        <td className="px-5 py-4 text-slate-600 font-mono text-[11px]">
                          {sem.startDate} → {sem.endDate}
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant={statusVariants[sem.status]}>{sem.status.toUpperCase()}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-semibold text-slate-800">{semCounts.sections}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-semibold text-slate-800">{semCounts.subjects}</span>
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-semibold text-slate-800">{semCounts.students}</span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditModal(sem)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                              title="Edit Semester"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setSemesterToDelete(sem);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                              title="Delete Semester"
                            >
                              <Trash2 className="w-4 h-4" />
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
        </CardContent>
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedSemester ? 'Edit Academic Semester' : 'Create Academic Semester'}
        description="Define term limits, academic calendar, and enrollment year."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Semester Name"
            placeholder="e.g. Semester 1"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Semester Code"
              placeholder="e.g. SEM1-2026"
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value })}
              required
            />
            <Input
              label="Academic Year"
              placeholder="e.g. 2026-2027"
              value={formData.academicYear}
              onChange={e => setFormData({ ...formData, academicYear: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={formData.startDate}
              onChange={e => setFormData({ ...formData, startDate: e.target.value })}
              required
            />
            <Input
              label="End Date"
              type="date"
              value={formData.endDate}
              onChange={e => setFormData({ ...formData, endDate: e.target.value })}
              required
            />
          </div>

          <Select
            label="Semester Status"
            value={formData.status}
            onChange={e => setFormData({ ...formData, status: e.target.value as SemesterStatus })}
            options={[
              { value: 'active', label: 'Active (Current Term)' },
              { value: 'upcoming', label: 'Upcoming (Next Term)' },
              { value: 'completed', label: 'Completed (Archived)' },
            ]}
          />

          <Input
            label="Description (Optional)"
            placeholder="Notes about curriculum or cohort batch..."
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
            >
              {selectedSemester ? 'Save Changes' : 'Create Semester'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Semester?"
        message={`Are you sure you want to permanently delete "${semesterToDelete?.name}"? Deletion is only permitted if no sections or classes are linked.`}
        confirmText="Delete Semester"
        variant="danger"
        isLoading={isSubmitting}
      />
    </div>
  );
};
