import type {
  WhatsAppIdentity,
  WhatsAppReplyContext,
  WhatsAppSelfIdentity,
} from "../../identity.js";

export type WhatsAppInboundMessageContract = {
  body: string;
  from: string;
  to: string;
  accountId: string;
  chatType: "direct" | "group";
  conversationId?: string;
  timestamp?: number;
  sender?: WhatsAppIdentity;
  senderJid?: string;
  senderE164?: string;
  senderName?: string;
  replyTo?: WhatsAppReplyContext;
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  replyToSenderJid?: string;
  replyToSenderE164?: string;
  self?: WhatsAppSelfIdentity;
  selfJid?: string | null;
  selfLid?: string | null;
  selfE164?: string | null;
  fromMe?: boolean;
};

export type WhatsAppDirectInboundMessageContract = WhatsAppInboundMessageContract & {
  chatType: "direct";
};
