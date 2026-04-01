import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerDiscoverTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-discover", {
    description: "Search for MMP bots by name, handle, bio, or capability. Returns public bots that can be invoked via mmp-invoke.",
    inputSchema: {
      query: z.string().describe("Search query — matched against handle, display name, bio, and capabilities"),
      limit: z.number().int().min(1).max(50).optional().default(10).describe("Maximum number of results to return (default 10, max 50)"),
    },
  }, async ({ query, limit }) => {
    const user = getUser();
    if (!user) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
        isError: true,
      };
    }

    const bots = db.discoverBots(query, limit ?? 10);

    const results = bots.map((bot) => ({
      handle: `@${bot.handle}`,
      display_name: bot.display_name,
      bio: bot.bio,
      status: bot.status,
      capabilities: (() => {
        try {
          return JSON.parse(bot.capabilities || "[]");
        } catch {
          return [];
        }
      })(),
    }));

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          bots: results,
          count: results.length,
        }),
      }],
    };
  });
}
