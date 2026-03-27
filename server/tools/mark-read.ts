import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerMarkReadTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg/mark_read",
    "Mark a thread as read (updates last_read_at). Primarily for MCP App use.",
    {
      thread_id: z.string().describe("Thread ID to mark as read"),
    },
    async ({ thread_id }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
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

      db.updateLastReadAt(thread_id, user.id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              thread_id,
              message: "Thread marked as read.",
            }),
          },
        ],
      };
    },
  );
}
