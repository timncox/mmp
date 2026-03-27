import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { decryptMessage } from "../lib/crypto.js";

export function registerThreadTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-thread",
    "Get a single thread with all its messages. Returns thread metadata, messages (decrypted if server-assisted), and the other participant's info.",
    {
      thread_id: z.string().describe("The thread ID to fetch"),
    },
    async ({ thread_id }) => {
      const user = getUser();
      if (!user) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Not authenticated." }],
        };
      }

      const thread = db.getThread(thread_id);
      if (!thread) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Thread not found." }],
        };
      }

      const member = db.getThreadMember(thread_id, user.id);
      if (!member) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "You are not a member of this thread." }],
        };
      }

      const members = db.getThreadMembers(thread_id);
      const otherMemberId = members.find((m) => m.user_id !== user.id)?.user_id;
      const otherUser = otherMemberId ? db.getUserById(otherMemberId) : null;

      const rawMessages = db.getMessagesForThread(thread_id, 200);

      const messages = rawMessages.map((msg) => {
        const fromUser = db.getUserById(msg.from_user_id);
        const toUser = db.getUserById(msg.to_user_id);
        let body: string | null = null;

        if (msg.encryption_mode === "server_assisted") {
          if (msg.to_user_id === user.id) {
            // User is recipient — decrypt with sender's pubkey + our privkey
            body = decryptMessage(
              msg.ciphertext,
              msg.nonce,
              msg.sender_pub_key,
              user.private_key,
            );
          } else {
            // User is sender — decrypt with recipient's privkey + sender's pubkey
            const recipient = db.getUserById(msg.to_user_id);
            if (recipient) {
              body = decryptMessage(
                msg.ciphertext,
                msg.nonce,
                msg.sender_pub_key,
                recipient.private_key,
              );
            }
          }
        }

        return {
          id: msg.id,
          thread_id: msg.thread_id,
          from_handle: fromUser?.handle ?? "unknown",
          to_handle: toUser?.handle ?? "unknown",
          body,
          ciphertext: msg.encryption_mode === "e2e" ? msg.ciphertext : undefined,
          nonce: msg.encryption_mode === "e2e" ? msg.nonce : undefined,
          sender_pub_key: msg.encryption_mode === "e2e" ? msg.sender_pub_key : undefined,
          priority: msg.priority,
          encryption_mode: msg.encryption_mode,
          reply_to: msg.reply_to,
          created_at: msg.created_at,
        };
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: thread.id,
            subject: thread.subject,
            messages,
            other_handle: otherUser?.handle ?? "unknown",
            other_public_key: otherUser?.public_key,
            other_client_public_key: otherUser?.client_public_key,
            member_state: member.state,
          }),
        }],
      };
    },
  );
}
