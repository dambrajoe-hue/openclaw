import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionJsonlWatcher } from "./session-jsonl-watcher.js";

const AGENT_ID = "main";
const SESSION_ID = "test-session";

describe("SessionJsonlWatcher", () => {
  let tempStateDir: string;
  let sessionFilePath: string;
  let originalStateDir: string | undefined;
  let originalTestFast: string | undefined;
  let watcher: SessionJsonlWatcher | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-tui-watcher-"));
    const sessionsDir = path.join(tempStateDir, "agents", AGENT_ID, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    sessionFilePath = path.join(sessionsDir, `${SESSION_ID}.jsonl`);
    await fs.writeFile(sessionFilePath, "", "utf8");
    originalStateDir = process.env.OPENCLAW_STATE_DIR;
    originalTestFast = process.env.OPENCLAW_TEST_FAST;
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
    process.env.OPENCLAW_TEST_FAST = "1";
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
    if (originalStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalStateDir;
    }
    if (originalTestFast === undefined) {
      delete process.env.OPENCLAW_TEST_FAST;
    } else {
      process.env.OPENCLAW_TEST_FAST = originalTestFast;
    }
    await fs.rm(tempStateDir, { recursive: true, force: true });
  });

  it("fires onExternalWrite (debounced) when idle and the session file is appended", async () => {
    const onExternalWrite = vi.fn();
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => false });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    await fs.appendFile(sessionFilePath, '{"type":"message","role":"assistant"}\n', "utf8");
    await delay(1500);
    expect(onExternalWrite).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of writes into a single callback", async () => {
    const onExternalWrite = vi.fn();
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => false });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    for (let i = 0; i < 5; i++) {
      await fs.appendFile(sessionFilePath, `{"i":${i}}\n`, "utf8");
      await delay(50);
    }
    await delay(1500);
    expect(onExternalWrite).toHaveBeenCalledTimes(1);
  });

  it("does not fire after stop()", async () => {
    const onExternalWrite = vi.fn();
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => false });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    await watcher.stop();
    watcher = null;
    await fs.appendFile(sessionFilePath, '{"after":"stop"}\n', "utf8");
    await delay(1000);
    expect(onExternalWrite).not.toHaveBeenCalled();
  });

  it("is a no-op when started twice with the same agent+session", async () => {
    const onExternalWrite = vi.fn();
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => false });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    await fs.appendFile(sessionFilePath, '{"x":1}\n', "utf8");
    await delay(1500);
    expect(onExternalWrite).toHaveBeenCalledTimes(1);
  });

  it("defers onExternalWrite while a run is active; does NOT call loadHistory mid-turn", async () => {
    const onExternalWrite = vi.fn();
    let runActive = true;
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => runActive });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    // Simulate Alfred's streaming writes during an active run.
    for (let i = 0; i < 10; i++) {
      await fs.appendFile(sessionFilePath, `{"delta":${i}}\n`, "utf8");
      await delay(60);
    }
    await delay(1500);
    expect(onExternalWrite).not.toHaveBeenCalled();
  });

  it("flushes one pending notify via onRunEnded() after the run settles", async () => {
    const onExternalWrite = vi.fn();
    let runActive = true;
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => runActive });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    await fs.appendFile(sessionFilePath, '{"during":"run"}\n', "utf8");
    await delay(1000);
    expect(onExternalWrite).not.toHaveBeenCalled();
    runActive = false;
    watcher.onRunEnded();
    expect(onExternalWrite).toHaveBeenCalledTimes(1);
  });

  it("onRunEnded() is a no-op when no writes were deferred", async () => {
    const onExternalWrite = vi.fn();
    watcher = new SessionJsonlWatcher({ onExternalWrite, isRunActive: () => false });
    await watcher.start(AGENT_ID, SESSION_ID);
    await delay(150);
    watcher.onRunEnded();
    watcher.onRunEnded();
    expect(onExternalWrite).not.toHaveBeenCalled();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
