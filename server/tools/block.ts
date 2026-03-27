import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerBlockTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-block",
    "Block or unblock a user. Blocked users cannot send you messages. Use action 'unblock' to remove a block.",
    {
      handle: z.string().describe("Handle of the user to block/unblock"),
      action: z.enum(["block", "unblock"]).optional().default("block").describe("'block' to block, 'unblock' to remove block"),
    },
    async ({ handle, action }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const target = db.getUserByHandle(handle);
      if (!target) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${handle}' not found.` }) }],
          isError: true,
        };
      }

      if (target.id === user.id) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot block yourself." }) }],
          isError: true,
        };
      }

      if (action === "unblock") {
        db.removeBlock(user.id, target.id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ unblocked: handle }) }],
        };
      }

      db.addBlock({ user_id: user.id, blocked_id: target.id });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ blocked: handle }) }],
      };
    },
  );
}
