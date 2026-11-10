import { create } from "zustand";
import type { FeedbackMessage } from "./feedback-policy";

interface Notice extends FeedbackMessage { readonly id: number }
interface FeedbackState {
  readonly notices: readonly Notice[];
  readonly notify: (message: FeedbackMessage) => void;
  readonly consume: (ids: readonly number[]) => void;
}

let nextId = 0;
export const useFeedbackStore = create<FeedbackState>((set) => ({
  notices: [],
  notify: (message) => set((state) => ({ notices: [...state.notices, { ...message, id: ++nextId }] })),
  consume: (ids) => set((state) => ({ notices: state.notices.filter((notice) => !ids.includes(notice.id)) })),
}));
