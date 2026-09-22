import React, { useState, useEffect, useRef } from 'react';
import {
  sectionAllocationService,
  CSVParseResult,
} from '../../services/sectionAllocationService';
import { semesterService } from '../../services/semesterService';
import { useToast } from '../../context/ToastContext';
import { Semester } from '../../types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import {
  UploadCloud,
  FileSpreadsheet,
  Check,
} from 'lucide-react';

const SAMPLE_CSV = `student_id,student_name,section
STU-2026-001,Aarav Sharma,1B
STU-2026-002,Sita Adhikari,1A
STU-2026-003,Bipin Thapa,1B
ST999,Unknown Student,1A`;

export const SectionAllocationCSVView: React.FC<{
  onFinished?: () => void;
}> = ({ onFinished }) => {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState<string>('');
  const [semesterLoadError, setSemesterLoadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [file, setFile] = useState<File | null>(null);
  const [csvRawText, setCsvRawText] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  // Analysis / Preview State
  const [previewResult, setPreviewResult] = useState<CSVParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'change' | 'unallocated' | 'rejected'>('all');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);

  useEffect(() => {
    semesterService
      .getSemesters()
      .then(list => {
        setSemesters(list);
        if (list.length > 0) {
          setSelectedSemesterId(list[0].id);
        }
      })
      .catch(() => {
        setSemesterLoadError('Could not load semesters. Please sign in again.');
      });
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (uploadedFile: File) => {
    if (!uploadedFile.name.endsWith('.csv') && uploadedFile.type !== 'text/csv') {
      showToast({
        title: 'Invalid File Format',
        description: 'Please select a valid comma-separated (.csv) text file.',
        type: 'danger',
      });
      return;
    }

    setFile(uploadedFile);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      setCsvRawText(text);
      analyzeCSV(text, selectedSemesterId);
    };
    reader.readAsText(uploadedFile);
  };

  const handleLoadSample = () => {
    setFile(new File([SAMPLE_CSV], 'sample_section_allocation.csv', { type: 'text/csv' }));
    setCsvRawText(SAMPLE_CSV);
    analyzeCSV(SAMPLE_CSV, selectedSemesterId);
  };

  const analyzeCSV = async (content: string, semesterId: string) => {
    if (!content.trim() || !semesterId) return;
    setIsAnalyzing(true);
    try {
      const result = await sectionAllocationService.previewSectionAllocationCSV(content, semesterId);
      setPreviewResult(result);
      if (!result.isValidFormat) {
        showToast({
          title: 'CSV Header Error',
          description: result.errors[0] || 'Invalid CSV format.',
          type: 'danger',
        });
      }
    } catch (err: any) {
      showToast({ title: 'Analysis Error', description: err.message, type: 'danger' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSemesterChange = (newSemId: string) => {
    setSelectedSemesterId(newSemId);
    if (csvRawText) {
      analyzeCSV(csvRawText, newSemId);
    }
  };

  const handleCommitAllocation = async () => {
    if (!previewResult) return;
    setIsApplying(true);
    try {
      const outcome = await sectionAllocationService.applySectionAllocation(previewResult);
      showToast({
        title: 'Section Reallocation Applied',
        description: `Successfully reallocated ${outcome.appliedCount} students. ${outcome.unallocatedCount} moved to Unallocated roster.`,
        type: 'success',
      });
      setIsConfirmModalOpen(false);
      // Refresh preview to show updated status
      if (csvRawText) {
        analyzeCSV(csvRawText, selectedSemesterId);
      }
      if (onFinished) onFinished();
    } catch (err: any) {
      showToast({ title: 'Application Failed', description: err.message, type: 'danger' });
    } finally {
      setIsApplying(false);
    }
  };

  const filteredRows = (previewResult?.rows || []).filter(row => {
    if (activeTab === 'all') return true;
    if (activeTab === 'change') return row.status === 'Change';
    if (activeTab === 'unallocated') return row.status === 'Unallocated';
    if (activeTab === 'rejected') return row.status === 'REJECTED';
    return true;
  });

  const selectedSem = semesters.find(s => s.id === selectedSemesterId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Section Reallocation Import
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Import student section allocations from CSV with validation, unallocated detection, and confirmation
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadSample}
            className="text-xs gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" /> Load Sample CSV
          </Button>
        </div>
      </div>

      {/* Target Semester Configuration */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              1. Select Target Semester
            </span>
            <p className="text-xs text-slate-500">
              Allocations are strictly scoped to students and sections within the designated semester.
            </p>
          </div>

          <div className="w-full sm:w-64">
            {semesterLoadError ? (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {semesterLoadError}
              </div>
            ) : (
              <Select
                value={selectedSemesterId}
                onChange={e => handleSemesterChange(e.target.value)}
                options={semesters.map(s => ({ value: s.id, label: s.name }))}
                disabled={semesters.length === 0}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Drag & Drop Upload Zone */}
      <Card>
        <CardContent className="p-6">
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
              dragActive
                ? 'border-indigo-500 bg-indigo-50/50'
                : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
              <UploadCloud className="w-6 h-6" />
            </div>

            <h4 className="text-sm font-bold text-slate-900">
              {file ? file.name : 'Choose CSV file or drag and drop here'}
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              Required header format: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-indigo-700">student_id, student_name, section</code>
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-400">
              <span>UTF-8 encoded</span> • <span>Max 10MB</span> • <span>Does not create new students</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Analysis Preview & Metrics */}
      {previewResult && previewResult.isValidFormat && (
        <div className="space-y-6">
          {/* Summary KPI Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Total Processed</span>
              <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">{previewResult.summary.totalRows}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-200 shadow-xs">
              <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider block">Section Changes</span>
              <span className="text-xl font-bold font-mono text-indigo-800 mt-0.5 block">{previewResult.summary.changedCount}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
              <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider block">No Change</span>
              <span className="text-xl font-bold font-mono text-slate-700 mt-0.5 block">{previewResult.summary.unchangedCount}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 shadow-xs">
              <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider block">Unallocated</span>
              <span className="text-xl font-bold font-mono text-amber-800 mt-0.5 block">{previewResult.summary.unallocatedCount}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 shadow-xs">
              <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider block">Rejected</span>
              <span className="text-xl font-bold font-mono text-rose-800 mt-0.5 block">{previewResult.summary.rejectedCount}</span>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-xs flex flex-col justify-between">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">Valid Rows</span>
              <span className="text-xl font-bold font-mono text-emerald-800 mt-0.5 block">{previewResult.summary.validRows}</span>
            </div>
          </div>

          {/* Allocation Preview Table Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base">Allocation Preview Matrix</CardTitle>
                  <CardDescription>
                    Review detected changes, unallocated students, and rejected records before confirmation
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsConfirmModalOpen(true)}
                    disabled={isApplying || previewResult.summary.validRows === 0}
                    className="gap-1.5 font-bold shadow-sm"
                  >
                    <Check className="w-4 h-4" /> Confirm & Apply Allocations
                  </Button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-2 pt-3 border-t border-slate-100 mt-3 text-xs">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  All Rows ({previewResult.rows.length})
                </button>
                <button
                  onClick={() => setActiveTab('change')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'change'
                      ? 'bg-indigo-600 text-white'
                      : 'text-indigo-600 hover:bg-indigo-50'
                  }`}
                >
                  Section Changes ({previewResult.summary.changedCount})
                </button>
                <button
                  onClick={() => setActiveTab('unallocated')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'unallocated'
                      ? 'bg-amber-600 text-white'
                      : 'text-amber-600 hover:bg-amber-50'
                  }`}
                >
                  Becoming Unallocated ({previewResult.summary.unallocatedCount})
                </button>
                <button
                  onClick={() => setActiveTab('rejected')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    activeTab === 'rejected'
                      ? 'bg-rose-600 text-white'
                      : 'text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  Rejected / Conflicts ({previewResult.summary.rejectedCount})
                </button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-5 py-3 w-16">Row</th>
                      <th className="px-5 py-3">Student ID</th>
                      <th className="px-5 py-3">Student Name</th>
                      <th className="px-5 py-3">Current Section</th>
                      <th className="px-5 py-3">New Section</th>
                      <th className="px-5 py-3 text-center">Status</th>
                      <th className="px-5 py-3">Reason / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 text-slate-400 font-mono">{row.rowNumber}</td>
                        <td className="px-5 py-3 font-mono font-bold text-slate-900">{row.studentId}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{row.studentName}</td>
                        <td className="px-5 py-3">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono font-semibold">
                            {row.currentSectionName}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`px-2 py-0.5 rounded font-mono font-bold ${
                              row.status === 'Change'
                                ? 'bg-indigo-100 text-indigo-800'
                                : row.status === 'Unallocated'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {row.newSectionName}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <Badge
                            variant={
                              row.status === 'Change'
                                ? 'info'
                                : row.status === 'No Change'
                                ? 'default'
                                : row.status === 'Unallocated'
                                ? 'warning'
                                : 'danger'
                            }
                          >
                            {row.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-500 max-w-xs truncate">
                          {row.reason || (row.status === 'Change' ? 'Will be moved to new section' : 'Section unchanged')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="Confirm Section Reallocation"
        description="Verify the scope of changes before updating institutional student section allocations."
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Target Semester:</span>
              <span className="font-bold text-slate-900">{selectedSem?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Total Valid Changes:</span>
              <span className="font-bold text-indigo-700 font-mono">
                {previewResult?.summary.changedCount} students
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Unallocated Transition:</span>
              <span className="font-bold text-amber-700 font-mono">
                {previewResult?.summary.unallocatedCount} students
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Applying this import will immediately update the enrolled section assignments for all matched students in the system. Timetables and roll call rosters will reflect these section transfers.
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsConfirmModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={isApplying}
              onClick={handleCommitAllocation}
              className="font-bold"
            >
              Apply Allocation Changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
