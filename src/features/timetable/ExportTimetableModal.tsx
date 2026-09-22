import React, { useState } from 'react';
import { TimetableSlot, Semester } from '../../types';
import { buildTimetableCSV } from './timetableExport';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Download, FileSpreadsheet } from 'lucide-react';

interface ExportTimetableModalProps {
  isOpen: boolean;
  onClose: () => void;
  filteredSlots: TimetableSlot[];
  activeFilterSummary: string;
  semesters?: Semester[];
}

export const ExportTimetableModal: React.FC<ExportTimetableModalProps> = ({
  isOpen,
  onClose,
  filteredSlots,
  activeFilterSummary,
  semesters = [],
}) => {
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');
  const [isExporting, setIsExporting] = useState(false);

  const handleDownload = () => {
    setIsExporting(true);
    setTimeout(() => {
      const csvData = buildTimetableCSV(filteredSlots, semesters);
      const blob = new Blob(['\uFEFF' + csvData], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `AAMS_Timetable_Export_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setIsExporting(false);
      onClose();
    }, 400);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Timetable"
      description="Download current academic timetable schedule based on active view and filters."
    >
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
          <p className="font-semibold text-slate-700">Export Scope:</p>
          <div className="flex items-center justify-between text-slate-600">
            <span>Sessions to Export:</span>
            <span className="font-bold text-slate-900">{filteredSlots.length} sessions</span>
          </div>
          <div className="flex items-center justify-between text-slate-600">
            <span>Active Filter:</span>
            <span className="font-medium text-slate-800">{activeFilterSummary}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-2">Select Export Format</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setFormat('xlsx')}
              className={`p-3 rounded-xl border text-left flex items-start space-x-3 transition ${
                format === 'xlsx'
                  ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-slate-900">Excel-Compatible CSV</p>
                <p className="text-[11px] text-slate-500">
                  UTF-8 delimited file that opens directly in Microsoft Excel
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFormat('csv')}
              className={`p-3 rounded-xl border text-left flex items-start space-x-3 transition ${
                format === 'csv'
                  ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <Download className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-slate-900">Standard CSV (.csv)</p>
                <p className="text-[11px] text-slate-500">Universal comma-separated spreadsheet data</p>
              </div>
            </button>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-3 border-t border-slate-200">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDownload} isLoading={isExporting}>
            <Download className="w-4 h-4 mr-1.5" /> Download Export
          </Button>
        </div>
      </div>
    </Modal>
  );
};