import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerStarTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-star",
    "Star or unstar a thread (toggle). Starred is independent of mute/archive state.",
    {
      thread_id: z.string().describe("Thread ID to star/unstar"),
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

      const newStarred = member.starred ? 0 : 1;
      db.raw.prepare("UPDATE thread_members SET starred = ? WHERE thread_id = ? AND user_id = ?")
        .run(newStarred, thread_id, user.id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            thread_id,
            starred: !!newStarred,
            state: member.state,
          }),
        }],
      };
    },
  );
}
