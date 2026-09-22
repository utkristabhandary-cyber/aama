import React, { useState, useEffect, useMemo } from 'react';
import { subjectService } from '../../services/subjectService';
import { semesterService } from '../../services/semesterService';
import { errorMessage } from '../../services/apiClient';
import { Subject, SubjectType, SubjectStatus, Semester } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { SearchInput } from '../../components/ui/SearchInput';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { BookOpen, Plus, Edit2, Trash2 } from 'lucide-react';

export const SubjectsView: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);

  // Filters
  const [search, setSearch] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    semesterId: '',
    credits: 3,
    type: 'Lecture' as SubjectType,
    status: 'active' as SubjectStatus,
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [semList, subList] = await Promise.all([
        semesterService.getSemesters(),
        subjectService.getSubjects(),
      ]);
      setSemesters(semList);
      setSubjects(subList);
    } catch (err) {
      setLoadError(errorMessage((err as { data?: unknown })?.data) || (err as Error).message);
      setSubjects([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredSubjects = useMemo(() => {
    return subjects.filter(sub => {
      const matchesSearch =
        sub.name.toLowerCase().includes(search.toLowerCase()) ||
        sub.code.toLowerCase().includes(search.toLowerCase());
      const matchesSem = semesterFilter === 'all' || sub.semesterId === semesterFilter;
      const matchesType = typeFilter === 'all' || sub.type === typeFilter;
      const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
      return matchesSearch && matchesSem && matchesType && matchesStatus;
    });
  }, [subjects, search, semesterFilter, typeFilter, statusFilter]);

  const openCreateModal = () => {
    setSelectedSubject(null);
    setFormData({
      code: '',
      name: '',
      semesterId: semesters[0]?.id || '',
      credits: 3,
      type: 'Lecture',
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (sub: Subject) => {
    setSelectedSubject(sub);
    setFormData({
      code: sub.code,
      name: sub.name,
      semesterId: sub.semesterId,
      credits: sub.credits,
      type: sub.type,
      status: sub.status,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code || !formData.name || !formData.semesterId) {
      showToast({ title: 'Validation Error', description: 'Code, name, and semester are required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedSubject) {
        await subjectService.updateSubject(selectedSubject.id, formData);
        showToast({ title: 'Subject Updated', description: `${formData.code} was updated.`, type: 'success' });
      } else {
        await subjectService.createSubject(formData);
        showToast({ title: 'Subject Created', description: `${formData.code} was registered.`, type: 'success' });
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
    if (!subjectToDelete) return;
    setIsSubmitting(true);
    try {
      await subjectService.deleteSubject(subjectToDelete.id);
      showToast({ title: 'Subject Deleted', description: 'Subject deleted successfully.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setSubjectToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Cannot Delete Subject', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Curriculum & Subjects</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage academic course catalog, credits, and teaching formats
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={openCreateModal}
        >
          Add Subject
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Search by code or title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        </div>

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

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Types</option>
          <option value="Lecture">Lecture</option>
          <option value="Tutorial">Tutorial</option>
          <option value="Practical">Practical</option>
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Course Code</th>
                  <th className="px-5 py-3">Subject Name</th>
                  <th className="px-5 py-3">Semester</th>
                  <th className="px-5 py-3">Credits</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-medium">Loading subjects…</span>
                      </div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        icon={<BookOpen className="w-6 h-6" />}
                        title="Unable to load subjects"
                        description={loadError}
                        action={{ label: 'Retry', onClick: loadData }}
                      />
                    </td>
                  </tr>
                ) : filteredSubjects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        icon={<BookOpen className="w-6 h-6" />}
                        title="No subjects match filters"
                        description="Adjust your search criteria or register a new subject."
                        action={{ label: 'Add Subject', onClick: openCreateModal }}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredSubjects.map(sub => {
                    const sem = semesters.find(s => s.id === sub.semesterId);
                    return (
                      <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5 font-mono font-bold text-indigo-700">
                          {sub.code}
                        </td>
                        <td className="px-5 py-3.5 font-semibold text-slate-900">
                          {sub.name}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          {sem?.name || 'Unassigned'}
                        </td>
                        <td className="px-5 py-3.5 font-semibold text-slate-800">
                          {sub.credits} Credits
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant={sub.type === 'Practical' ? 'purple' : sub.type === 'Lecture' ? 'default' : 'info'}>
                            {sub.type}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant={sub.status === 'active' ? 'success' : 'outline'}>
                            {sub.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEditModal(sub)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50"
                              title="Edit Subject"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setSubjectToDelete(sub);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                              title="Delete Subject"
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

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedSubject ? 'Edit Subject' : 'Add New Subject'}
        description="Register subject details, semester assignment, and credit weighting."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Subject Code"
              placeholder="e.g. CS101"
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value })}
              required
            />
            <Input
              label="Credits"
              type="number"
              min="1"
              max="6"
              value={formData.credits}
              onChange={e => setFormData({ ...formData, credits: parseInt(e.target.value) || 3 })}
              required
            />
          </div>

          <Input
            label="Subject Full Title"
            placeholder="e.g. Programming Fundamentals"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Select
            label="Semester Placement"
            value={formData.semesterId}
            onChange={e => setFormData({ ...formData, semesterId: e.target.value })}
            options={semesters.map(s => ({ value: s.id, label: `${s.name} (${s.academicYear})` }))}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Course Type"
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value as SubjectType })}
              options={[
                { value: 'Lecture', label: 'Lecture (Theory)' },
                { value: 'Practical', label: 'Practical (Lab)' },
                { value: 'Tutorial', label: 'Tutorial (Problem Solving)' },
              ]}
            />
            <Select
              label="Status"
              value={formData.status}
              onChange={e => setFormData({ ...formData, status: e.target.value as SubjectStatus })}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              {selectedSubject ? 'Save Changes' : 'Add Subject'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Subject?"
        message={`Are you sure you want to delete ${subjectToDelete?.code} — ${subjectToDelete?.name}? Existing attendance history and teacher assignments will be affected.`}
        confirmText="Delete Subject"
        isLoading={isSubmitting}
      />
    </div>
  );
};
