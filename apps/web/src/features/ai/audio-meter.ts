// Microphone level for the orb's "listening" state while dictating: RMS of the time-domain signal,
// smoothed, about 10 updates per second. Uses its own audio stream next to the browser's speech
// recognition; nothing is recorded or sent anywhere — only a number between 0 and 1 leaves this file.
export interface AudioMeter {
  stop(): void;
}

export async function startAudioMeter(onLevel: (level: number) => void): Promise<AudioMeter | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null; // permission refused or no microphone: the orb simply stays at level 0
  }
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  const context = new AudioCtx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let smooth = 0;
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    // Speech RMS is roughly 0.01–0.2; map it onto 0..1 and smooth so the orb does not jitter.
    const level = Math.min(1, rms * 6);
    smooth = smooth * 0.6 + level * 0.4;
    onLevel(Math.round(smooth * 100) / 100);
  }, 100);
  return {
    stop: () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
      onLevel(0);
    },
  };
}
