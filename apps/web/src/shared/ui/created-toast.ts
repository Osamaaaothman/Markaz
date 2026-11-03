import { create } from "zustand";

// A "saved successfully" message that outlives the screen it was raised on: a record that has a details screen opens
// that screen straight away, and the success message is shown over it (see CreatedDialog and CreatedToast).
export interface CreatedNotice {
  readonly id: number;
  readonly title: string;
  readonly headline: string | undefined;
}

interface CreatedToastState {
  notice: CreatedNotice | null;
  show: (title: string, headline: string | undefined) => void;
}

let counter = 0;

export const useCreatedToast = create<CreatedToastState>((set) => ({
  notice: null,
  show: (title, headline) => set({ notice: { id: ++counter, title, headline } }),
}));
