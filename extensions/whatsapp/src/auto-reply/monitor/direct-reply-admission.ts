import { shouldHandleTextCommands } from "openclaw/plugin-sdk/command-auth";
import { shouldComputeCommandAuthorized } from "openclaw/plugin-sdk/command-detection";
import {
  loadSessionStoreAsync,
  resolveSendPolicy,
  resolveSessionStoreEntry,
  resolveStorePath,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/config-runtime";
import {
  resolveInboundReplyAdmission,
  type InboundReplyAdmission,
} from "openclaw/plugin-sdk/reply-runtime";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { getPrimaryIdentityId, getSenderIdentity } from "../../identity.js";
import {
  resolveWhatsAppCommandAuthorized,
  resolveWhatsAppInboundPolicy,
} from "../../inbound-policy.js";
import type { WhatsAppDirectInboundMessageContract } from "./inbound-message-contract.js";
import { buildInboundLine } from "./message-line.js";
import { resolvePeerId } from "./peer.js";
import { resolveInboundSessionEnvelopeContext } from "./runtime-api.js";

export type WhatsAppDirectReplyAdmission = {
  replyAdmission: InboundReplyAdmission;
};

export async function resolveWhatsAppDirectReplyAdmission(params: {
  cfg: OpenClawConfig;
  msg: WhatsAppDirectInboundMessageContract;
  buildCombinedEchoKey: (params: { sessionKey: string; combinedBody: string }) => string;
  echoHas: (key: string) => boolean;
}): Promise<WhatsAppDirectReplyAdmission> {
  const route = resolveAgentRoute({
    cfg: params.cfg,
    channel: "whatsapp",
    accountId: params.msg.accountId,
    peer: {
      kind: "direct",
      id: resolvePeerId(params.msg),
    },
  });
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: route.agentId,
  });
  const store = await loadSessionStoreAsync(storePath);
  const sessionStoreEntry = resolveSessionStoreEntry({
    store,
    sessionKey: route.sessionKey,
  });
  const sendPolicy = resolveSendPolicy({
    cfg: params.cfg,
    entry: sessionStoreEntry.existing,
    sessionKey: route.sessionKey,
    channel: sessionStoreEntry.existing?.channel ?? "whatsapp",
    chatType: sessionStoreEntry.existing?.chatType ?? "direct",
  });
  const inboundPolicy = resolveWhatsAppInboundPolicy({
    cfg: params.cfg,
    accountId: route.accountId ?? params.msg.accountId,
    selfE164: params.msg.selfE164 ?? null,
  });
  const shouldComputeAuth = shouldComputeCommandAuthorized(params.msg.body, params.cfg);
  const commandAuthorized = shouldComputeAuth
    ? await resolveWhatsAppCommandAuthorized({
        cfg: params.cfg,
        msg: params.msg,
        policy: inboundPolicy,
      })
    : undefined;
  const { envelopeOptions, previousTimestamp } = resolveInboundSessionEnvelopeContext({
    cfg: params.cfg,
    agentId: route.agentId,
    sessionKey: route.sessionKey,
  });
  const combinedBody = buildInboundLine({
    cfg: params.cfg,
    msg: params.msg,
    agentId: route.agentId,
    previousTimestamp,
    envelope: envelopeOptions,
  });
  const combinedEchoKey = params.buildCombinedEchoKey({
    sessionKey: route.sessionKey,
    combinedBody,
  });
  const sender = getSenderIdentity(params.msg);
  const replyAdmission = resolveInboundReplyAdmission({
    ctx: {
      AccountId: route.accountId,
      Body: params.msg.body,
      RawBody: params.msg.body,
      CommandBody: params.msg.body,
      From: params.msg.from,
      To: params.msg.to,
      ChatType: "direct",
      SenderId: getPrimaryIdentityId(sender) ?? sender.e164 ?? params.msg.from,
      SenderE164: sender.e164 ?? params.msg.senderE164,
      Provider: "whatsapp",
      Surface: "whatsapp",
      OriginatingChannel: "whatsapp",
      OriginatingTo: params.msg.from,
    },
    cfg: params.cfg,
    sendPolicy,
    allowTextCommands: shouldHandleTextCommands({
      cfg: params.cfg,
      surface: "whatsapp",
    }),
    commandAuthorized: commandAuthorized ?? true,
    agentId: route.agentId,
    echoDetected: params.echoHas(params.msg.body) || params.echoHas(combinedEchoKey),
    includeDisabledCommands: true,
  });

  return {
    replyAdmission,
  };
}
