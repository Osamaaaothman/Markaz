// A short two-note chime for "something new arrived from Claude (MCP)". Made with the Web Audio API,
// so there is no sound file to ship or license. On by default; the bell has a switch to turn it off,
// kept per browser (like the interface style), so every storage call is wrapped.

const STORAGE_KEY = "markaz-mcp-chime";
const VOLUME = 0.12;

let context: AudioContext | null = null;

export function readChimePreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeChimePreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

export function playChime(): void {
  if (!readChimePreference()) return;
  try {
    context ??= new AudioContext();
    const ctx = context;
    // Browsers keep audio suspended until the person has interacted with the page once.
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.01;
    for (const [i, frequency] of [880, 1318.5].entries()) {
      const at = start + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(VOLUME, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    }
  } catch {
    // no audio available: the badge still shows
  }
}

// When the user last opened the bell, per user and browser; items newer than this are unseen.
export function readLastSeen(userId: string): string | null {
  try {
    return window.localStorage.getItem(`markaz-mcp-seen:${userId}`);
  } catch {
    return null;
  }
}

export function writeLastSeen(userId: string, iso: string): void {
  try {
    window.localStorage.setItem(`markaz-mcp-seen:${userId}`, iso);
  } catch {
    // storage blocked
  }
}
