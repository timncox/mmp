import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { decryptMessage } from "../lib/crypto.js";

export function registerDownloadTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-download", {
    description: "Download a file attachment by ID. Returns the decrypted file as base64 data.",
    inputSchema: {
      attachment_id: z.string().describe("The attachment ID to download"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ attachment_id }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const attachment = db.getAttachmentById(attachment_id);
      if (!attachment) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Attachment not found." }) }],
          isError: true,
        };
      }

      // Verify user has access via thread membership
      const message = db.getMessageById(attachment.message_id);
      if (!message) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Message not found." }) }],
          isError: true,
        };
      }

      const member = db.getThreadMember(message.thread_id, user.id);
      if (!member) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Access denied." }) }],
          isError: true,
        };
      }

      if (attachment.encryption_mode === "server_assisted") {
        // Decrypt using the recipient's private key
        let privKey: string;
        if (message.to_user_id === user.id) {
          const epoch = message.key_epoch ? db.getKeyEpoch(user.id, message.key_epoch) : null;
          privKey = epoch?.private_key ?? user.private_key;
        } else {
          const recipient = db.getUserById(message.to_user_id);
          if (!recipient) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "Recipient not found." }) }],
              isError: true,
            };
          }
          const epoch = message.key_epoch ? db.getKeyEpoch(recipient.id, message.key_epoch) : null;
          privKey = epoch?.private_key ?? recipient.private_key;
        }

        const decrypted = decryptMessage(
          attachment.ciphertext,
          attachment.nonce,
          message.sender_pub_key,
          privKey,
        );

        if (!decrypted) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to decrypt attachment." }) }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: attachment.id,
              filename: attachment.filename,
              mime_type: attachment.mime_type,
              size_bytes: attachment.size_bytes,
              data: decrypted, // base64-encoded file content
            }),
          }],
        };
      } else {
        // E2E encrypted — return ciphertext for client-side decryption
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: attachment.id,
              filename: attachment.filename,
              mime_type: attachment.mime_type,
              size_bytes: attachment.size_bytes,
              encryption_mode: "e2e",
              ciphertext: attachment.ciphertext,
              nonce: attachment.nonce,
            }),
          }],
        };
      }
    },
  );
}
