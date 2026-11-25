/**
 * SkillLoom MV3 Offscreen Document
 * Captures tab audio via Chromium `tabCapture` streamId while routing audio back to
 * speakers (`AudioContext`) so playback isn't muted, then encodes compact WebM Opus audio.
 */

interface ActiveRecording {
  videoId: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  audioCtx: AudioContext | null;
  sampleTimer: number | null;
  chunks: Blob[];
  startedAt: number;
  maxTimer: number | null;
  stopPromise: Promise<{
    videoId: string;
    audioDataUrl: string;
    durationSeconds: number;
    mimeType: string;
    hasAudibleAudio: boolean;
    byteLength: number;
  }>;
}

let currentRecording: ActiveRecording | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to encode audio recording.'));
    reader.readAsDataURL(blob);
  });
}

function cleanupStreams(
  stream: MediaStream,
  audioCtx: AudioContext | null,
  maxTimer: number | null,
  sampleTimer: number | null
) {
  if (maxTimer !== null) {
    window.clearTimeout(maxTimer);
  }
  if (sampleTimer !== null) {
    window.clearInterval(sampleTimer);
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore already-ended tracks
    }
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
  }
}

async function startTabAudioRecording(
  streamId: string,
  videoId: string,
  maxMs = 90000
): Promise<void> {
  if (currentRecording) {
    try {
      currentRecording.recorder.stop();
    } catch {
      // Ignore prior recorder errors
    }
    cleanupStreams(
      currentRecording.stream,
      currentRecording.audioCtx,
      currentRecording.maxTimer,
      currentRecording.sampleTimer
    );
    currentRecording = null;
  }

  const constraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as unknown as MediaTrackConstraints,
    video: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  // Route captured tab audio back to output so the user still hears the Reel while recording
  let audioCtx: AudioContext | null = null;
  let heardSignal = false;
  let sampleTimer: number | null = null;
  try {
    audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(() => {});
    }
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    source.connect(audioCtx.destination);
    const pcmBuf = new Uint8Array(analyser.frequencyBinCount);
    sampleTimer = window.setInterval(() => {
      if (heardSignal) return;
      analyser.getByteTimeDomainData(pcmBuf);
      for (let i = 0; i < pcmBuf.length; i++) {
        if (Math.abs(pcmBuf[i] - 128) >= 3) {
          heardSignal = true;
          break;
        }
      }
    }, 220);
  } catch {
    audioCtx = null;
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: 20000,
  });
  const chunks: Blob[] = [];
  const startedAt = Date.now();

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  let resolveStop!: (result: {
    videoId: string;
    audioDataUrl: string;
    durationSeconds: number;
    mimeType: string;
    hasAudibleAudio: boolean;
    byteLength: number;
  }) => void;
  const stopPromise = new Promise<{
    videoId: string;
    audioDataUrl: string;
    durationSeconds: number;
    mimeType: string;
    hasAudibleAudio: boolean;
    byteLength: number;
  }>((resolve) => {
    resolveStop = resolve;
  });

  let maxTimer: number | null = null;
  recorder.onstop = async () => {
    cleanupStreams(stream, audioCtx, maxTimer, sampleTimer);
    const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const hasAudibleAudio =
      (heardSignal && blob.size >= 4200) ||
      blob.size >= Math.max(4800, elapsedSec * 1200);
    const audioDataUrl = await blobToDataUrl(blob).catch(() => '');
    const payload = {
      videoId,
      audioDataUrl,
      durationSeconds: elapsedSec,
      mimeType: 'audio/webm',
      hasAudibleAudio,
      byteLength: blob.size,
    };
    currentRecording = null;
    resolveStop(payload);

    // Notify background in case auto-stop timer ended recording while popup was closed
    try {
      const runtime = (globalThis as {
        chrome?: { runtime?: { sendMessage?: (msg: unknown) => void } };
      }).chrome?.runtime;
      runtime?.sendMessage?.({
        type: 'OFFSCREEN_RECORDING_COMPLETE',
        payload,
      });
    } catch {
      // Best-effort notification
    }
  };

  maxTimer = window.setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop();
    }
  }, maxMs);

  currentRecording = {
    videoId,
    recorder,
    stream,
    audioCtx,
    sampleTimer,
    chunks,
    startedAt,
    maxTimer,
    stopPromise,
  };

  recorder.start(1000);
}

const chromeRuntime = (globalThis as {
  chrome?: {
    runtime?: {
      onMessage?: {
        addListener: (
          fn: (
            msg: {
              target?: string;
              type: string;
              streamId?: string;
              videoId?: string;
              maxMs?: number;
            },
            sender: unknown,
            sendResponse: (res: unknown) => void
          ) => boolean | void
        ) => void;
      };
    };
  };
}).chrome?.runtime;

chromeRuntime?.onMessage?.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  if (msg.type === 'OFFSCREEN_START_RECORDING' && msg.streamId && msg.videoId) {
    startTabAudioRecording(msg.streamId, msg.videoId, msg.maxMs || 90000)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to start tab audio capture.',
        })
      );
    return true;
  }

  if (msg.type === 'OFFSCREEN_STOP_RECORDING') {
    if (!currentRecording) {
      sendResponse({ ok: false, error: 'No active audio recording.' });
      return false;
    }
    const pending = currentRecording.stopPromise;
    if (currentRecording.recorder.state === 'recording') {
      currentRecording.recorder.stop();
    }
    pending
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to stop recording.',
        })
      );
    return true;
  }

  return false;
});
