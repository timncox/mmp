import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerLookupTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg-lookup",
    "Look up a user's profile and public keys by handle. Respects privacy levels.",
    {
      handle: z.string().describe("Handle of the user to look up"),
    },
    async ({ handle }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const resolvedHandle = db.resolveHandle(handle);
      const target = db.getUserByHandle(resolvedHandle);
      if (!target) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `User '${handle}' not found.` }) }],
          isError: true,
        };
      }

      // Respect privacy levels
      if (target.privacy === "private" && target.id !== user.id) {
        // Private users only visible to themselves
        if (!db.isContact(target.id, user.id)) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "This user's profile is private." }) }],
            isError: true,
          };
        }
      }

      const redirected = resolvedHandle !== handle;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              handle: target.handle,
              display_name: target.display_name,
              bio: target.bio,
              status: target.status,
              public_key: target.public_key,
              client_public_key: target.client_public_key,
              privacy: target.privacy,
              ...(redirected ? { redirected_from: handle } : {}),
            }),
          },
        ],
      };
    },
  );
}
