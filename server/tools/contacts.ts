import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerContactsTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  // List contacts
  server.tool(
    "mmp-contacts",
    "List your contacts with their handles, display names, and nicknames.",
    {},
    async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const contacts = db.getContacts(user.id);
      const enriched = contacts.map((c) => {
        const contactUser = db.getUserById(c.contact_id);
        return {
          handle: contactUser?.handle ?? "unknown",
          display_name: contactUser?.display_name ?? "Unknown",
          nickname: c.nickname,
          added_at: c.created_at,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ contacts: enriched, count: enriched.length }),
          },
        ],
      };
    },
  );

  // Add contact
  server.tool(
    "mmp-add_contact",
    "Add a user to your contacts list by handle.",
    {
      handle: z.string().describe("Handle of the user to add as a contact"),
      nickname: z.string().optional().default("").describe("Optional nickname for the contact"),
    },
    async ({ handle, nickname }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const contactUser = db.getUserByHandle(handle);
      if (!contactUser) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${handle}' not found.` }) }],
          isError: true,
        };
      }

      if (contactUser.id === user.id) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot add yourself as a contact." }) }],
          isError: true,
        };
      }

      db.addContact({
        user_id: user.id,
        contact_id: contactUser.id,
        nickname: nickname ?? "",
        created_at: Math.floor(Date.now() / 1000),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              added: handle,
              message: `${handle} added to contacts.`,
            }),
          },
        ],
      };
    },
  );
}
