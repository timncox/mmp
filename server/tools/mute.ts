import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerMuteTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-mute", {
    description: "Mute or unmute a thread. Use action 'unmute' to restore.",
    inputSchema: {
      thread_id: z.string().describe("Thread ID to mute/unmute"),
      action: z.enum(["mute", "unmute"]).optional().default("mute").describe("'mute' or 'unmute'"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ thread_id, action }) => {
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

      const newState = action === "unmute" ? "active" : "muted";
      db.updateThreadMemberState(thread_id, user.id, newState);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ thread_id, state: newState }),
        }],
      };
    },
  );
}
