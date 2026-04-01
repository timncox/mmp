import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { encryptMessage } from "../lib/crypto.js";
import { fireWebhook } from "../lib/webhooks.js";

const attachmentSchema = z.object({
  filename: z.string().describe("Original filename"),
  mime_type: z.string().optional().default("application/octet-stream").describe("MIME type"),
  data: z.string().describe("Base64-encoded file content (plaintext — server will encrypt)"),
});

export function registerReplyTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-reply", {
    description: "Reply to an existing MMP thread (DM or group). Supports plaintext (server-assisted encryption) or E2E encrypted payloads. Supports file attachments.",
    inputSchema: {
      thread_id: z.string().describe("Thread ID to reply in"),
      body: z.string().optional().describe("Plaintext message body (server will encrypt)"),
      attachments: z.array(attachmentSchema).optional().describe("File attachments (base64-encoded)"),
      encrypted_payload: z
        .object({
          ciphertext: z.string(),
          nonce: z.string(),
          sender_public_key: z.string(),
        })
        .optional()
        .describe("Pre-encrypted E2E payload"),
      priority: z
        .enum(["urgent", "normal", "low", "fyi"])
        .optional()
        .default("normal")
        .describe("Message priority"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ thread_id, body, attachments, encrypted_payload, priority }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      if (!body && !encrypted_payload && (!attachments || attachments.length === 0)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Either body, encrypted_payload, or attachments is required." }) }],
          isError: true,
        };
      }

      const thread = db.getThread(thread_id);
      if (!thread) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Thread not found." }) }],
          isError: true,
        };
      }

      const member = db.getThreadMember(thread_id, user.id);
      if (!member) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "You are not a member of this thread." }) }],
          isError: true,
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const members = db.getThreadMembers(thread_id);
      const recipients = members.filter((m) => m.user_id !== user.id);

      if (recipients.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No recipients found in thread." }) }],
          isError: true,
        };
      }

      // Fan-out: one encrypted message per recipient (works for both DMs and groups)
      const messageIds: string[] = [];
      const senderEpoch = db.getCurrentEpoch(user.id);
      const senderPrivKey = senderEpoch?.private_key ?? user.private_key;
      const keyEpoch = senderEpoch?.epoch ?? 0;

      for (const recipientMember of recipients) {
        const recipient = db.getUserById(recipientMember.user_id);
        if (!recipient) continue;

        const recEpoch = db.getCurrentEpoch(recipient.id);
        const recPubKey = recEpoch?.public_key ?? recipient.public_key;

        let ciphertext: string;
        let nonce: string;
        let senderPubKey: string;
        let encryptionMode: "e2e" | "server_assisted";

        if (encrypted_payload) {
          ciphertext = encrypted_payload.ciphertext;
          nonce = encrypted_payload.nonce;
          senderPubKey = encrypted_payload.sender_public_key;
          encryptionMode = "e2e";
        } else {
          const encrypted = encryptMessage(body || "", recPubKey, senderPrivKey);
          ciphertext = encrypted.ciphertext;
          nonce = encrypted.nonce;
          senderPubKey = encrypted.sender_public_key;
          encryptionMode = "server_assisted";
        }

        const messageId = uuidv4();
        messageIds.push(messageId);

        db.createMessage({
          id: messageId,
          thread_id,
          from_user_id: user.id,
          to_user_id: recipient.id,
          reply_to: null,
          priority: priority ?? "normal",
          ciphertext,
          nonce,
          sender_pub_key: senderPubKey,
          encryption_mode: encryptionMode,
          key_epoch: keyEpoch,
          content_type: "text" as const,
          call_id: null,
          created_at: now,
        });

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            const dataBytes = Buffer.from(att.data, "base64");
            const encrypted = encryptMessage(att.data, recPubKey, senderPrivKey);
            db.createAttachment({
              id: uuidv4(),
              message_id: messageId,
              filename: att.filename,
              mime_type: att.mime_type ?? "application/octet-stream",
              size_bytes: dataBytes.length,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
              encryption_mode: encryptionMode,
              created_at: now,
            });
          }
        }
      }

      db.updateThreadTimestamp(thread_id);

      // Fire webhooks for all recipients
      for (const recipientMember of recipients) {
        const r = db.getUserById(recipientMember.user_id);
        if (r) {
          fireWebhook(db, r.id, {
            event: "message.received",
            message_id: messageIds[0],
            thread_id,
            from_handle: user.handle,
            to_handle: r.handle,
            priority: priority ?? "normal",
            has_attachments: (attachments?.length ?? 0) > 0,
            timestamp: now,
          });
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message_ids: messageIds,
            thread_id,
            sent_to_count: recipients.length,
            attachments: attachments?.length ?? 0,
          }),
        }],
      };
    },
  );
}
