import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PrimeProvider } from "../shared/prime/PrimeProvider";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "../shared/api/query-client";
import { FeedbackToast } from "../shared/ui/FeedbackToast";

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <PrimeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
        <FeedbackToast />
      </QueryClientProvider>
    </PrimeProvider>
  );
}
