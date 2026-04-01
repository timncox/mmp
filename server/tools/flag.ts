import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerFlagTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-flag", {
    description: "Flag a message for review. Use this to report problematic bot messages or spam so the developer can be notified.",
    inputSchema: {
      message_id: z.string().describe("The message ID to flag"),
      reason: z.string().optional().default("").describe("Why you are flagging this message"),
    },
  }, async ({ message_id, reason }) => {
      const user = getUser();
      if (!user) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Not authenticated." }) }],
        };
      }

      const msg = db.getMessageById(message_id);
      if (!msg) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Message not found." }) }],
        };
      }

      // Check user is a member of the thread
      const member = db.getThreadMember(msg.thread_id, user.id);
      if (!member) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "You are not a member of this thread." }) }],
        };
      }

      db.flagMessage(message_id, user.id, reason ?? "");

      // Look up who sent the message so we can tell the user
      const sender = db.getUserById(msg.from_user_id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            flagged: true,
            message_id,
            sender: sender?.handle ?? "unknown",
            sender_type: sender?.type ?? "unknown",
            reason: reason ?? "",
          }),
        }],
      };
    },
  );
}
