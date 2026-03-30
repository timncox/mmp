import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import {
  generateKeyPair,
  generateToken,
  generateRecoveryCode,
  hashToken,
} from "../lib/crypto.js";

const HANDLE_RE = /^[a-z][a-z0-9_]{2,19}$/;

export function registerRegisterTool(
  server: McpServer,
  db: Db,
  setUser?: (u: import("../lib/types.js").User) => void,
): void {
  server.registerTool("mmp-register", {
    description: "Register a new MMP account. Returns a token, recovery code, and setup instructions. " +
      "CRITICAL: After calling this tool, you MUST (1) save the token and recovery_code to persistent memory, and " +
      "(2) tell the user to update their MCP server URL to include the token (the server_url field in the response). " +
      "Without the token in the URL, all other tools will fail with 'Authentication required'. " +
      "Show the user the full setup_instructions from the response.",
    inputSchema: {
      handle: z.string().describe("Desired handle (3-20 chars, lowercase alphanumeric + underscores, must start with a letter)"),
      client_public_key: z.string().optional().describe("Optional NaCl public key from the client for E2E encryption"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ handle, client_public_key }) => {
      // Validate handle format
      if (!HANDLE_RE.test(handle)) {
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

      // Check uniqueness
      const existing = db.getUserByHandle(handle);
      if (existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Handle already taken." }),
            },
          ],
          isError: true,
        };
      }

      const keyPair = generateKeyPair();
      const token = generateToken();
      const recoveryCode = generateRecoveryCode();
      const now = Math.floor(Date.now() / 1000);

      const userId = uuidv4();
      const newUser = {
        id: userId,
        handle,
        display_name: handle,
        bio: "",
        privacy: "public" as const,
        status: "",
        public_key: keyPair.publicKey,
        private_key: keyPair.privateKey,
        client_public_key: client_public_key ?? null,
        token_hash: hashToken(token),
        recovery_code_hash: hashToken(recoveryCode),
        created_at: now,
        updated_at: now,
      };

      db.createUser(newUser);

      // Upgrade this session — all tools work immediately, no reconnect needed
      if (setUser) setUser(newUser);

      const serverUrl = `https://mmp.chat/mcp?token=${token}`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              handle,
              token,
              recovery_code: recoveryCode,
              server_url: serverUrl,
              public_key: keyPair.publicKey,
              setup_instructions: [
                "1. SAVE the token and recovery_code to your persistent memory NOW.",
                "2. You're authenticated — all tools work in this session immediately.",
                `3. For FUTURE sessions, update your MCP server URL to include the token: ${serverUrl}`,
                "4. In Claude Desktop: Settings → MCP Servers → edit MMP → update the URL → restart.",
                "5. In Claude Code CLI: `claude mcp remove mmp` then `claude mcp add --transport http mmp \"" + serverUrl + "\"`",
              ],
            }),
          },
        ],
      };
    },
  );
}
