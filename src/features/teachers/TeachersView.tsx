import React, { useState, useEffect } from 'react';
import { teacherService } from '../../services/teacherService';
import { apiClient, errorMessage } from '../../services/apiClient';
import { ApiTeacherAssignment } from '../../types/api';
import { Teacher, TeacherStatus, Subject, Section, Semester } from '../../types';
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
import {
  Briefcase,
  Plus,
  Edit2,
  Trash2,
  Mail,
  Phone,
  UserCheck,
  History,
  FileSpreadsheet,
} from 'lucide-react';
import { TeacherImportWizard } from '../imports/TeacherImportWizard';
import { ImportTemplateCard } from '../imports/ImportTemplateCard';
import { TeacherImportHistoryModal } from '../imports/TeacherImportHistoryModal';

export const TeachersView: React.FC<{
  initialTeacherId?: string;
  onNavigate?: (viewId: string) => void;
}> = ({ initialTeacherId, onNavigate }) => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [assignments, setAssignments] = useState<ApiTeacherAssignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [teacherToDelete, setTeacherToDelete] = useState<Teacher | null>(null);
  const [profileTeacher, setProfileTeacher] = useState<Teacher | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    teacherId: '',
    name: '',
    email: '',
    phone: '',
    department: 'Computer Science & Engineering',
    designation: 'Associate Professor',
    qualification: 'M.Tech Computer Science',
    status: 'active' as TeacherStatus,
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await teacherService.getTeachers();
      setTeachers(list);
      if (initialTeacherId) {
        const match = list.find(t => t.id === initialTeacherId);
        if (match) setProfileTeacher(match);
      }
      const [asgList, subList, secList, semList] = await Promise.all([
        apiClient.list<ApiTeacherAssignment>('/academics/assignments/'),
        apiClient.list<import('../../types/api').ApiSubject>('/academics/subjects/'),
        apiClient.list<import('../../types/api').ApiSection>('/academics/sections/'),
        apiClient.list<import('../../types/api').ApiSemester>('/academics/semesters/'),
      ]);
      setAssignments(asgList);
      setSubjects(subList.map(s => ({
        id: String(s.id),
        code: s.code,
        name: s.name,
        semesterId: String(s.semester),
        credits: s.credits,
        type: s.type,
        status: s.status,
      })));
      setSections(secList.map(s => ({
        id: String(s.id),
        name: s.name,
        semesterId: String(s.semester),
        capacity: s.capacity,
        room: s.room,
      })));
      setSemesters(semList.map(sm => ({
        id: String(sm.id),
        name: sm.name,
        code: sm.code,
        academicYear: sm.academic_year,
        startDate: sm.start_date,
        endDate: sm.end_date,
        status: sm.status,
        description: sm.description || undefined,
      })));
    } catch (err) {
      setLoadError(errorMessage((err as { data?: unknown })?.data) || (err as Error).message);
      setTeachers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [initialTeacherId]);

  const departments = Array.from(new Set(teachers.map(t => t.department)));

  const filteredTeachers = teachers.filter(t => {
    const matchesSearch =
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.teacherId.toLowerCase().includes(search.toLowerCase()) ||
      t.email.toLowerCase().includes(search.toLowerCase());
    const matchesDept = departmentFilter === 'all' || t.department === departmentFilter;
    return matchesSearch && matchesDept;
  });

  const openCreateModal = () => {
    setSelectedTeacher(null);
    setFormData({
      teacherId: `TCH-${String(teachers.length + 1).padStart(3, '0')}`,
      name: '',
      email: '',
      phone: '+977 9841',
      department: 'Computer Science & Engineering',
      designation: 'Assistant Professor',
      qualification: 'M.Tech in CSE',
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (tch: Teacher) => {
    setSelectedTeacher(tch);
    setFormData({
      teacherId: tch.teacherId,
      name: tch.name,
      email: tch.email,
      phone: tch.phone,
      department: tch.department,
      designation: tch.designation,
      qualification: tch.qualification,
      status: tch.status,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) {
      showToast({ title: 'Validation Error', description: 'Name and email are required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedTeacher) {
        await teacherService.updateTeacher(selectedTeacher.id, formData);
        showToast({ title: 'Teacher Profile Updated', description: `${formData.name} record saved.`, type: 'success' });
      } else {
        await teacherService.createTeacher({
          ...formData,
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        });
        showToast({ title: 'Faculty Registered', description: `${formData.name} added to roster.`, type: 'success' });
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
    if (!teacherToDelete) return;
    setIsSubmitting(true);
    try {
      await teacherService.deleteTeacher(teacherToDelete.id);
      showToast({ title: 'Teacher Removed', description: 'Teacher record deleted.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setTeacherToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Cannot Delete Teacher', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Faculty & Teachers</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Academic staff directory, departmental appointments, and subject allocations
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onNavigate && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<UserCheck className="w-4 h-4" />}
              onClick={() => onNavigate('assignments')}
            >
              Teacher Assignments
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsHistoryModalOpen(true)}
            className="text-slate-700"
          >
            <History className="w-4 h-4 mr-1.5 text-slate-500" />
            Import History
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsImportWizardOpen(true)}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 bg-emerald-50/40"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5 text-emerald-600" />
            Import Teachers
          </Button>
          <ImportTemplateCard kind="teachers" exportOnly />
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={openCreateModal}
          >
            Add Teacher
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72">
          <SearchInput
            placeholder="Search by name, ID, or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        </div>

        <select
          value={departmentFilter}
          onChange={e => setDepartmentFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Departments</option>
          {departments.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Faculty Member</th>
                  <th className="px-5 py-3">Teacher ID</th>
                  <th className="px-5 py-3">Department & Designation</th>
                  <th className="px-5 py-3">Assigned Courses</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs font-medium">Loading faculty…</span>
                      </div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={6} className="p-8">
                      <EmptyState
                        icon={<Briefcase className="w-6 h-6" />}
                        title="Unable to load faculty"
                        description={loadError}
                        action={{ label: 'Retry', onClick: loadData }}
                      />
                    </td>
                  </tr>
                ) : filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8">
                      <EmptyState
                        icon={<Briefcase className="w-6 h-6" />}
                        title="No faculty members found"
                        description="Try modifying your search or add a new faculty record."
                        action={{ label: 'Add Teacher', onClick: openCreateModal }}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map(tch => {
                    const tchAssignments = assignments.filter(a => String(a.teacher) === tch.id);
                    const assignedSubs = tchAssignments
                      .map(a => subjects.find(s => s.id === String(a.subject))?.code)
                      .filter((c): c is string => Boolean(c));

                    return (
                      <tr key={tch.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <img
                              src={tch.avatar}
                              alt={tch.name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-200"
                            />
                            <div>
                              <button
                                onClick={() => setProfileTeacher(tch)}
                                className="font-bold text-slate-900 hover:text-indigo-600 transition-colors text-left"
                              >
                                {tch.name}
                              </button>
                              <div className="text-[11px] text-slate-400">{tch.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-mono font-bold text-slate-700">
                          {tch.teacherId}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-slate-800">{tch.department}</div>
                          <div className="text-[11px] text-slate-400">{tch.designation}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          {assignedSubs.length === 0 ? (
                            <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {assignedSubs.map((code, i) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-semibold"
                                >
                                  {code}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant={tch.status === 'active' ? 'success' : 'outline'}>
                            {tch.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setProfileTeacher(tch)}
                              className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-semibold"
                            >
                              Profile
                            </button>
                            <button
                              onClick={() => openEditModal(tch)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50"
                              title="Edit Faculty Record"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setTeacherToDelete(tch);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                              title="Delete Faculty Record"
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

      {/* Teacher Profile Modal Drawer */}
      {profileTeacher && (
        <Modal
          isOpen={!!profileTeacher}
          onClose={() => setProfileTeacher(null)}
          title={`Faculty Dossier: ${profileTeacher.name}`}
          description={`${profileTeacher.designation} • ${profileTeacher.department}`}
          maxWidth="2xl"
        >
          <div className="space-y-6">
            {/* Header Identity Card */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <img
                src={profileTeacher.avatar}
                alt={profileTeacher.name}
                className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-xs"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-bold text-slate-900">{profileTeacher.name}</h4>
                  <Badge variant="success">{profileTeacher.status.toUpperCase()}</Badge>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">{profileTeacher.qualification}</p>
                <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    {profileTeacher.email}
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    {profileTeacher.phone}
                  </span>
                </div>
              </div>
            </div>

            {/* Assigned Courses & Sections */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                Current Teaching Allocations
              </h5>
              <div className="space-y-2">
                {assignments.filter(a => String(a.teacher) === profileTeacher.id).map(asg => {
                  const sub = subjects.find(s => s.id === String(asg.subject));
                  const sec = sections.find(s => s.id === String(asg.section));
                  const sem = semesters.find(s => s.id === String(asg.semester));

                  return (
                    <div
                      key={asg.id}
                      className="p-3 rounded-lg border border-slate-200 bg-white flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                          {sub?.code}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-slate-800">{sub?.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {sem?.name} • {sec?.name} ({sec?.room})
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">Assigned Active</Badge>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weekly Timetable Grid Preview for this Teacher */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                Scheduled Timetable Slots
              </h5>
              <div className="p-3 rounded-lg border border-slate-100 bg-slate-50 text-xs text-slate-500">
                Timetable scheduling for this teacher will be available in a later phase.
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setProfileTeacher(null)}>
                Close Dossier
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedTeacher ? 'Edit Faculty Record' : 'Register Faculty Member'}
        description="Teacher account and institutional credentials."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Teacher ID"
              placeholder="e.g. TCH-005"
              value={formData.teacherId}
              onChange={e => setFormData({ ...formData, teacherId: e.target.value })}
              required
            />
            <Input
              label="Full Name"
              placeholder="e.g. Rajesh Sharma"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Institutional Email"
              type="email"
              placeholder="e.g. rajesh.sharma@aams.edu"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              required
            />
            <Input
              label="Phone Contact"
              placeholder="e.g. +977 9841234567"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Department"
              placeholder="e.g. Computer Science & Engineering"
              value={formData.department}
              onChange={e => setFormData({ ...formData, department: e.target.value })}
              required
            />
            <Input
              label="Designation"
              placeholder="e.g. Associate Professor"
              value={formData.designation}
              onChange={e => setFormData({ ...formData, designation: e.target.value })}
              required
            />
          </div>

          <Input
            label="Academic Qualification"
            placeholder="e.g. Ph.D. in Applied Mathematics"
            value={formData.qualification}
            onChange={e => setFormData({ ...formData, qualification: e.target.value })}
            required
          />

          <Select
            label="Status"
            value={formData.status}
            onChange={e => setFormData({ ...formData, status: e.target.value as TeacherStatus })}
            options={[
              { value: 'active', label: 'Active Faculty' },
              { value: 'inactive', label: 'Inactive / On Sabbatical' },
            ]}
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              {selectedTeacher ? 'Update Faculty' : 'Save Faculty Record'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Faculty Member?"
        message={`Are you sure you want to remove ${teacherToDelete?.name}? Teaching allocations and historical session associations should be audited.`}
        confirmText="Delete Record"
        isLoading={isSubmitting}
      />

      {/* Institutional Teacher Import Wizard (Phase C) */}
      <TeacherImportWizard
        isOpen={isImportWizardOpen}
        onClose={() => setIsImportWizardOpen(false)}
        onImportComplete={() => {
          loadData();
          setIsImportWizardOpen(false);
        }}
      />

      {/* Teacher Import History Modal */}
      <TeacherImportHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
      />
    </div>
  );
};
