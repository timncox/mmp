import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerReactTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-react", {
    description: "Add or remove an emoji reaction on a message. If the reaction already exists, it is removed (toggle behavior).",
    inputSchema: {
      message_id: z.string().describe("The message ID to react to"),
      emoji: z.string().min(1).max(32).describe("The emoji to react with"),
    },
  }, async ({ message_id, emoji }) => {
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

      // Toggle: check if reaction exists
      const existing = db.getReactionsForMessages([message_id])
        .find(r => r.user_id === user.id && r.emoji === emoji);

      if (existing) {
        db.removeReaction(message_id, user.id, emoji);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "removed", message_id, emoji }) }],
        };
      } else {
        db.addReaction(message_id, user.id, emoji);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "added", message_id, emoji }) }],
        };
      }
    },
  );
}
