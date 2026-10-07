import { create } from "zustand";

export type ExportJobState = "running" | "done" | "error";

export interface ExportJob {
  readonly id: number;
  readonly filename: string;
  readonly state: ExportJobState;
  // Share of the file received so far, 0-100. null while the server is still building it and has not said
  // how big the file will be (a PDF is rendered before the first byte is sent).
  readonly percent: number | null;
}

interface ExportState {
  jobs: readonly ExportJob[];
  start: (filename: string) => number;
  progress: (id: number, percent: number | null) => void;
  finish: (id: number) => void;
  fail: (id: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const patch = (jobs: readonly ExportJob[], id: number, change: Partial<ExportJob>): ExportJob[] => jobs.map((job) => (job.id === id ? { ...job, ...change } : job));

// Download progress shown to the user while a report or file export runs. Local UI state only; nothing here
// is persisted. A finished job removes itself after a few seconds, a failed one stays until dismissed.
export const useExportStore = create<ExportState>((set, get) => ({
  jobs: [],
  start: (filename) => {
    const id = nextId++;
    set((state) => ({ jobs: [...state.jobs, { id, filename, state: "running", percent: null }] }));
    return id;
  },
  progress: (id, percent) => set((state) => ({ jobs: patch(state.jobs, id, { percent }) })),
  finish: (id) => {
    set((state) => ({ jobs: patch(state.jobs, id, { state: "done", percent: 100 }) }));
    window.setTimeout(() => get().dismiss(id), 3500);
  },
  fail: (id) => set((state) => ({ jobs: patch(state.jobs, id, { state: "error" }) })),
  dismiss: (id) => set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) })),
}));
