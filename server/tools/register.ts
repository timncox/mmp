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

export function registerRegisterTool(server: McpServer, db: Db): void {
  server.tool(
    "mmp-register",
    "Register a new MMP account. Returns a token and recovery code. " +
      "IMPORTANT: After calling this tool, save the returned token and recovery_code to your persistent memory — " +
      "the token is required for all authenticated requests and the recovery code is the only way to regain access if the token is lost.",
    {
      handle: z.string().describe("Desired handle (3-20 chars, lowercase alphanumeric + underscores, must start with a letter)"),
      client_public_key: z.string().optional().describe("Optional NaCl public key from the client for E2E encryption"),
    },
    async ({ handle, client_public_key }) => {
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

      db.createUser({
        id: uuidv4(),
        handle,
        display_name: handle,
        bio: "",
        privacy: "public",
        status: "",
        public_key: keyPair.publicKey,
        private_key: keyPair.privateKey,
        client_public_key: client_public_key ?? null,
        token_hash: hashToken(token),
        recovery_code_hash: hashToken(recoveryCode),
        created_at: now,
        updated_at: now,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              handle,
              token,
              recovery_code: recoveryCode,
              public_key: keyPair.publicKey,
              message:
                "Account created. Save the token and recovery_code to your persistent memory immediately.",
            }),
          },
        ],
      };
    },
  );
}
