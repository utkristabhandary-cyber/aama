// @vitest-environment jsdom
/**
 * Camera scanner regression tests.
 *
 * These run in jsdom with a CONTROLLED/FAKE MediaStream — they prove the wiring
 * (state machine → getUserMedia → video.srcObject → play → live/error UI →
 * stream cleanup → restart) but are NOT physical-camera verification. See
 * docs/CAMERA_SCANNER_AUDIT_REPORT.md for the honest verification matrix.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { StudentQRScannerView, cameraErrorMessage } from './StudentQRScannerView';

// React 19 requires this flag for `act()` to actually flush work.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../services/attendanceService', () => ({
  attendanceService: {
    checkInWithQR: vi.fn(),
  },
}));

type FakeTrack = { kind: string; readyState: string; stop: ReturnType<typeof vi.fn> };
type FakeStream = { getTracks: () => FakeTrack[]; getVideoTracks: () => FakeTrack[] };

const makeTrack = (): FakeTrack => ({ kind: 'video', readyState: 'live', stop: vi.fn() });
const makeStream = (tracks: FakeTrack[] = [makeTrack()]): FakeStream & MediaStream =>
  ({ getTracks: () => tracks, getVideoTracks: () => tracks }) as unknown as FakeStream & MediaStream;

let getUserMediaMock: ReturnType<typeof vi.fn>;
let srcObjectSpy: (value: unknown) => void;
let playMock: ReturnType<typeof vi.fn>;

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.includes(label),
  );
  if (!button) throw new Error(`Button "${label}" not found. DOM: ${root.innerHTML.slice(0, 400)}`);
  return button;
}

describe('cameraErrorMessage', () => {
  it('maps each getUserMedia failure to an honest, distinct message', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/permission was denied/i);
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/no camera device/i);
    expect(cameraErrorMessage({ name: 'NotReadableError' })).toMatch(/in use by another application/i);
    expect(cameraErrorMessage({ name: 'OverconstrainedError' })).toMatch(/no camera matches/i);
    expect(cameraErrorMessage({ name: 'SecurityError' })).toMatch(/https/i);
    expect(cameraErrorMessage({ name: 'InsecureContext' })).toMatch(/https/i);
    expect(cameraErrorMessage({ name: 'Bogus' })).toMatch(/camera access failed/i);
    expect(
      cameraErrorMessage(Object.assign(new Error('Something went wrong'), { name: 'Bogus' })),
    ).toBe('Something went wrong');
  });
});

describe('StudentQRScannerView camera lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let unmount: () => void;

  const renderView = () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    try {
      act(() => root.render(<StudentQRScannerView />));
    } catch (err) {
      console.error('RENDER FAILED:', err); // eslint-disable-line no-console
      throw err;
    }
    unmount = () => {
      act(() => root.unmount());
      host.remove();
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    getUserMediaMock = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    });

    srcObjectSpy = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      get(this: HTMLMediaElement) {
        return (this as unknown as Record<string, unknown>).__testSrc ?? null;
      },
      set(this: HTMLMediaElement, value: unknown) {
        (this as unknown as Record<string, unknown>).__testSrc = value;
        srcObjectSpy(value);
      },
    });

    playMock = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: playMock,
    });

    renderView();
  });

  afterEach(() => {
    unmount();
  });

  it('renders the idle viewfinder with no video element', () => {
    expect(host.textContent).toContain('Camera Viewfinder Idle');
    expect(host.querySelector('video')).toBeNull();
    expect(host.textContent).toContain('Activate Device Camera');
  });

  it('attaches the granted MediaStream to the video element and shows a live preview', async () => {
    const stream = makeStream();
    getUserMediaMock.mockResolvedValueOnce(stream);

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
    });

    const video = host.querySelector('video');
    expect(video).not.toBeNull();
    expect(srcObjectSpy).toHaveBeenCalledWith(stream);
    expect(playMock).toHaveBeenCalledTimes(1);

    expect(host.textContent).toContain('Live Preview');
    expect(host.textContent).toContain('Stop Camera');
    expect(host.textContent).not.toContain('Camera Viewfinder Idle');
  });

  it('distinguishes permission denial as an honest error state', async () => {
    getUserMediaMock.mockRejectedValueOnce({ name: 'NotAllowedError' });

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Camera Unavailable');
    expect(host.textContent).toContain('permission was denied');
    expect(host.textContent).toContain('Retry Camera');
    expect(host.textContent).not.toContain('Live Preview');
  });

  it('reports a missing camera device', async () => {
    getUserMediaMock.mockRejectedValueOnce({ name: 'NotFoundError' });

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(host.textContent).toMatch(/no camera device/i);
  });

  it('reports a camera that is busy in another application', async () => {
    getUserMediaMock.mockRejectedValueOnce({ name: 'NotReadableError' });

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(host.textContent).toMatch(/in use by another application/i);
  });

  it('handles a blocked autoplay by stopping the stream and showing an error', async () => {
    const stream = makeStream();
    getUserMediaMock.mockResolvedValueOnce(stream);
    playMock.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })));

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Camera Unavailable');
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
    expect(host.querySelector('video')?.srcObject).toBeNull();
  });

  it('never marks the camera active while no stream has been delivered', async () => {
    getUserMediaMock.mockImplementationOnce(() => new Promise<MediaStream>(() => undefined));

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Initializing camera');
    expect(srcObjectSpy).not.toHaveBeenCalled();
  });

  it('stops every track and the video source on explicit stop, then restart works', async () => {
    const stream1 = makeStream();
    const stream2 = makeStream();
    getUserMediaMock.mockResolvedValueOnce(stream1).mockResolvedValueOnce(stream2);

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Live Preview');

    await act(async () => {
      findButton(host, 'Stop Camera').click();
    });
    expect(stream1.getTracks()[0].stop).toHaveBeenCalled();
    expect(host.querySelector('video')).toBeNull();
    expect(host.textContent).toContain('Camera Viewfinder Idle');

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
    expect(srcObjectSpy).toHaveBeenLastCalledWith(stream2);
    expect(host.textContent).toContain('Live Preview');
  });

  it('cleans up the live stream when the component unmounts', async () => {
    const stream = makeStream();
    getUserMediaMock.mockResolvedValueOnce(stream);

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Live Preview');

    act(() => root.unmount());
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
    expect(srcObjectSpy).toHaveBeenLastCalledWith(null);
  });

  it('cleans up a stream that resolved after the component unmounted (orphan case)', async () => {
    const stream = makeStream();
    let release: () => void = () => undefined;
    getUserMediaMock.mockImplementationOnce(
      () =>
        new Promise<MediaStream>(resolve => {
          release = () => resolve(stream);
        }),
    );

    await act(async () => {
      findButton(host, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    act(() => root.unmount());
    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
    expect(srcObjectSpy).not.toHaveBeenCalled();
  });

  it('guards against double activation while a request is pending', async () => {
    getUserMediaMock.mockImplementationOnce(() => new Promise<MediaStream>(() => undefined));

    await act(async () => {
      const button = findButton(host, 'Activate Device Camera');
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Initializing camera');
  });
});

describe('StudentQRScannerView insecure context', () => {
  let restoreSecure: () => void;

  beforeAll(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    restoreSecure = () => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    };
  });

  afterAll(() => restoreSecure?.());

  it('explains that HTTPS (or localhost) is required instead of pretending to activate', async () => {
    const getUserMediaSpy = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: getUserMediaSpy },
    });

    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    const rootEl = createRoot(hostEl);
    act(() => rootEl.render(<StudentQRScannerView />));

    await act(async () => {
      findButton(hostEl, 'Activate Device Camera').click();
      await Promise.resolve();
    });

    expect(getUserMediaSpy).not.toHaveBeenCalled();
    expect(hostEl.textContent).toContain('Camera Unavailable');
    expect(hostEl.textContent).toMatch(/https/i);

    act(() => rootEl.unmount());
    hostEl.remove();
  });
});