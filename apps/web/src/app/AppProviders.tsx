import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PrimeReactProvider } from "primereact/api";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "../shared/api/query-client";

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <PrimeReactProvider value={{ ripple: true }}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    </PrimeReactProvider>
  );
}
