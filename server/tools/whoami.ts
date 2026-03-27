import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerWhoamiTool(
  server: McpServer,
  _db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-whoami",
    "Check your MMP identity — returns your handle, display name, and profile. Use this when the user asks 'who am I on MMP', 'what is my MMP username', or to verify authentication.",
    {},
    async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [{
            type: "text" as const,
            text: "Not authenticated. You need to register first with mmp-register.",
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            handle: user.handle,
            display_name: user.display_name,
            bio: user.bio,
            privacy: user.privacy,
            status: user.status,
            has_client_keys: !!user.client_public_key,
          }),
        }],
      };
    },
  );
}
