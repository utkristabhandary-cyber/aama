/**
 * Template download + server-export controls for the import flows (Phase H).
 *
 * The workbook structure is 100% server-generated (headers-only template +
 * contract sheet, or real rows for the export). This component only triggers
 * the authenticated download and reports success/failure via toasts; it never
 * invents column layouts or data.
 */
import React, { useState } from 'react';
import { Download, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  downloadImportFile,
  type ImportExportKind,
} from '../../services/importExportService';
import { TEMPLATE_CONTRACTS } from './templateContract';

interface ImportTemplateCardProps {
  kind: ImportExportKind;
  /** Render an export-only control (list views) instead of the full card. */
  exportOnly?: boolean;
}

export const ImportTemplateCard: React.FC<ImportTemplateCardProps> = ({
  kind,
  exportOnly = false,
}) => {
  const contract = TEMPLATE_CONTRACTS[kind];
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState<'template' | 'export' | null>(null);

  const runDownload = async (
    action: 'template' | 'export',
    fallback: string,
  ) => {
    if (downloading) return;
    setDownloading(action);
    try {
      const filename = await downloadImportFile(kind, action, fallback);
      showToast({
        title: action === 'template' ? 'Template downloaded' : 'Export downloaded',
        message: filename,
        type: 'info',
      });
    } catch (err) {
      showToast({
        title: 'Download failed',
        message:
          err instanceof Error && err.message
            ? err.message
            : 'The server could not prepare this workbook.',
        type: 'error',
      });
    } finally {
      setDownloading(null);
    }
  };

  if (exportOnly) {
    return (
      <Button
        variant="outline"
        size="sm"
        leftIcon={<Download className="w-4 h-4" />}
        isLoading={downloading === 'export'}
        onClick={() => runDownload('export', contract.exportFilename)}
      >
        Export .xlsx
      </Button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{contract.label}</p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-xl">{contract.guidance}</p>
          </div>
        </div>
        <Badge variant="outline" className="text-slate-500 shrink-0">
          {contract.required.join(' • ')}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Download className="w-4 h-4" />}
          isLoading={downloading === 'template'}
          onClick={() => runDownload('template', contract.templateFilename)}
        >
          Download Template
        </Button>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Download className="w-4 h-4" />}
          isLoading={downloading === 'export'}
          onClick={() => runDownload('export', contract.exportFilename)}
        >
          Download Export
        </Button>
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 ml-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          Generated server-side; downloads are admin-only.
        </span>
      </div>
    </div>
  );
};