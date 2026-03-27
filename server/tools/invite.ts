import { z } from "zod";
import { randomBytes } from "crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

function generateInviteCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function registerInviteTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "msg-invite",
    "Generate an invite code that can be shared with someone to create an MMP account.",
    {},
    async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const code = generateInviteCode();
      const now = Math.floor(Date.now() / 1000);
      const host = process.env.MMP_HOST || "http://localhost:3001";

      db.createInvite({
        code,
        created_by: user.id,
        pending_message: null,
        created_at: now,
        claimed_by: null,
        claimed_at: null,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              invite_url: `${host}/invite/${code}`,
              code,
              message: "Share this invite link with someone to let them register.",
            }),
          },
        ],
      };
    },
  );
}
