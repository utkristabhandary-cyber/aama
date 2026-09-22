import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { attendanceService } from '../../services/attendanceService';
import { ApiQRAttendanceSession } from '../../types/api';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { QrCode, Play, Square, RefreshCw, ShieldCheck, Users, AlertTriangle } from 'lucide-react';

export interface LiveQRPaneProps {
  attendanceSessionId: number;
  disabled?: boolean;
  onActiveChange?: (active: boolean) => void;
  onCheckedIn?: () => void;
}

/**
 * Teacher QR display.
 *
 * The payload to render (`AAMSQR1|<session id>|<TOKEN>`) ALWAYS comes from the
 * backend (`POST /attendance/qr/start/`); this component never generates or
 * verifies a token client-side. Rotation is server-side — when the live count
 * expires, the next `start` call rotates the token and a fresh payload is
 * rendered. Web browsers cannot attest a classroom BSSID, so this panel shows
 * the honest note that scans are recorded without network attestation.
 */
export const LiveQRPane: React.FC<LiveQRPaneProps> = ({
  attendanceSessionId,
  disabled = false,
  onActiveChange,
  onCheckedIn,
}) => {
  const { showToast } = useToast();
  const [qr, setQr] = useState<ApiQRAttendanceSession | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [qrImage, setQrImage] = useState('');
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const applyQR = useCallback(
    async (next: ApiQRAttendanceSession) => {
      setQr(next);
      setRemaining(next.expires_in_seconds);
      if (next.checked_in_count > 0) onCheckedIn?.();
      try {
        const png = await QRCode.toDataURL(next.payload, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        setQrImage(png);
      } catch {
        setQrImage('');
      }
    },
    [onCheckedIn],
  );

  const start = useCallback(async () => {
    if (disabled || !attendanceSessionId) return;
    setBusy(true);
    try {
      const next = await attendanceService.startQRSession(attendanceSessionId);
      await applyQR(next);
      startedRef.current = true;
      onActiveChange?.(true);
    } catch (err) {
      showToast({
        title: 'Could Not Start QR',
        description: (err as Error).message || 'The QR session could not be started.',
        type: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }, [disabled, attendanceSessionId, applyQR, onActiveChange, showToast]);

  const stop = useCallback(async () => {
    if (!qr) return;
    setBusy(true);
    try {
      await attendanceService.stopQRSession(qr.id);
      setQr(null);
      setQrImage('');
      startedRef.current = false;
      onActiveChange?.(false);
    } catch (err) {
      showToast({
        title: 'Could Not Stop QR',
        description: (err as Error).message || 'The QR session could not be stopped.',
        type: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }, [qr, onActiveChange, showToast]);

  // Auto-rotate when the live token expires (server side), and auto-start for
  // the freshly opened session the first time the pane is shown.
  useEffect(() => {
    if (startedRef.current) return;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceSessionId]);

  useEffect(() => {
    if (!qr || disabled) return;
    const timer = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          void start();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [qr, disabled, start]);

  // If the parent blocks the pane (session finalized), stop showing a live QR.
  useEffect(() => {
    if (disabled && qr) {
      setRemaining(0);
    }
  }, [disabled, qr]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <QrCode className="w-4 h-4 text-indigo-600" /> Live QR Roll Call
            </CardTitle>
            <CardDescription>
              Students scan the code below with their phone browser. This web-only build records scans
              without network attestation.
            </CardDescription>
          </div>
          {qr && (
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {remaining > 0 ? (
                <Badge variant="info" className="font-mono">
                  <RefreshCw className="w-3 h-3 mr-1" /> rotates in {remaining}s
                </Badge>
              ) : (
                <Badge variant="warning" className="font-mono">
                  rotating…
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {qr ? (
          <>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
              {/* Rendered QR */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm w-fit">
                {qrImage ? (
                  <img
                    src={qrImage}
                    alt={`Attendance QR code for session ${attendanceSessionId}`}
                    className="w-52 h-52"
                    width={208}
                    height={208}
                  />
                ) : (
                  <div className="w-52 h-52 flex items-center justify-center text-slate-300">
                    <QrCode className="w-16 h-16" />
                  </div>
                )}
              </div>

              <div className="space-y-3 w-full sm:w-auto">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Live Token
                  </span>
                  <span className="font-mono font-bold text-2xl text-slate-900 tracking-widest">
                    {qr.token}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Scanned Payload
                  </span>
                  <span className="font-mono text-[11px] text-slate-700 bg-slate-100 rounded-lg px-2 py-1 break-all">
                    {qr.payload}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Users className="w-4 h-4 text-emerald-600" />
                  <span>
                    Students checked in:{' '}
                    <strong className="font-mono text-slate-900">{qr.checked_in_count}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Server-issued: rotates every 15s, checked in by the backend
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={start} isLoading={busy} className="gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh Now
              </Button>
              <Button variant="danger" size="sm" onClick={stop} isLoading={busy} className="gap-1.5">
                <Square className="w-3.5 h-3.5" /> Stop QR
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {disabled && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
                <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-800 block">Session not available</span>
                  Open a valid class session above (or the session may already be
                  submitted) to broadcast the QR code.
                </div>
              </div>
            )}
            <Button variant="primary" onClick={start} isLoading={busy} className="gap-1.5 mx-auto">
              <Play className="w-4 h-4" /> Start QR Roll Call
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};