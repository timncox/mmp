import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { generateKeyPair } from "../lib/crypto.js";

export function registerRotateKeysTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-rotate-keys",
    "Rotate your encryption keys for forward secrecy. Generates a new key pair — future messages use the new keys. Old keys are kept so historical messages can still be decrypted. Rotate periodically for better security.",
    {},
    async () => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      const now = Math.floor(Date.now() / 1000);

      // Get current epoch
      const currentEpoch = db.getCurrentEpoch(user.id);
      const newEpochNum = currentEpoch ? currentEpoch.epoch + 1 : 1;

      // If there was no epoch 0, create one from the user's original keys
      if (!currentEpoch) {
        db.createKeyEpoch({
          id: 0,
          user_id: user.id,
          epoch: 0,
          public_key: user.public_key,
          private_key: user.private_key,
          created_at: user.created_at,
          retired_at: now,
        });
      } else {
        // Retire the current epoch
        db.retireEpoch(user.id, currentEpoch.epoch);
      }

      // Generate new key pair
      const newKeys = generateKeyPair();

      // Create new epoch
      db.createKeyEpoch({
        id: 0, // auto-increment
        user_id: user.id,
        epoch: newEpochNum,
        public_key: newKeys.publicKey,
        private_key: newKeys.privateKey,
        created_at: now,
        retired_at: null,
      });

      // Update the user's current public key so new contacts/lookups get the latest
      db.updateUser(user.id, {
        public_key: newKeys.publicKey,
        private_key: newKeys.privateKey,
      });

      const epochs = db.getKeyEpochs(user.id);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            rotated: true,
            new_epoch: newEpochNum,
            total_epochs: epochs.length,
            new_public_key: newKeys.publicKey,
            note: "New messages will use the rotated keys. Old messages remain decryptable with historical keys.",
          }),
        }],
      };
    },
  );
}
