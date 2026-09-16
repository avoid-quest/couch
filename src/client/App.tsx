import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Outlet } from "@tanstack/react-router";
import { SessionGate } from "./session-gate";
import { AppShell } from "./shell";
import { Button } from "@/components/ui/button";

// The composition root: SessionGate owns session state and TV input, the shell
// owns the chrome around the routed section from routes/.
export function App() {
  return (
    <ShellErrorBoundary>
      <SessionGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </SessionGate>
    </ShellErrorBoundary>
  );
}

class ShellErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-shell couch-shell remote-shell"><main id="main">
        <div className="notice error-notice" role="alert"><span>{this.state.error.message}</span><Button onClick={() => this.setState({ error: null })}>Try again</Button></div>
      </main></div>
    );
  }
}
