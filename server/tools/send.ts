import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { encryptMessage } from "../lib/crypto.js";

export function registerSendTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-send",
    "Send an MMP message to another user by their @handle. This is the MCP Messaging Protocol — NOT email, NOT Gmail, NOT SMS. Use when the user says 'send @someone a message' or 'tell @someone something' via MMP.",
    {
      to: z.string().describe("Handle of the recipient"),
      body: z.string().optional().describe("Plaintext message body (server will encrypt)"),
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
      thread_id: z.string().optional().describe("Thread ID to send into (creates new thread if omitted)"),
    },
    async ({ to, body, encrypted_payload, priority, thread_id }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      if (!body && !encrypted_payload) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Either body or encrypted_payload is required." }) }],
          isError: true,
        };
      }

      // Resolve handle redirects
      const resolvedHandle = db.resolveHandle(to);
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

      // Check blocks
      if (db.isBlocked(recipient.id, user.id)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot send message to this user." }) }],
          isError: true,
        };
      }

      // Check contacts_only privacy
      if (recipient.privacy === "contacts_only" && !db.isContact(recipient.id, user.id)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "This user only accepts messages from contacts." }) }],
          isError: true,
        };
      }

      // Determine encryption
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
        const encrypted = encryptMessage(body!, recipient.public_key, user.private_key);
        ciphertext = encrypted.ciphertext;
        nonce = encrypted.nonce;
        senderPubKey = encrypted.sender_public_key;
        encryptionMode = "server_assisted";
      }

      // Resolve or create thread
      let threadId = thread_id;
      if (!threadId) {
        const existingThread = db.findThreadBetweenUsers(user.id, recipient.id);
        if (existingThread) {
          threadId = existingThread.id;
        }
      }

      const now = Math.floor(Date.now() / 1000);

      if (!threadId) {
        threadId = uuidv4();
        const subject = body ? body.slice(0, 50) : "Encrypted message";
        db.createThread({
          id: threadId,
          subject,
          created_by: user.id,
          created_at: now,
          updated_at: now,
        });
        db.raw
          .prepare(
            "INSERT INTO thread_members (thread_id, user_id, state, last_read_at) VALUES (?, ?, 'active', ?)",
          )
          .run(threadId, user.id, now);
        db.raw
          .prepare(
            "INSERT INTO thread_members (thread_id, user_id, state, last_read_at) VALUES (?, ?, 'active', 0)",
          )
          .run(threadId, recipient.id);
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
        created_at: now,
      });

      db.updateThreadTimestamp(threadId);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message_id: messageId,
              thread_id: threadId,
              sent_to: resolvedHandle,
            }),
          },
        ],
      };
    },
  );
}
