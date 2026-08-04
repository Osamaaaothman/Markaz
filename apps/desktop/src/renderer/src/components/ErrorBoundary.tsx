import { Component, type ReactNode } from "react";
import { FatalErrorScreen } from "./FatalErrorScreen";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// React error boundaries must be class components — no hook equivalent.
// This is the real, current trigger for FatalErrorScreen: an uncaught
// render crash genuinely makes the app unusable, unlike e.g. the API
// being unreachable (which stays a recoverable inline state).
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("Unhandled render error:", error);
  }

  override render() {
    if (this.state.hasError) {
      return <FatalErrorScreen onRetry={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}
