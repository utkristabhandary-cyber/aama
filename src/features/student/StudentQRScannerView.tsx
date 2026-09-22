import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { useToast } from '../../context/ToastContext';
import { attendanceService } from '../../services/attendanceService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import {
  QrCode,
  Camera,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  UsersRound,
  Square,
} from 'lucide-react';

type SubmitOutcome = {
  success: boolean;
  message: string;
  alreadyRecorded?: boolean;
};

type CameraState = 'idle' | 'initializing' | 'active' | 'error';

// A bare 8-char token cannot be checked in on its own: the server needs the
// full payload (which carries the attendance-session id) to resolve the class.
const BARE_TOKEN_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/i;
const FULL_PAYLOAD_RE = /^AAMSQR1\|\d+\|[A-Z0-9-]+\s*$/i;

/**
 * Map a getUserMedia / play() failure to an honest, user-facing message.
 *
 * The message is chosen from the actual failure name the spec mandates — the UI
 * must distinguish camera types rather than paste a stack trace or a generic
 * "sandbox" excuse.
 */
export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : String((err as { name?: string })?.name || '');
  switch (name) {
    case 'NotAllowedError':
      return 'Camera permission was denied. Allow camera access in your browser settings, then press Retry.';
    case 'NotFoundError':
      return 'No camera device was detected on this device. Check your camera and press Retry.';
    case 'NotReadableError':
      return 'The camera is currently in use by another application. Close it and press Retry.';
    case 'OverconstrainedError':
      return 'No camera matches the requested video mode. Try a front/back-facing device or a different browser.';
    case 'SecurityError':
    case 'InsecureContext':
      return 'Camera access requires HTTPS (or localhost). Serve AAMS over HTTPS to use the scanner.';
    default:
      return (
        (err instanceof Error && err.message) ||
        'Camera access failed. Try again or enter the code manually below.'
      );
  }
}

function stopTracks(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
}

/**
 * Student QR scanner.
 *
 * Camera lifecycle: IDLE → INITIALIZING → ACTIVE (video element owns a live
 * MediaStream) or ERROR (honest message). The <video> element is ALWAYS mounted
 * once initialization starts so `videoRef.current` exists when the
 * `getUserMedia` promise resolves — a stream is only attached to a real element.
 *
 * The camera decodes the full payload (`AAMSQR1|<session id>|<TOKEN>`) shown on
 * the classroom screen and POSTs it to the server-authoritative check-in
 * endpoint. Identity ALWAYS comes from the authenticated session on the backend
 * (`request.user.student_profile`) — the client ships no studentId and never
 * validates the token itself. The web browser honestly reports `unavailable`
 * for network verification: a browser cannot attest a BSSID.
 */
