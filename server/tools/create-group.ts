import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerCreateGroupTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-create-group",
    "Create a new MMP group thread. You become the owner. Add members by their @handles.",
    {
      name: z.string().min(1).max(100).describe("Group name"),
      members: z.array(z.string()).min(1).describe("Handles of users to add to the group"),
    },
    async ({ name, members: memberHandles }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      // Resolve all member handles
      const resolvedMembers: { handle: string; user: User }[] = [];
      for (const handle of memberHandles) {
        const resolved = db.resolveHandle(handle);
        const member = db.getUserByHandle(resolved);
        if (!member) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${handle}' not found.` }) }],
            isError: true,
          };
        }
        if (member.id === user.id) continue; // Skip self
        if (db.isBlocked(member.id, user.id)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot add @${resolved} — they have blocked you.` }) }],
            isError: true,
          };
        }
        resolvedMembers.push({ handle: resolved, user: member });
      }

      if (resolvedMembers.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Need at least one other member besides yourself." }) }],
          isError: true,
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const threadId = uuidv4();

      db.createThread({
        id: threadId,
        type: "group",
        name,
        subject: name,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      });

      // Add creator as owner
      db.addThreadMember(threadId, user.id, "owner");
      db.updateLastReadAt(threadId, user.id);

      // Add other members
      for (const m of resolvedMembers) {
        db.addThreadMember(threadId, m.user.id, "member");
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            thread_id: threadId,
            name,
            members: [user.handle, ...resolvedMembers.map((m) => m.handle)],
            member_count: resolvedMembers.length + 1,
          }),
        }],
      };
    },
  );
}
