import { getSenderIdentity } from "../../identity.js";
import { jidToE164, normalizeE164 } from "../../text-runtime.js";
import type { WhatsAppInboundMessageContract } from "./inbound-message-contract.js";

export function resolvePeerId(msg: WhatsAppInboundMessageContract) {
  if (msg.chatType === "group") {
    return msg.conversationId ?? msg.from;
  }
  const sender = getSenderIdentity(msg);
  if (sender.e164) {
    return normalizeE164(sender.e164) ?? sender.e164;
  }
  if (msg.from.includes("@")) {
    return jidToE164(msg.from) ?? msg.from;
  }
  return normalizeE164(msg.from) ?? msg.from;
}
