import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User, FederationEnvelope } from "../lib/types.js";
import { encryptMessage } from "../lib/crypto.js";
import { fireWebhook } from "../lib/webhooks.js";
import {
  parseHandle,
  lookupRemoteUser,
  deliverToRemote,
  getOrCreateServerIdentity,
} from "../lib/federation.js";

const attachmentSchema = z.object({
  filename: z.string().describe("Original filename"),
  mime_type: z.string().optional().default("application/octet-stream").describe("MIME type"),
  data: z.string().describe("Base64-encoded file content (plaintext — server will encrypt)"),
});

export function registerSendTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
  serverUrl?: string,
): void {
  server.registerTool("mmp-send", {
    description: "Send an MMP message to another user or group thread. Supports federation (@user@server.com for remote users), file attachments, and group messaging. This is the Model Messaging Protocol — NOT email, NOT Gmail, NOT SMS.",
    inputSchema: {
      to: z.string().optional().describe("Handle: @user (local) or @user@server.com (federated). Required for DMs, omit for group threads."),
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
      thread_id: z.string().optional().describe("Thread ID to send into (required for groups, optional for DMs)"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ to, body, attachments, encrypted_payload, priority, thread_id }) => {
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

      const now = Math.floor(Date.now() / 1000);

      // --- Group thread send ---
      if (thread_id) {
        const thread = db.getThread(thread_id);
        if (!thread) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Thread not found." }) }],
            isError: true,
          };
        }
        const senderMember = db.getThreadMember(thread_id, user.id);
        if (!senderMember || senderMember.state === "archived") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "You are not a member of this thread." }) }],
            isError: true,
          };
        }

        if (thread.type === "group") {
          // Fan-out: encrypt and store one message per recipient
          const members = db.getThreadMembers(thread_id);
          const recipients = members.filter((m) => m.user_id !== user.id);
          const messageIds: string[] = [];

          // Get sender's current key epoch
          const senderEpochGroup = db.getCurrentEpoch(user.id);
          const senderPrivKeyGroup = senderEpochGroup?.private_key ?? user.private_key;
          const keyEpochGroup = senderEpochGroup?.epoch ?? 0;

          for (const member of recipients) {
            const recipient = db.getUserById(member.user_id);
            if (!recipient) continue;

            // Use recipient's current epoch key if available
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
              const encrypted = encryptMessage(body || "", recPubKey, senderPrivKeyGroup);
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
              key_epoch: keyEpochGroup,
              created_at: now,
            });

            // Encrypt and store attachments per recipient
            if (attachments && attachments.length > 0) {
              for (const att of attachments) {
                const dataBytes = Buffer.from(att.data, "base64");
                const encrypted = encryptMessage(att.data, recPubKey, senderPrivKeyGroup);
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

          // Fire webhooks for all group recipients
          for (const member of recipients) {
            const r = db.getUserById(member.user_id);
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
              }),
            }],
          };
        }
        // else: DM thread with explicit thread_id — fall through to DM logic
      }

      // --- DM send ---
      if (!to) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Provide 'to' handle for DMs, or 'thread_id' for group messages." }) }],
          isError: true,
        };
      }

      // Parse handle for federation
      const parsed = parseHandle(to);

      // Get sender's current key epoch
      const senderEpoch = db.getCurrentEpoch(user.id);
      const senderPrivateKey = senderEpoch?.private_key ?? user.private_key;
      const senderPublicKeyForMsg = senderEpoch?.public_key ?? user.public_key;
      const keyEpoch = senderEpoch?.epoch ?? 0;

      // --- Federated send ---
      if (parsed.isRemote) {
        const localServer = serverUrl ? new URL(serverUrl).hostname : null;
        if (parsed.server === localServer) {
          // It's actually a local user addressed with full federation syntax
          parsed.isRemote = false;
          parsed.server = null;
        }
      }

      if (parsed.isRemote) {
        if (!serverUrl) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Federation not configured (no MMP_SERVER_URL)." }) }],
            isError: true,
          };
        }

        // Look up remote user's public key
        const remoteProfile = await lookupRemoteUser(parsed.server!, parsed.user);
        if (!remoteProfile) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Could not reach @${parsed.user}@${parsed.server}. Server may be offline or user not found.` }) }],
            isError: true,
          };
        }

        // Encrypt for the remote recipient
        let ciphertext: string;
        let nonce: string;
        let senderPubKey: string;
        let encryptionMode: "e2e" | "server_assisted" = "server_assisted";

        if (encrypted_payload) {
          ciphertext = encrypted_payload.ciphertext;
          nonce = encrypted_payload.nonce;
          senderPubKey = encrypted_payload.sender_public_key;
          encryptionMode = "e2e";
        } else {
          const encrypted = encryptMessage(body || "", remoteProfile.public_key, senderPrivateKey);
          ciphertext = encrypted.ciphertext;
          nonce = encrypted.nonce;
          senderPubKey = encrypted.sender_public_key;
        }

        const identity = getOrCreateServerIdentity(db, serverUrl);

        const envelope: FederationEnvelope = {
          from_handle: user.handle,
          from_server: new URL(serverUrl).hostname,
          to_handle: parsed.user,
          ciphertext,
          nonce,
          sender_pub_key: senderPubKey,
          encryption_mode: encryptionMode,
          key_epoch: keyEpoch,
          priority: priority ?? "normal",
          timestamp: now,
          signature: "", // Will be set by deliverToRemote
        };

        // Encrypt and include attachments
        if (attachments && attachments.length > 0) {
          envelope.attachments = attachments.map((att) => {
            const dataBytes = Buffer.from(att.data, "base64");
            const encrypted = encryptMessage(att.data, remoteProfile.public_key, senderPrivateKey);
            return {
              filename: att.filename,
              mime_type: att.mime_type ?? "application/octet-stream",
              size_bytes: dataBytes.length,
              ciphertext: encrypted.ciphertext,
              nonce: encrypted.nonce,
            };
          });
        }

        const result = await deliverToRemote(
          parsed.server!,
          envelope,
          identity.signing_private_key,
        );

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Federation delivery failed: ${result.error}` }) }],
            isError: true,
          };
        }

        // Store a local copy too
        const remoteUserId = `remote:${parsed.user}@${parsed.server}`;
        db.upsertRemoteUser({
          id: remoteUserId,
          handle: parsed.user,
          server: parsed.server!,
          display_name: remoteProfile.display_name,
          public_key: remoteProfile.public_key,
          fetched_at: now,
        });

        let threadId = thread_id;
        if (!threadId) {
          const existing = db.findThreadBetweenUsers(user.id, remoteUserId);
          if (existing) threadId = existing.id;
        }
        if (!threadId) {
          threadId = uuidv4();
          db.createThread({
            id: threadId,
            type: "dm",
            name: "",
            subject: `${parsed.user}@${parsed.server}`,
            created_by: user.id,
            created_at: now,
            updated_at: now,
          });
          db.addThreadMember(threadId, user.id, "owner");
          db.updateLastReadAt(threadId, user.id);
          db.addThreadMember(threadId, remoteUserId, "member");
        }

        const messageId = uuidv4();
        db.createMessage({
          id: messageId,
          thread_id: threadId,
          from_user_id: user.id,
          to_user_id: remoteUserId,
          reply_to: null,
          priority: priority ?? "normal",
          ciphertext,
          nonce,
          sender_pub_key: senderPubKey,
          encryption_mode: encryptionMode,
          key_epoch: keyEpoch,
          created_at: now,
        });

        db.updateThreadTimestamp(threadId);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              message_id: messageId,
              thread_id: threadId,
              sent_to: `${parsed.user}@${parsed.server}`,
              federated: true,
              attachments: attachments?.length ?? 0,
            }),
          }],
        };
      }

      // --- Local DM send ---
      const resolvedHandle = db.resolveHandle(parsed.user);
      const recipient = db.getUserByHandle(resolvedHandle);
      if (!recipient) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${to}' not found.` }) }],
          isError: true,
        };
      }

      if (recipient.id === user.id) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot send a message to yourself." }) }],
          isError: true,
        };
      }

      if (db.isBlocked(recipient.id, user.id)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot send message to this user." }) }],
          isError: true,
        };
      }

      if (recipient.privacy === "contacts_only" && !db.isContact(recipient.id, user.id)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "This user only accepts messages from contacts." }) }],
          isError: true,
        };
      }

      // Use recipient's current epoch key if available
      const recipientEpoch = db.getCurrentEpoch(recipient.id);
      const recipientPubKey = recipientEpoch?.public_key ?? recipient.public_key;

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
        const encrypted = encryptMessage(body || "", recipientPubKey, senderPrivateKey);
        ciphertext = encrypted.ciphertext;
        nonce = encrypted.nonce;
        senderPubKey = encrypted.sender_public_key;
        encryptionMode = "server_assisted";
      }

      let threadId = thread_id;
      if (!threadId) {
        const existingThread = db.findThreadBetweenUsers(user.id, recipient.id);
        if (existingThread) {
          threadId = existingThread.id;
        }
      }

      if (!threadId) {
        threadId = uuidv4();
        const subject = body ? body.slice(0, 50) : "Encrypted message";
        db.createThread({
          id: threadId,
          type: "dm",
          name: "",
          subject,
          created_by: user.id,
          created_at: now,
          updated_at: now,
        });
        db.addThreadMember(threadId, user.id, "owner");
        db.updateLastReadAt(threadId, user.id);
        db.addThreadMember(threadId, recipient.id);
      }

      const messageId = uuidv4();
      db.createMessage({
        id: messageId,
        thread_id: threadId,
        from_user_id: user.id,
        to_user_id: recipient.id,
        reply_to: null,
        priority: priority ?? "normal",
        ciphertext,
        nonce,
        sender_pub_key: senderPubKey,
        encryption_mode: encryptionMode,
        key_epoch: keyEpoch,
        created_at: now,
      });

      // Store attachments
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          const dataBytes = Buffer.from(att.data, "base64");
          const encrypted = encryptMessage(att.data, recipientPubKey, senderPrivateKey);
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

      db.updateThreadTimestamp(threadId);

      // Fire webhook for local DM recipient
      fireWebhook(db, recipient.id, {
        event: "message.received",
        message_id: messageId,
        thread_id: threadId,
        from_handle: user.handle,
        to_handle: recipient.handle,
        priority: priority ?? "normal",
        has_attachments: (attachments?.length ?? 0) > 0,
        timestamp: now,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message_id: messageId,
            thread_id: threadId,
            sent_to: resolvedHandle,
            key_epoch: keyEpoch,
            attachments: attachments?.length ?? 0,
          }),
        }],
      };
    },
  );
}
