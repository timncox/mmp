import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { generateToken, hashToken } from "../lib/crypto.js";

export function registerRecoverTool(
  server: McpServer,
  db: Db,
  setUser?: (u: User) => void,
): void {
  server.registerTool("mmp-recover", {
    description: "Recover access to an MMP account using a recovery code. Issues a new token, invalidates the old one, and authenticates this session immediately.",
    inputSchema: {
      handle: z.string().describe("The handle of the account to recover"),
      recovery_code: z.string().describe("The recovery code issued at registration"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ handle, recovery_code }) => {
      const user = db.getUserByHandle(handle);
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Handle not found." }) }],
          isError: true,
        };
      }

      const codeHash = hashToken(recovery_code);
      if (codeHash !== user.recovery_code_hash) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid recovery code." }) }],
          isError: true,
        };
      }

      // Issue new token
      const newToken = generateToken();
      db.updateUser(user.id, { token_hash: hashToken(newToken) });

      // Upgrade this session
      const updatedUser = db.getUserById(user.id)!;
      if (setUser) setUser(updatedUser);

      const serverUrl = `https://mmp.chat/mcp?token=${newToken}`;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            handle,
            token: newToken,
            server_url: serverUrl,
            message: "Account recovered. This session is now authenticated — all tools work immediately. Save the token to your persistent memory. For future sessions, use the server_url with your token.",
          }),
        }],
      };
    },
  );
}
