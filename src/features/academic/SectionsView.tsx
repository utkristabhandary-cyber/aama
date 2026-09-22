import React, { useState, useEffect } from 'react';
import { sectionService } from '../../services/sectionService';
import { semesterService } from '../../services/semesterService';
import { studentService } from '../../services/studentService';
import { errorMessage } from '../../services/apiClient';
import { Section, Semester } from '../../types';
import { useToast } from '../../context/ToastContext';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { Layers, Plus, Edit2, Trash2 } from 'lucide-react';

export const SectionsView: React.FC<{ onNavigate?: (viewId: string, params?: any) => void }> = ({ onNavigate }) => {
  const [sections, setSections] = useState<Section[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemesterFilter, setSelectedSemesterFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<Section | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enrolledCounts, setEnrolledCounts] = useState<Record<string, number>>({});
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    semesterId: '',
    capacity: 35,
    room: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const semList = await semesterService.getSemesters();
      setSemesters(semList);
      const secList = await sectionService.getSections(
        selectedSemesterFilter === 'all' ? undefined : selectedSemesterFilter
      );
      setSections(secList);
      const allStudents = await studentService.getStudents();
      const nextCounts: Record<string, number> = {};
      secList.forEach(sec => {
        nextCounts[sec.id] = allStudents.filter(s => s.sectionId === sec.id).length;
      });
      setEnrolledCounts(nextCounts);
    } catch (err) {
      setLoadError(errorMessage((err as { data?: unknown })?.data) || (err as Error).message);
      setSections([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedSemesterFilter]);

  const openCreateModal = () => {
    setSelectedSection(null);
    setFormData({
      name: '',
      semesterId: semesters[0]?.id || '',
      capacity: 35,
      room: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (sec: Section) => {
    setSelectedSection(sec);
    setFormData({
      name: sec.name,
      semesterId: sec.semesterId,
      capacity: sec.capacity,
      room: sec.room,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.semesterId) {
      showToast({ title: 'Validation Error', description: 'Section name and semester are required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedSection) {
        await sectionService.updateSection(selectedSection.id, formData);
        showToast({ title: 'Section Updated', description: `${formData.name} was updated.`, type: 'success' });
      } else {
        await sectionService.createSection(formData);
        showToast({ title: 'Section Created', description: `${formData.name} was registered.`, type: 'success' });
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
    if (!sectionToDelete) return;
    setIsSubmitting(true);
    try {
      await sectionService.deleteSection(sectionToDelete.id);
      showToast({ title: 'Section Deleted', description: 'Section deleted successfully.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setSectionToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Cannot Delete Section', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Class Sections</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage cohort divisions, designated lecture halls, and seating capacity
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSemesterFilter}
            onChange={e => setSelectedSemesterFilter(e.target.value)}
            className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-700 font-medium"
          >
            <option value="all">All Semesters</option>
            {semesters.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.academicYear})</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={openCreateModal}
          >
            Add Section
          </Button>
        </div>
      </div>

      {/* Grid of Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex flex-col items-center gap-2 text-slate-500 py-10">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium">Loading sections…</span>
          </div>
        ) : loadError ? (
          <div className="col-span-full">
            <EmptyState
              icon={<Layers className="w-6 h-6" />}
              title="Unable to load sections"
              description={loadError}
              action={{ label: 'Retry', onClick: loadData }}
            />
          </div>
        ) : sections.length === 0 ? (
          <div className="col-span-full">
            <EmptyState
              icon={<Layers className="w-6 h-6" />}
              title="No sections found"
              description="Create a section to group students and schedule classes."
              action={{ label: 'Add Section', onClick: openCreateModal }}
            />
          </div>
        ) : (
          sections.map(sec => {
            const sem = semesters.find(s => s.id === sec.semesterId);
            const enrolledStudents = enrolledCounts[sec.id] || 0;

            return (
              <Card key={sec.id} className="hover:border-slate-300 transition-all">
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      {sem?.name || 'Semester'}
                    </span>
                    <CardTitle className="text-base mt-2">{sec.name}</CardTitle>
                    <p className="text-xs text-slate-500 mt-0.5">{sec.room}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(sec)}
                      className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-100"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setSectionToDelete(sec);
                        setIsDeleteDialogOpen(true);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between text-xs py-3 border-y border-slate-100 mb-3">
                    <span className="text-slate-500">Enrolled Students</span>
                    <span className="font-bold text-slate-800">
                      {enrolledStudents} / {sec.capacity}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    onClick={() => {
                      if (onNavigate) onNavigate('academic');
                    }}
                  >
                    View Section Roster & Hierarchy
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedSection ? 'Edit Section' : 'Create Section'}
        description="Specify section designation, allocated room, and student seating limit."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Section Name"
            placeholder="e.g. Section A"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Select
            label="Belongs to Semester"
            value={formData.semesterId}
            onChange={e => setFormData({ ...formData, semesterId: e.target.value })}
            options={semesters.map(s => ({ value: s.id, label: `${s.name} (${s.academicYear})` }))}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Room / Lecture Hall"
              placeholder="e.g. Room 204 (North Block)"
              value={formData.room}
              onChange={e => setFormData({ ...formData, room: e.target.value })}
              required
            />
            <Input
              label="Seating Capacity"
              type="number"
              value={formData.capacity}
              onChange={e => setFormData({ ...formData, capacity: parseInt(e.target.value) || 30 })}
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              {selectedSection ? 'Update Section' : 'Create Section'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Section?"
        message={`Are you sure you want to delete ${sectionToDelete?.name}? Sections with enrolled students cannot be deleted.`}
        confirmText="Delete Section"
        isLoading={isSubmitting}
      />
    </div>
  );
};
