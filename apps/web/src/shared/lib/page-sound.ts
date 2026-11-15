// The paper sound of a section book opening: a real recording of a book page being flipped
// (public/sounds/page-flip.ogg, CC0 — see LICENSE.txt beside it). It is strictly opt-in: nothing here makes a
// sound until the person turns the toggle on, and the choice is a per-browser convenience (like the interface
// style), so every storage call is wrapped.

const STORAGE_KEY = "markaz-page-sound";
const SOUND_URL = "/sounds/page-flip.ogg";

// The whole clip is played: it is a single clean flip (about 0.6 s, paper from the first 40 ms, no thud and no
// lead-in — checked on the decoded samples). It is mastered loud (peak ~1.0), so it is turned down to a soft
// hover sound.
const VOLUME = 0.3;
const FADE_IN = 0.01;
const FADE_OUT = 0.08;

let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let lastPlayed = 0;
// The page turn that is sounding right now. Only one is ever audible: starting another cuts it short.
let current: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

const CUT_FADE = 0.05;

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSoundPreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the choice simply lasts for this visit
  }
}

async function load(): Promise<void> {
  if (!context || buffer) return;
  try {
    const response = await fetch(SOUND_URL);
    if (!response.ok) return;
    buffer = await context.decodeAudioData(await response.arrayBuffer());
  } catch {
    // no sound file or no decoder: the books simply stay silent
  }
}

// Browsers only allow audio after a click or key press, so the context is created (or resumed) from one:
// the toggle itself, or the first pointer press on the page when the preference was saved earlier. The
// recording is fetched once, here, so the first hover after that has no delay.
export async function unlockAudio(): Promise<void> {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    loading ??= load().finally(() => {
      if (!buffer) loading = null;
    });
    await loading;
  } catch {
    context = null;
    loading = null;
  }
}

// One page turn. Sweeping across the shelf must not pile sounds on top of each other, so a new turn first
// fades the one still sounding out over 50 ms (and starts just after), and nothing starts more often than
// every 200 ms.
export function playPaper(): void {
  if (!context || context.state !== "running" || !buffer) return;
  const now = performance.now();
  if (now - lastPlayed < 200) return;
  lastPlayed = now;

  const source = context.createBufferSource();
  source.buffer = buffer;

  const gain = context.createGain();
  const t0 = context.currentTime + (current ? CUT_FADE : 0);
  stopCurrent(context.currentTime);
  const seconds = buffer.duration;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(VOLUME, t0 + FADE_IN);
  gain.gain.setValueAtTime(VOLUME, t0 + seconds - FADE_OUT);
  gain.gain.linearRampToValueAtTime(0, t0 + seconds);

  source.connect(gain).connect(context.destination);
  source.onended = () => {
    if (current?.source === source) current = null;
  };
  current = { source, gain };
  source.start(t0);
}

function stopCurrent(at: number): void {
  if (!current) return;
  const { source, gain } = current;
  current = null;
  try {
    gain.gain.cancelScheduledValues(at);
    gain.gain.setValueAtTime(gain.gain.value, at);
    gain.gain.linearRampToValueAtTime(0, at + CUT_FADE);
    source.stop(at + CUT_FADE + 0.01);
  } catch {
    // it had already finished
  }
}
