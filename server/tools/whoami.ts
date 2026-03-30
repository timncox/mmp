import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerWhoamiTool(
  server: McpServer,
  _db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-whoami", {
    description: "Check your MMP identity — returns your handle, display name, and profile. Use this when the user asks 'who am I on MMP', 'what is my MMP username', or to verify authentication.",
    inputSchema: {},
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "Not authenticated. Register first with mmp-register, or add your token to the server URL." }),
          }],
          isError: true,
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
