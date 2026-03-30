import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User, ThreadWithPreview } from "../lib/types.js";
import { decryptMessage } from "../lib/crypto.js";

export function registerThreadsTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-threads", {
    description: "List your message threads with previews, unread counts, and member state.",
    inputSchema: {
      status: z
        .enum(["active", "archived", "muted", "starred"])
        .optional()
        .describe("Filter threads by member state"),
      sort: z
        .enum(["recent", "unread"])
        .optional()
        .default("recent")
        .describe("Sort order — 'recent' by last message, 'unread' by unread count"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ status, sort }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      let threads: ThreadWithPreview[] = db.getThreadsForUser(user.id);

      // Filter by status
      if (status === "starred") {
        threads = threads.filter((t) => t.starred);
      } else if (status) {
        threads = threads.filter((t) => t.member_state === status);
      }

      // Decrypt last_message_body for server_assisted messages
      const result = threads.map((t) => {
        let lastMessageBody = t.last_message_body;
        // The getThreadsForUser query returns the raw ciphertext as last_message_body.
        // Try to decrypt it — if it fails, it may be E2E or already plaintext.
        if (lastMessageBody) {
          // Get the last message to check encryption mode
          const messages = db.getMessagesForThread(t.id, 1);
          if (messages.length > 0) {
            const lastMsg = messages[0];
            if (lastMsg.encryption_mode === "server_assisted") {
              let decrypted: string | null;
              if (lastMsg.to_user_id === user.id) {
                const epoch = lastMsg.key_epoch ? db.getKeyEpoch(user.id, lastMsg.key_epoch) : null;
                const privKey = epoch?.private_key ?? user.private_key;
                decrypted = decryptMessage(lastMsg.ciphertext, lastMsg.nonce, lastMsg.sender_pub_key, privKey);
              } else {
                const recipient = db.getUserById(lastMsg.to_user_id);
                if (recipient) {
                  const epoch = lastMsg.key_epoch ? db.getKeyEpoch(recipient.id, lastMsg.key_epoch) : null;
                  const privKey = epoch?.private_key ?? recipient.private_key;
                  decrypted = decryptMessage(lastMsg.ciphertext, lastMsg.nonce, lastMsg.sender_pub_key, privKey);
                } else {
                  decrypted = null;
                }
              }
              lastMessageBody = decrypted ?? "[Decryption failed]";
            } else {
              lastMessageBody = "[E2E encrypted]";
            }
          }
        }

        const base: Record<string, unknown> = {
          id: t.id,
          type: t.type,
          last_message_body: lastMessageBody,
          last_message_at: t.last_message_at,
          last_message_at_iso: new Date(t.last_message_at * 1000).toISOString(),
          unread_count: t.unread_count,
          member_state: t.member_state,
          starred: !!t.starred,
        };

        if (t.type === "group") {
          base.name = t.name;
          base.member_count = t.member_count;
        } else {
          base.other_handle = t.other_handle;
          base.other_display_name = t.other_display_name;
        }

        return base;
      });

      // Sort
      if (sort === "unread") {
        result.sort((a, b) => (b.unread_count as number) - (a.unread_count as number));
      }
      // 'recent' is already the default sort from the query

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ threads: result, count: result.length }),
          },
        ],
      };
    },
  );
}
