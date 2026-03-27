import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerArchiveTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg-archive",
    "Archive or unarchive a thread. Primarily for MCP App use.",
    {
      thread_id: z.string().describe("Thread ID to archive/unarchive"),
      undo: z.boolean().optional().default(false).describe("If true, unarchive (set back to active)"),
    },
    async ({ thread_id, undo }) => {
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

      const newState = undo ? "active" : "archived";
      db.updateThreadMemberState(thread_id, user.id, newState);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              thread_id,
              state: newState,
              message: undo ? "Thread unarchived." : "Thread archived.",
            }),
          },
        ],
      };
    },
  );
}
