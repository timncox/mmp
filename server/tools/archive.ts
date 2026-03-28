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
    "mmp-archive",
    "Archive or unarchive a thread. Use action 'unarchive' to restore.",
    {
      thread_id: z.string().describe("Thread ID to archive/unarchive"),
      action: z.enum(["archive", "unarchive"]).optional().default("archive").describe("'archive' or 'unarchive'"),
      // Keep backward compat
      undo: z.boolean().optional().describe("Deprecated — use action instead"),
    },
    async ({ thread_id, action, undo }) => {
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

      const shouldUnarchive = action === "unarchive" || undo === true;
      const newState = shouldUnarchive ? "active" : "archived";
      db.updateThreadMemberState(thread_id, user.id, newState);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            thread_id,
            state: newState,
          }),
        }],
      };
    },
  );
}
