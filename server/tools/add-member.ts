import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerAddMemberTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-add-member",
    "Add a user to an MMP group thread. Only the group owner or admins can add members.",
    {
      thread_id: z.string().describe("Group thread ID"),
      handle: z.string().describe("Handle of user to add"),
    },
    async ({ thread_id, handle }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const thread = db.getThread(thread_id);
      if (!thread || thread.type !== "group") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Group thread not found." }) }],
          isError: true,
        };
      }

      const callerMember = db.getThreadMember(thread_id, user.id);
      if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Only the group owner or admins can add members." }) }],
          isError: true,
        };
      }

      const resolved = db.resolveHandle(handle);
      const target = db.getUserByHandle(resolved);
      if (!target) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${handle}' not found.` }) }],
          isError: true,
        };
      }

      const existing = db.getThreadMember(thread_id, target.id);
      if (existing) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `@${resolved} is already in this group.` }) }],
          isError: true,
        };
      }

      if (db.isBlocked(target.id, user.id)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot add @${resolved} — they have blocked you.` }) }],
          isError: true,
        };
      }

      db.addThreadMember(thread_id, target.id, "member");

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            added: resolved,
            thread_id,
            member_count: db.getThreadMemberCount(thread_id),
          }),
        }],
      };
    },
  );
}
