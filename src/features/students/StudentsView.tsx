import React, { useState, useEffect, useMemo } from 'react';
import { studentService } from '../../services/studentService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { errorMessage } from '../../services/apiClient';
import { Student, StudentStatus, Semester, Section } from '../../types';
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
import { StudentImportWizard } from '../imports/StudentImportWizard';
import { StudentImportHistoryModal } from '../imports/StudentImportHistoryModal';
import { ImportTemplateCard } from '../imports/ImportTemplateCard';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  Mail,
  Phone,
  FileSpreadsheet,
  History,
} from 'lucide-react';

export const StudentsView: React.FC<{ initialStudentId?: string }> = ({ initialStudentId }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Import workflow (Phase B)
  const [isImportWizardOpen, setIsImportWizardOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Filters & Search
  const [search, setSearch] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    studentId: '',
    rollNo: '',
    name: '',
    email: '',
    phone: '',
    semesterId: '',
    sectionId: '',
    dateOfBirth: '2005-01-01',
    address: 'Kathmandu, Nepal',
    guardianName: 'Guardian Name',
    guardianPhone: '+977 9801234567',
    admissionYear: 2026,
    status: 'active' as StudentStatus,
  });

  const loadData = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [semList, secList, stuList] = await Promise.all([
        semesterService.getSemesters(),
        sectionService.getSections(),
        studentService.getStudents(),
      ]);
      setSemesters(semList);
      setSections(secList);
      setStudents(stuList);

      if (initialStudentId) {
        const match = stuList.find(s => s.id === initialStudentId);
        if (match) setProfileStudent(match);
      }
    } catch (err) {
      setLoadError(errorMessage((err as { data?: unknown })?.data) || (err as Error).message);
      setStudents([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [initialStudentId]);

  const filteredSections = useMemo(() => {
    if (formData.semesterId) {
      return sections.filter(s => s.semesterId === formData.semesterId);
    }
    return sections;
  }, [formData.semesterId, sections]);

  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchesSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.studentId.toLowerCase().includes(search.toLowerCase()) ||
        s.email.toLowerCase().includes(search.toLowerCase()) ||
        s.rollNo.includes(search);
      const matchesSem = semesterFilter === 'all' || s.semesterId === semesterFilter;
      const matchesSec = sectionFilter === 'all' || s.sectionId === sectionFilter;
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      return matchesSearch && matchesSem && matchesSec && matchesStatus;
    });
  }, [students, search, semesterFilter, sectionFilter, statusFilter]);

  const openCreateModal = () => {
    setSelectedStudent(null);
    const semId = semesters[0]?.id || '';
    const semSecs = sections.filter(sec => sec.semesterId === semId);
    const nextRoll = String(students.length + 1).padStart(3, '0');

    setFormData({
      studentId: `STU-2026-${nextRoll}`,
      rollNo: `01`,
      name: '',
      email: '',
      phone: '+977 9801',
      semesterId: semId,
      sectionId: semSecs[0]?.id || '',
      dateOfBirth: '2005-04-12',
      address: 'Kathmandu, Nepal',
      guardianName: '',
      guardianPhone: '+977 980',
      admissionYear: 2026,
      status: 'active',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (stu: Student) => {
    setSelectedStudent(stu);
    setFormData({
      studentId: stu.studentId,
      rollNo: stu.rollNo,
      name: stu.name,
      email: stu.email,
      phone: stu.phone,
      semesterId: stu.semesterId,
      sectionId: stu.sectionId,
      dateOfBirth: stu.dateOfBirth,
      address: stu.address,
      guardianName: stu.guardianName,
      guardianPhone: stu.guardianPhone,
      admissionYear: stu.admissionYear || 2026,
      status: stu.status,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.semesterId || !formData.sectionId) {
      showToast({ title: 'Validation Error', description: 'Name, email, semester, and section are required.', type: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (selectedStudent) {
        await studentService.updateStudent(selectedStudent.id, formData);
        showToast({ title: 'Student Updated', description: `${formData.name} record saved.`, type: 'success' });
      } else {
        await studentService.createStudent({
          ...formData,
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        });
        showToast({ title: 'Student Registered', description: `${formData.name} added to cohort.`, type: 'success' });
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
    if (!studentToDelete) return;
    setIsSubmitting(true);
    try {
      await studentService.deleteStudent(studentToDelete.id);
      showToast({ title: 'Student Removed', description: 'Student record deleted.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setStudentToDelete(null);
      loadData();
    } catch (err) {
      showToast({ title: 'Cannot Delete Student', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Directory</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cohort rosters, student profiles, and individual attendance percentages
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            Import Students
          </Button>
          <ImportTemplateCard kind="students" exportOnly />
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={openCreateModal}
          >
            Add Student
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Search name, ID, roll, email..."
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
          value={sectionFilter}
          onChange={e => setSectionFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Sections</option>
          {sections.map(sec => (
            <option key={sec.id} value={sec.id}>{sec.name}</option>
          ))}
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
                  <th className="px-5 py-3">Roll</th>
                  <th className="px-5 py-3">Student Name</th>
                  <th className="px-5 py-3">Student ID</th>
                  <th className="px-5 py-3">Semester & Section</th>
                  <th className="px-5 py-3">Attendance %</th>
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
                        <span className="text-xs font-medium">Loading students…</span>
                      </div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="Unable to load students"
                        description={loadError}
                        action={{ label: 'Retry', onClick: loadData }}
                      />
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="No students match criteria"
                        description="Try resetting search filters or register a new student."
                        action={{ label: 'Add Student', onClick: openCreateModal }}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map(stu => {
                    const sem = semesters.find(s => s.id === stu.semesterId);
                    const sec = sections.find(s => s.id === stu.sectionId);

                    return (
                      <tr key={stu.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5 font-mono font-bold text-slate-700">
                          {stu.rollNo}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <img
                              src={stu.avatar}
                              alt={stu.name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-200"
                            />
                            <div>
                              <button
                                onClick={() => setProfileStudent(stu)}
                                className="font-bold text-slate-900 hover:text-indigo-600 transition-colors text-left"
                              >
                                {stu.name}
                              </button>
                              <div className="text-[11px] text-slate-400">{stu.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-600">
                          {stu.studentId}
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-800">
                          {sem?.name || 'Sem'} • <span className="text-indigo-600">{sec?.name || 'Sec'}</span>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="text-slate-400 italic text-[11px]">—</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge variant={stu.status === 'active' ? 'success' : 'outline'}>
                            {stu.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setProfileStudent(stu)}
                              className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-semibold"
                            >
                              Profile
                            </button>
                            <button
                              onClick={() => openEditModal(stu)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50"
                              title="Edit Student Record"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                setStudentToDelete(stu);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                              title="Delete Student Record"
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

      {/* Student Profile Modal */}
      {profileStudent && (
        <Modal
          isOpen={!!profileStudent}
          onClose={() => setProfileStudent(null)}
          title={`Student Academic Profile: ${profileStudent.name}`}
          description={`Roll No: ${profileStudent.rollNo} • ID: ${profileStudent.studentId}`}
          maxWidth="2xl"
        >
{(() => {
            const sem = semesters.find(s => s.id === profileStudent.semesterId);
            const sec = sections.find(s => s.id === profileStudent.sectionId);

            return (
                <div className="space-y-6">
                  {/* Header Identity Card */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                    <img
                      src={profileStudent.avatar}
                      alt={profileStudent.name}
                      className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-xs"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-bold text-slate-900">{profileStudent.name}</h4>
                        <Badge variant="outline">Active Enrollment</Badge>
                      </div>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">
                      {sem?.name} • {sec?.name} ({sec?.room})
                    </p>
                    <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        {profileStudent.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {profileStudent.phone}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Attendance Reporting (future phase) */}
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-500">
                  Course-wise attendance reporting will be available in a later phase.
                </div>

                {/* Personal & Guardian Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div>
                    <span className="text-slate-400 block font-medium">Guardian Name:</span>
                    <span className="font-semibold text-slate-800">{profileStudent.guardianName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Guardian Emergency Phone:</span>
                    <span className="font-semibold text-slate-800">{profileStudent.guardianPhone}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Date of Birth:</span>
                    <span className="font-semibold text-slate-800">{profileStudent.dateOfBirth}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium">Residential Address:</span>
                    <span className="font-semibold text-slate-800">{profileStudent.address}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-slate-100">
                  <Button variant="outline" size="sm" onClick={() => setProfileStudent(null)}>
                    Close Profile
                  </Button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Add / Edit Student Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={selectedStudent ? 'Edit Student Record' : 'Enroll New Student'}
        description="Register student academic enrollment, cohort, and guardian contacts."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Student ID"
              placeholder="e.g. STU-2026-001"
              value={formData.studentId}
              onChange={e => setFormData({ ...formData, studentId: e.target.value })}
              required
            />
            <Input
              label="Roll Number"
              placeholder="e.g. 01"
              value={formData.rollNo}
              onChange={e => setFormData({ ...formData, rollNo: e.target.value })}
              required
            />
            <Input
              label="Full Name"
              placeholder="e.g. Aarav Sharma"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Email Address"
              type="email"
              placeholder="e.g. aarav.sharma@aams.edu"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              required
            />
            <Input
              label="Phone Number"
              placeholder="e.g. +977 9801234567"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Semester"
              value={formData.semesterId}
              onChange={e => {
                const newSem = e.target.value;
                const newSecs = sections.filter(sec => sec.semesterId === newSem);
                setFormData({
                  ...formData,
                  semesterId: newSem,
                  sectionId: newSecs[0]?.id || '',
                });
              }}
              options={semesters.map(s => ({ value: s.id, label: `${s.name} (${s.academicYear})` }))}
            />
            <Select
              label="Assigned Section"
              value={formData.sectionId}
              onChange={e => setFormData({ ...formData, sectionId: e.target.value })}
              options={filteredSections.map(sec => ({ value: sec.id, label: `${sec.name} (${sec.room})` }))}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Guardian Name"
              placeholder="e.g. Ramesh Sharma"
              value={formData.guardianName}
              onChange={e => setFormData({ ...formData, guardianName: e.target.value })}
              required
            />
            <Input
              label="Guardian Phone"
              placeholder="e.g. +977 9801122334"
              value={formData.guardianPhone}
              onChange={e => setFormData({ ...formData, guardianPhone: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Date of Birth"
              type="date"
              value={formData.dateOfBirth}
              onChange={e => setFormData({ ...formData, dateOfBirth: e.target.value })}
              required
            />
            <Select
              label="Enrollment Status"
              value={formData.status}
              onChange={e => setFormData({ ...formData, status: e.target.value as StudentStatus })}
              options={[
                { value: 'active', label: 'Active Student' },
                { value: 'inactive', label: 'Inactive / Suspended' },
              ]}
            />
          </div>

          <Input
            label="Home Address"
            placeholder="e.g. Kathmandu, Bagmati"
            value={formData.address}
            onChange={e => setFormData({ ...formData, address: e.target.value })}
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
              {selectedStudent ? 'Save Changes' : 'Enroll Student'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Student Record?"
        message={`Are you sure you want to remove ${studentToDelete?.name} (${studentToDelete?.studentId})? All attendance records will be removed.`}
        confirmText="Delete Record"
        isLoading={isSubmitting}
      />

      {/* Institutional Student Import Wizard (Phase B) */}
      <StudentImportWizard
        isOpen={isImportWizardOpen}
        onClose={() => setIsImportWizardOpen(false)}
        onImportComplete={() => {
          loadData();
          setIsImportWizardOpen(false);
        }}
      />

      {/* Student Import History Modal */}
      <StudentImportHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
      />
    </div>
  );
};
