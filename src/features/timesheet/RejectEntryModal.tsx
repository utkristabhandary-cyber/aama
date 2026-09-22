import React, { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ApiTimesheetEntry } from '../../types/api';

export interface RejectEntryModalProps {
  isOpen: boolean;
  entry: ApiTimesheetEntry | null;
  submitting: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}

/** Collect the mandatory rejection reason for a submitted entry. */
export const RejectEntryModal: React.FC<RejectEntryModalProps> = ({
  isOpen,
  entry,
  submitting,
  onClose,
  onReject,
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError('');
    }
  }, [isOpen]);

  const handleReject = () => {
    if (!reason.trim()) {
      setError('A rejection reason is required for the teacher to correct the entry.');
      return;
    }
    onReject(reason.trim());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reject Timesheet Entry"
      maxWidth="md"
    >
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        Entry #{entry?.id} · {entry?.entry_date} ·{' '}
        {entry && entry.start_time ? `${entry.start_time.slice(0, 5)}–${entry.end_time.slice(0, 5)}` : ''}
        {entry?.status === 'submitted' && ' · Awaiting confirmation'}
      </p>

      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        Rejection Reason
      </label>
      <textarea
        value={reason}
        onChange={e => {
          setReason(e.target.value);
          if (error) setError('');
        }}
        rows={4}
        maxLength={500}
        placeholder="e.g. Overlaps with another logged entry — please adjust the time range."
        className={`w-full bg-white text-slate-900 text-sm rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none py-2 px-3 ${
          error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300'
        }`}
      />
      {error && <p className="text-xs text-rose-600 mt-1 font-medium">{error}</p>}
      <p className="text-xs text-slate-400 mt-1">
        The reason is shown to the teacher; editing a rejected entry resets it to draft.
      </p>

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={handleReject} isLoading={submitting}>
          Reject Entry
        </Button>
      </div>
    </Modal>
  );
};