export const StudentQRScannerView: React.FC<{
  onAttendanceSuccess?: () => void;
}> = ({ onAttendanceSuccess }) => {
  const { showToast } = useToast();

  const [tokenInput, setTokenInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitOutcome | null>(null);

  // Camera state machine
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  const releaseStream = () => {
    // `attachedVideoRef` is a manual store (never used as a React ref prop), so
    // it stays valid during the unmount cleanup even though `videoRef.current`
    // has already been detached by React.
    const video = attachedVideoRef.current ?? videoRef.current;
    if (video) {
      const attached = video.srcObject;
      if (attached) {
        stopTracks(attached as MediaStream);
        video.srcObject = null;
      }
    }
    // Also stop any stream captured by startCamera that is still waiting to be
    // attached (the orphaned-stream case).
    if (streamRef.current) stopTracks(streamRef.current);
    streamRef.current = null;
    attachedVideoRef.current = null;
  };

  const startCamera = async () => {
    if (startingRef.current || cameraState === 'initializing') return;
    startingRef.current = true;
    setCameraError(null);
    setScanStatus(null);
    setCameraState('initializing');

    let stream: MediaStream | null = null;
    try {
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        const err = new Error('Camera access requires HTTPS (or localhost).');
        err.name = 'InsecureContext';
        throw err;
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('Your browser does not support camera access.');
      }

      // `facingMode` is aspirational (`ideal`), never a hard constraint: a rear
      // camera is preferred on phones but must not prevent a laptop webcam from
      // initializing (a hard `facingMode: 'environment'` throws
      // OverconstrainedError on devices that expose no such camera).
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;

      // Unmounted while awaiting the user/media prompt: never let the granted
      // stream leak (camera LED stays on with no UI to stop it).
      if (!mountedRef.current) {
        stopTracks(stream);
        streamRef.current = null;
        return;
      }

      const video = videoRef.current;
      if (!video) {
        throw new Error('The camera view was not ready. Try again.');
      }

      attachedVideoRef.current = video;
      video.srcObject = stream;
      await video.play();

      if (!mountedRef.current) return;
      setCameraState('active');
    } catch (err) {
      stopTracks(stream);
      streamRef.current = null;
      const currentVideo = videoRef.current;
      if (currentVideo && currentVideo.srcObject === stream) {
        currentVideo.srcObject = null;
      }
      attachedVideoRef.current = null;
      if (mountedRef.current) {
        setCameraError(cameraErrorMessage(err));
        setCameraState('error');
      }
    } finally {
      startingRef.current = false;
    }
  };

  const stopCamera = () => {
    releaseStream();
    setScanStatus(null);
    setCameraState('idle');
  };

  // Full cleanup on unmount: every track stops so the browser camera indicator
  // (and the underlying OS resource) is released immediately.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuously decode the camera frames with jsQR and submit the encoded payload
  useEffect(() => {
    if (cameraState !== 'active') return;

    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const width = video.videoWidth;
        const height = video.videoHeight;

        if (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });

          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            });

            if (code && code.data) {
              const now = Date.now();
              const last = lastScannedRef.current;
              if (!last || last.value !== code.data || now - last.at > 7000) {
                lastScannedRef.current = { value: code.data, at: now };
                setScanStatus('QR Code detected — verifying attendance with the server...');
                void handleSubmitToken(code.data);
              }
            }
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState]);

  const handleSubmitToken = async (tokenToSubmit?: string) => {
    const raw = (tokenToSubmit || tokenInput).trim();
    if (!raw) {
      showToast({ title: 'Code Required', description: 'Scan the QR code or paste the full code shown on screen.', type: 'warning' });
      return;
    }
    if (BARE_TOKEN_RE.test(raw)) {
      showToast({
        title: 'Enter the Full Code',
        description:
          'A bare token cannot be resolved to a class. Scan the QR with your camera, or paste the full code the teacher shows on screen (e.g. AAMSQR1|42|8F3K-29PA).',
        type: 'warning',
      });
      return;
    }
    if (!FULL_PAYLOAD_RE.test(raw)) {
      showToast({
        title: 'Unrecognized Code',
        description: 'That does not look like an AAMS attendance QR code. Scan the classroom screen directly.',
        type: 'warning',
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);
    setScanStatus('Submitting secure check-in...');

    try {
      const result = await attendanceService.checkInWithQR(raw);
      const outcome: SubmitOutcome = {
        success: !result.alreadyRecorded,
        alreadyRecorded: result.alreadyRecorded,
        message: result.detail,
      };
      setSubmitResult(outcome);

      showToast({
        title: result.alreadyRecorded ? 'Already Records Present' : 'Attendance Verified',
        description: result.detail,
        type: result.alreadyRecorded ? 'info' : 'success',
      });
      setTokenInput('');
      if (onAttendanceSuccess) onAttendanceSuccess();
    } catch (err) {
      const message = (err as Error).message || 'The server could not record your check-in.';
      setSubmitResult({ success: false, message });
      showToast({ title: 'Check-in Failed', description: message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
      setScanStatus(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Scan Attendance QR</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Scan the faculty classroom screen or enter the full rotating code it displays
        </p>
      </div>

      {/* Server-authoritative explainer */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <span>
          Your check-in is verified by the server against the live classroom session. Your identity comes
          from your login — the code only proves you scanned the classroom screen.
        </span>
      </div>

      {/* Result state */}
      {submitResult && (
        <div
          className={`p-5 rounded-2xl border flex items-start gap-4 ${
            submitResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : submitResult.alreadyRecorded
              ? 'bg-blue-50 border-blue-200 text-blue-950'
              : 'bg-rose-50 border-rose-200 text-rose-950'
          }`}
        >
          <div className="p-2 rounded-xl shrink-0">
            {submitResult.success ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            ) : (
              <AlertCircle className="w-6 h-6 text-rose-600" />
            )}
          </div>
          <div>
            <h4 className="font-bold text-sm">
              {submitResult.success
                ? 'Roll Call Verified!'
                : submitResult.alreadyRecorded
                ? 'Already Recorded'
                : 'Check-in Not Recorded'}
            </h4>
            <p className="text-xs opacity-80 mt-1 leading-relaxed">{submitResult.message}</p>
            {submitResult.success && (
              <div className="mt-2.5 flex items-center gap-2 text-[11px] text-emerald-700 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" /> Logged to your academic record by the server
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scanner & Manual Entry Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="w-4 h-4 text-indigo-600" /> Camera Scanner Viewfinder
          </CardTitle>
          <CardDescription>
            Point your device camera at the attendance display board in your classroom
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Camera Stream / Reticle */}
          <div className="relative aspect-video w-full max-w-md mx-auto rounded-2xl overflow-hidden bg-slate-900 flex flex-col items-center justify-center border-2 border-dashed border-slate-700 shadow-inner">
            <canvas ref={canvasRef} className="hidden" />

            {/* The video element is mounted as soon as initialization begins, so
                the ref is always valid when getUserMedia resolves. Overlays cover
                the (streamless) element until a real stream is attached. */}
            {cameraState !== 'idle' && (
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className="w-full h-full object-cover"
              />
            )}

            {cameraState === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
                <QrCode className="w-12 h-12 mx-auto text-slate-600" />
                <p className="text-xs">Camera Viewfinder Idle</p>
                <Button size="sm" variant="outline" onClick={startCamera} className="text-xs gap-1.5 mt-2">
                  <Camera className="w-3.5 h-3.5" /> Activate Device Camera
                </Button>
              </div>
            )}

            {cameraState === 'initializing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
                <RefreshCw className="w-10 h-10 mx-auto text-indigo-500 animate-spin" />
                <p className="text-xs">Initializing camera...</p>
              </div>
            )}

            {cameraState === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
                <AlertCircle className="w-10 h-10 mx-auto text-rose-500" />
                <p className="text-xs font-semibold text-slate-300">Camera Unavailable</p>
                {cameraError && (
                  <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">{cameraError}</p>
                )}
                <Button size="sm" variant="outline" onClick={startCamera} className="text-xs gap-1.5 mt-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Retry Camera
                </Button>
              </div>
            )}

            {cameraState === 'active' && (
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  Live Preview
                </span>
              </div>
            )}

            {/* Target Crosshairs (only over a live feed) */}
            {cameraState === 'active' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-44 h-44 border-2 border-indigo-400/80 rounded-xl relative shadow-lg">
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-indigo-500 rounded-tl" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-indigo-500 rounded-tr" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-indigo-500 rounded-bl" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-indigo-500 rounded-br" />
                  <div className="w-full h-0.5 bg-indigo-500/50 absolute top-1/2 -translate-y-1/2 animate-pulse" />
                </div>
              </div>
            )}
          </div>

          {cameraState === 'active' && (
            <div className="flex justify-center">
              <Button size="sm" variant="outline" onClick={stopCamera} className="gap-1.5 text-xs">
                <Square className="w-3.5 h-3.5" /> Stop Camera
              </Button>
            </div>
          )}

          {scanStatus && cameraState === 'active' && (
            <p className="text-[11px] text-emerald-700 text-center font-semibold">
              {scanStatus}
            </p>
          )}

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-3 text-xs uppercase font-bold text-slate-400 tracking-wider shrink-0">
              or enter the code manually
            </span>
          </div>

          {/* Manual Full-Payload Entry Form */}
          <div className="max-w-md mx-auto space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Full Classroom Code
              </label>
              <div className="flex gap-2">
                <Input
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value.toUpperCase())}
                  placeholder="AAMSQR1|42|8F3K-29PA"
                  className="font-mono text-center tracking-wide text-sm uppercase font-bold"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  onClick={() => handleSubmitToken()}
                  disabled={isSubmitting || !tokenInput.trim()}
                  className="gap-1.5 whitespace-nowrap"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>
                      Submit <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              Copy the full code from the classroom screen — e.g. <span className="font-mono">AAMSQR1|42|8F3K-29PA</span>. The
              token inside refreshes automatically every 15 seconds on your teacher's screen.
            </p>
          </div>

          {/* Status row */}
          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
            <UsersRound className="w-3.5 h-3.5" />
            The server records each check-in against your verified identity only.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};