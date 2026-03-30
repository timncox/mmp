import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/;

export function registerProfileTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  // Set profile
  server.registerTool("mmp-set_profile", {
    description: "Update your profile information — display name, bio, status, or privacy level.",
    inputSchema: {
      display_name: z.string().optional().describe("Display name"),
      bio: z.string().optional().describe("Bio / description"),
      status: z.string().optional().describe("Status message"),
      privacy: z
        .enum(["public", "contacts_only", "private"])
        .optional()
        .describe("Privacy level"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ display_name, bio, status, privacy }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const updates: Partial<Omit<User, "id">> = {};
      if (display_name !== undefined) updates.display_name = display_name;
      if (bio !== undefined) updates.bio = bio;
      if (status !== undefined) updates.status = status;
      if (privacy !== undefined) updates.privacy = privacy;

      if (Object.keys(updates).length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No fields to update." }) }],
          isError: true,
        };
      }

      db.updateUser(user.id, updates);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              updated: Object.keys(updates),
              message: "Profile updated.",
            }),
          },
        ],
      };
    },
  );

  // Change handle
  server.registerTool("mmp-change_handle", {
    description: "Change your handle. The old handle will redirect to the new one for 30 days.",
    inputSchema: {
      new_handle: z.string().describe("New handle (3-20 chars, lowercase alphanumeric + underscores, must start with a letter)"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ new_handle }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      if (!HANDLE_RE.test(new_handle)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Invalid handle. Must be 3-20 characters, lowercase alphanumeric and underscores, starting with a letter.",
              }),
            },
          ],
          isError: true,
        };
      }

      if (new_handle === user.handle) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "New handle is the same as current handle." }) }],
          isError: true,
        };
      }

      // Check uniqueness
      const existing = db.getUserByHandle(new_handle);
      if (existing) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Handle already taken." }) }],
          isError: true,
        };
      }

      const oldHandle = user.handle;
      const now = Math.floor(Date.now() / 1000);
      const thirtyDays = 30 * 24 * 60 * 60;

      // Update user handle
      db.updateUser(user.id, { handle: new_handle });

      // Add redirect from old handle to new handle
      db.addHandleRedirect({
        old_handle: oldHandle,
        new_handle,
        redirects_until: now + thirtyDays,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              old_handle: oldHandle,
              new_handle,
              redirect_expires: new Date((now + thirtyDays) * 1000).toISOString(),
              message: `Handle changed from ${oldHandle} to ${new_handle}. Messages to ${oldHandle} will redirect for 30 days.`,
            }),
          },
        ],
      };
    },
  );
}
