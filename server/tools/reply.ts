import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { encryptMessage } from "../lib/crypto.js";

export function registerReplyTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg/reply",
    "Reply to an existing thread. Supports plaintext (server-assisted encryption) or E2E encrypted payloads.",
    {
      thread_id: z.string().describe("Thread ID to reply in"),
      body: z.string().optional().describe("Plaintext message body (server will encrypt)"),
      encrypted_payload: z
        .object({
          ciphertext: z.string(),
          nonce: z.string(),
          sender_public_key: z.string(),
        })
        .optional()
        .describe("Pre-encrypted E2E payload"),
    },
    async ({ thread_id, body, encrypted_payload }) => {
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

      // Validate thread exists
      const thread = db.getThread(thread_id);
      if (!thread) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Thread not found." }) }],
          isError: true,
        };
      }

      // Validate user is a member
      const member = db.getThreadMember(thread_id, user.id);
      if (!member) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "You are not a member of this thread." }) }],
          isError: true,
        };
      }

      // Find the other member as recipient
      const members = db.getThreadMembers(thread_id);
      const otherMember = members.find((m) => m.user_id !== user.id);
      if (!otherMember) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No recipient found in thread." }) }],
          isError: true,
        };
      }

      const recipient = db.getUserById(otherMember.user_id);
      if (!recipient) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Recipient user not found." }) }],
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

      const now = Math.floor(Date.now() / 1000);
      const messageId = uuidv4();

      db.createMessage({
        id: messageId,
        thread_id,
        from_user_id: user.id,
        to_user_id: recipient.id,
        reply_to: null,
        priority: "normal",
        ciphertext,
        nonce,
        sender_pub_key: senderPubKey,
        encryption_mode: encryptionMode,
        created_at: now,
      });

      db.updateThreadTimestamp(thread_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              message_id: messageId,
              thread_id,
              sent_to: recipient.handle,
            }),
          },
        ],
      };
    },
  );
}
