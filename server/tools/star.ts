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
    "Star or unstar a thread (toggle). Primarily for MCP App use.",
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

      const newState = member.state === "starred" ? "active" : "starred";
      db.updateThreadMemberState(thread_id, user.id, newState);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              thread_id,
              state: newState,
              message: newState === "starred" ? "Thread starred." : "Thread unstarred.",
            }),
          },
        ],
      };
    },
  );
}
