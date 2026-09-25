import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Uncaught error in Randomster UI:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
          <h1 className="font-display text-2xl font-bold text-magenta">SOMETHING BROKE</h1>
          <p className="text-gray-400 text-sm max-w-sm">
            Randomster hit an unexpected error. Refresh to try again — your account and data are unaffected.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-lime text-black font-display font-bold px-6 py-3 border-2 border-black shadow-brutal"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
