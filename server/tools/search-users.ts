import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerSearchUsersTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-search_users",
    "Search for users by handle or display name. Excludes private users from results.",
    {
      query: z.string().describe("Search query to match against handles and display names"),
    },
    async ({ query }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const results = db.searchUsers(query);

      // Exclude private users (unless they are the searching user)
      const filtered = results
        .filter((u) => u.privacy !== "private" || u.id === user.id)
        .map((u) => ({
          handle: u.handle,
          display_name: u.display_name,
          bio: u.bio,
          status: u.status,
        }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ users: filtered, count: filtered.length }),
          },
        ],
      };
    },
  );
}
