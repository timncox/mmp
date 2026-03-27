import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User, DecryptedMessage } from "../lib/types.js";
import { decryptMessage } from "../lib/crypto.js";

export function registerInboxTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-inbox",
    "Get your MMP (MCP Messaging Protocol) inbox — person-to-person messages sent via MMP handles (@username), NOT email or Gmail. Use this when the user says 'check my MMP messages' or 'check my messages' in the context of MMP.",
    {
      since: z.string().optional().describe("ISO timestamp — only return messages after this time"),
      unread_only: z.boolean().optional().default(false).describe("If true, only return unread messages"),
      limit: z.number().optional().default(50).describe("Maximum number of messages to return"),
    },
    async ({ since, unread_only, limit }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const sinceTs = since ? Math.floor(new Date(since).getTime() / 1000) : undefined;
      const rawMessages = db.getMessagesForUser(user.id, limit ?? 50, sinceTs ? undefined : undefined);

      // Build a cache of users for handle lookups
      const userCache = new Map<string, User>();
      userCache.set(user.id, user);

      const getHandle = (userId: string): string => {
        let u = userCache.get(userId);
        if (!u) {
          u = db.getUserById(userId);
          if (u) userCache.set(userId, u);
        }
        return u?.handle ?? "unknown";
      };

      const decryptedMessages: DecryptedMessage[] = [];

      for (const msg of rawMessages) {
        // Filter by since timestamp
        if (sinceTs && msg.created_at <= sinceTs) continue;

        // Filter by unread — compare msg.created_at against the thread member's last_read_at
        if (unread_only) {
          const member = db.getThreadMember(msg.thread_id, user.id);
          if (member && msg.created_at <= member.last_read_at) continue;
        }

        let body: string | null;
        if (msg.encryption_mode === "server_assisted") {
          if (msg.to_user_id === user.id) {
            body = decryptMessage(
              msg.ciphertext,
              msg.nonce,
              msg.sender_pub_key,
              user.private_key,
            );
          } else {
            const recipient = db.getUserById(msg.to_user_id);
            body = recipient
              ? decryptMessage(msg.ciphertext, msg.nonce, msg.sender_pub_key, recipient.private_key)
              : null;
          }
        } else {
          body = "[E2E encrypted — open in MCP App inbox to read]";
        }

        decryptedMessages.push({
          id: msg.id,
          thread_id: msg.thread_id,
          from_handle: getHandle(msg.from_user_id),
          to_handle: getHandle(msg.to_user_id),
          body,
          priority: msg.priority,
          encryption_mode: msg.encryption_mode,
          reply_to: msg.reply_to,
          created_at: msg.created_at,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              messages: decryptedMessages,
              count: decryptedMessages.length,
            }),
          },
        ],
      };
    },
  );
}
