import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User, DecryptedMessage } from "../lib/types.js";
import { decryptMessage } from "../lib/crypto.js";

export function registerDigestTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg-digest",
    "Get a digest of all threads and messages for a time period, with stats on total messages, unread count, and urgent messages.",
    {
      period: z
        .enum(["today", "24h", "week"])
        .optional()
        .default("24h")
        .describe("Time period for the digest"),
    },
    async ({ period }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const now = Math.floor(Date.now() / 1000);
      let sinceTs: number;

      switch (period) {
        case "today": {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          sinceTs = Math.floor(todayStart.getTime() / 1000);
          break;
        }
        case "week":
          sinceTs = now - 7 * 24 * 60 * 60;
          break;
        case "24h":
        default:
          sinceTs = now - 24 * 60 * 60;
          break;
      }

      // Get all threads for this user
      const threads = db.getThreadsForUser(user.id);

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

      let totalMessages = 0;
      let unreadCount = 0;
      let urgentCount = 0;

      const threadDigests: Array<{
        thread_id: string;
        subject: string;
        other_handle: string;
        messages: DecryptedMessage[];
        unread: number;
      }> = [];

      for (const thread of threads) {
        const messages = db.getMessagesForThread(thread.id, 500);
        const periodMessages = messages.filter((m) => m.created_at >= sinceTs);

        if (periodMessages.length === 0) continue;

        const member = db.getThreadMember(thread.id, user.id);
        const threadUnread = periodMessages.filter(
          (m) => member && m.created_at > member.last_read_at && m.from_user_id !== user.id,
        ).length;

        const decryptedMessages: DecryptedMessage[] = periodMessages.map((msg) => {
          let body: string | null;
          if (msg.encryption_mode === "server_assisted") {
            body = decryptMessage(
              msg.ciphertext,
              msg.nonce,
              msg.sender_pub_key,
              user.private_key,
            );
          } else {
            body = "[E2E encrypted]";
          }

          if (msg.priority === "urgent") urgentCount++;

          return {
            id: msg.id,
            thread_id: msg.thread_id,
            from_handle: getHandle(msg.from_user_id),
            to_handle: getHandle(msg.to_user_id),
            body,
            priority: msg.priority,
            encryption_mode: msg.encryption_mode,
            reply_to: msg.reply_to,
            created_at: msg.created_at,
          };
        });

        totalMessages += periodMessages.length;
        unreadCount += threadUnread;

        threadDigests.push({
          thread_id: thread.id,
          subject: thread.subject,
          other_handle: thread.other_handle,
          messages: decryptedMessages,
          unread: threadUnread,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              period,
              stats: {
                total_messages: totalMessages,
                unread: unreadCount,
                urgent: urgentCount,
              },
              threads: threadDigests,
            }),
          },
        ],
      };
    },
  );
}
