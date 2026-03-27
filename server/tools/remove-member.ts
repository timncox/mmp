import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerRemoveMemberTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-remove-member",
    "Remove a member from an MMP group thread, or leave the group yourself. Owners/admins can remove others. Any member can leave.",
    {
      thread_id: z.string().describe("Group thread ID"),
      handle: z.string().optional().describe("Handle to remove (omit to leave the group yourself)"),
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
      if (!callerMember) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "You are not a member of this group." }) }],
          isError: true,
        };
      }

      // Leave the group
      if (!handle || handle === user.handle) {
        if (callerMember.role === "owner") {
          // Transfer ownership to the next admin or oldest member
          const members = db.getThreadMembers(thread_id);
          const others = members.filter((m) => m.user_id !== user.id);
          if (others.length === 0) {
            // Last member — thread becomes empty
            db.removeThreadMember(thread_id, user.id);
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ left: true, thread_id, note: "Group is now empty." }) }],
            };
          }
          const newOwner = others.find((m) => m.role === "admin") || others[0];
          db.updateThreadMemberRole(thread_id, newOwner.user_id, "owner");
          const newOwnerUser = db.getUserById(newOwner.user_id);
          db.removeThreadMember(thread_id, user.id);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                left: true,
                thread_id,
                new_owner: newOwnerUser?.handle,
              }),
            }],
          };
        }

        db.removeThreadMember(thread_id, user.id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ left: true, thread_id }) }],
        };
      }

      // Remove another member
      if (!["owner", "admin"].includes(callerMember.role)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Only the group owner or admins can remove members." }) }],
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

      const targetMember = db.getThreadMember(thread_id, target.id);
      if (!targetMember) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `@${resolved} is not in this group.` }) }],
          isError: true,
        };
      }

      if (targetMember.role === "owner") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot remove the group owner." }) }],
          isError: true,
        };
      }

      db.removeThreadMember(thread_id, target.id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            removed: resolved,
            thread_id,
            member_count: db.getThreadMemberCount(thread_id),
          }),
        }],
      };
    },
  );
}
