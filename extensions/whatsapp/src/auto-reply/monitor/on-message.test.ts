import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyGroupGating: vi.fn(async () => ({ shouldProcess: false })),
  maybeBroadcastMessage: vi.fn(async () => false),
  processMessage: vi.fn(async () => true),
  updateLastRouteInBackground: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/reply-runtime", () => ({}));
vi.mock("openclaw/plugin-sdk/routing", () => ({
  buildGroupHistoryKey: () => "whatsapp:default:group:123@g.us",
  resolveAgentRoute: () => ({
    agentId: "main",
    accountId: "default",
    sessionKey: "agent:main:whatsapp:group:123@g.us",
    mainSessionKey: "agent:main:whatsapp:direct:+2000",
    channel: "whatsapp",
    lastRoutePolicy: "main",
    matchedBy: "default",
  }),
}));
vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  logVerbose: vi.fn(),
}));
vi.mock("../../group-session-key.js", () => ({
  resolveWhatsAppGroupSessionRoute: (route: unknown) => route,
}));
vi.mock("../../identity.js", () => ({
  getPrimaryIdentityId: (sender: { e164?: string; name?: string }) => sender.e164 ?? sender.name,
  getSenderIdentity: (msg: { senderE164?: string; senderName?: string }) => ({
    e164: msg.senderE164,
    name: msg.senderName,
  }),
}));
vi.mock("../../text-runtime.js", () => ({
  normalizeE164: (value: string) => value,
}));
vi.mock("../config.runtime.js", () => ({
  loadConfig: () => ({}),
}));
vi.mock("./broadcast.js", () => ({
  maybeBroadcastMessage: mocks.maybeBroadcastMessage,
}));
vi.mock("./group-gating.js", () => ({
  applyGroupGating: mocks.applyGroupGating,
}));
vi.mock("./last-route.js", () => ({
  updateLastRouteInBackground: mocks.updateLastRouteInBackground,
}));
vi.mock("./peer.js", () => ({
  resolvePeerId: () => "123@g.us",
}));
vi.mock("./process-message.js", () => ({
  processMessage: mocks.processMessage,
}));

const { createWebOnMessageHandler } = await import("./on-message.js");

function makeReplyLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Parameters<typeof createWebOnMessageHandler>[0]["replyLogger"];
}

describe("web on-message gating", () => {
  beforeEach(() => {
    mocks.applyGroupGating.mockClear();
    mocks.maybeBroadcastMessage.mockClear();
    mocks.processMessage.mockClear();
    mocks.updateLastRouteInBackground.mockClear();
  });

  it("does not start composing for group messages rejected by gating", async () => {
    const sendComposing = vi.fn(async () => undefined);
    const handler = createWebOnMessageHandler({
      cfg: {} as never,
      verbose: false,
      connectionId: "test",
      maxMediaBytes: 1024,
      groupHistoryLimit: 5,
      groupHistories: new Map(),
      groupMemberNames: new Map(),
      echoTracker: {
        has: () => false,
        forget: () => undefined,
        buildCombinedKey: () => "group-key",
        rememberText: () => undefined,
      },
      backgroundTasks: new Set(),
      replyResolver: vi.fn() as never,
      replyLogger: makeReplyLogger(),
      baseMentionConfig: {} as never,
      account: {},
    });

    await handler({
      id: "g1",
      from: "123@g.us",
      conversationId: "123@g.us",
      to: "+2000",
      body: "hello everyone",
      timestamp: Date.now(),
      chatType: "group",
      chatId: "123@g.us",
      accountId: "default",
      senderE164: "+15550001111",
      senderName: "Alice",
      selfE164: "+15550002222",
      sendComposing,
      reply: vi.fn(async () => undefined),
      sendMedia: vi.fn(async () => undefined),
    });

    expect(mocks.applyGroupGating).toHaveBeenCalledTimes(1);
    expect(mocks.processMessage).not.toHaveBeenCalled();
    expect(sendComposing).not.toHaveBeenCalled();
  });
});
