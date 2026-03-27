import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import { generateToken, hashToken } from "../lib/crypto.js";

export function registerRecoverTool(server: McpServer, db: Db): void {
  server.tool(
    "msg/recover",
    "Recover access to an MMP account using a recovery code. Issues a new token and invalidates the old one.",
    {
      handle: z.string().describe("The handle of the account to recover"),
      recovery_code: z.string().describe("The recovery code issued at registration"),
    },
    async ({ handle, recovery_code }) => {
      const user = db.getUserByHandle(handle);
      if (!user) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Handle not found." }),
            },
          ],
          isError: true,
        };
      }

      const codeHash = hashToken(recovery_code);
      if (codeHash !== user.recovery_code_hash) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Invalid recovery code." }),
            },
          ],
          isError: true,
        };
      }

      // Issue new token
      const newToken = generateToken();
      db.updateUser(user.id, { token_hash: hashToken(newToken) });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              handle,
              token: newToken,
              message:
                "Account recovered. Save the new token to your persistent memory. The old token is now invalid.",
            }),
          },
        ],
      };
    },
  );
}
