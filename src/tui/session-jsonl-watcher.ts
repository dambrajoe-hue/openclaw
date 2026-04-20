import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";

export type SessionJsonlWatcherCallbacks = {
  onExternalWrite: () => void;
};

// Watches the JSONL file for the TUI's currently-attached session and fires
// `onExternalWrite` (debounced) when any process other than this TUI appends
// to it — e.g. inbox wake-handlers, crons, or sibling agents writing through
// the gateway. The TUI's normal WebSocket event stream only covers events
// originating from its own turn loop, so without this watcher async work that
// lands in the session is invisible until the next user-initiated turn.
export class SessionJsonlWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentPath: string | null = null;
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

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
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
      this.callbacks.onExternalWrite();
    }, this.debounceMs);
  }
}

function resolvePath(agentId: string, sessionId: string): string {
  return path.join(resolveSessionTranscriptsDirForAgent(agentId), `${sessionId}.jsonl`);
}
