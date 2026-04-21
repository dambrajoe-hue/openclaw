import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";

export type SessionJsonlWatcherCallbacks = {
  // Called when the watcher has concluded that an external process wrote to the
  // session JSONL and the TUI should re-render. Runs after any debounce.
  onExternalWrite: () => void;
  // Returns true while the TUI's own gateway-backed turn is streaming. While
  // true, writes are assumed to be from the TUI itself and are deferred — NOT
  // reported as external — to avoid a feedback loop where our own history
  // refresh hammers the gateway during every reasoning/tool step.
  isRunActive: () => boolean;
};

// Watches the JSONL file for the TUI's currently-attached session and fires
// `onExternalWrite` (debounced, gated on run-idle) when any process other than
// this TUI's active turn appends to it — e.g. inbox wake-handlers, crons, or
// sibling agents writing through the gateway. The TUI's normal WebSocket event
// stream only covers events originating from its own turn loop, so without
// this watcher async work that lands in the session is invisible until the
// next user-initiated turn.
//
// Active-run gating is critical: while the TUI has a turn in flight, the
// gateway itself is writing streaming deltas and tool events into the same
// JSONL. Firing a full history refresh on every one of those writes floods
// the gateway with chat.history/sessions.list requests and starves the agent's
// own LLM calls.
export class SessionJsonlWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentPath: string | null = null;
  private pendingExternal = false;
  private readonly debounceMs = 500;

  constructor(private readonly callbacks: SessionJsonlWatcherCallbacks) {}

  async start(agentId: string, sessionId: string): Promise<void> {
    const next = resolvePath(agentId, sessionId);
    if (this.currentPath === next && this.watcher) {
      return;
    }
    await this.stop();
    this.currentPath = next;
    const watcher = watch(next, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });
    watcher.on("change", () => this.scheduleNotify());
    watcher.on("add", () => this.scheduleNotify());
    this.watcher = watcher;
  }

  // Called by the TUI when its own active run transitions to idle. Flushes a
  // single deferred notify (if any accumulated during the run) so external
  // writes that landed while we were busy aren't lost.
  onRunEnded(): void {
    if (!this.pendingExternal) {
      return;
    }
    if (this.callbacks.isRunActive()) {
      return;
    }
    this.pendingExternal = false;
    this.callbacks.onExternalWrite();
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingExternal = false;
    const w = this.watcher;
    this.watcher = null;
    this.currentPath = null;
    if (w) {
      await w.close();
    }
  }

  private scheduleNotify(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.callbacks.isRunActive()) {
        this.pendingExternal = true;
        return;
      }
      this.callbacks.onExternalWrite();
    }, this.debounceMs);
  }
}

function resolvePath(agentId: string, sessionId: string): string {
  return path.join(resolveSessionTranscriptsDirForAgent(agentId), `${sessionId}.jsonl`);
}
