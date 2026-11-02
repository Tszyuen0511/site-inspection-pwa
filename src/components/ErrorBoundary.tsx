import { Component, type ReactNode } from "react";
import { createRecoveryDump, recoveryFileName } from "../recovery";
import { download } from "../export";

interface State {
  error?: Error;
  recovery: string;
}
/** Last line of defence: a render crash must never leave a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { recovery: "" };
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }
  recover = async () => {
    try {
      download(await createRecoveryDump(), recoveryFileName());
      this.setState({
        recovery:
          "Recovery data download requested. Check your Downloads folder before reloading.",
      });
    } catch (error) {
      this.setState({
        recovery: `Recovery data could not be created: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="empty-state" role="alert" style={{ padding: 24 }}>
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p>
          Your stored inspections and photographs have not been changed.
          Download the raw recovery data first, then reload.
        </p>
        <div className="row wrap">
          <button
            className="btn btn-primary"
            onClick={() => void this.recover()}
          >
            Download recovery data
          </button>
          <button
            className="btn btn-outline"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
        {this.state.recovery && <p role="status">{this.state.recovery}</p>}
      </main>
    );
  }
}
