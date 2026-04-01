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
  server.registerTool("mmp-thread", {
    description: "Get a single thread (DM or group) with all its messages. Returns thread metadata, messages (decrypted if server-assisted), member info, and attachment metadata.",
    inputSchema: {
      thread_id: z.string().describe("The thread ID to fetch"),
      limit: z.number().optional().default(30).describe("Max messages to return (default 30)"),
      before: z.number().optional().describe("Unix epoch seconds — only return messages before this timestamp"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ thread_id, limit, before }) => {
      const user = getUser();
      if (!user) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Not authenticated." }) }],
        };
      }

      const thread = db.getThread(thread_id);
      if (!thread) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Thread not found." }) }],
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
      const memberInfo = members.map((m) => {
        // Check if remote user
        if (m.user_id.startsWith("remote:")) {
          const remote = db.getRemoteUserById(m.user_id);
          return {
            handle: remote ? `${remote.handle}@${remote.server}` : m.user_id,
            display_name: remote?.display_name ?? m.user_id,
            role: m.role,
            public_key: remote?.public_key,
            federated: true,
          };
        }
        const u = db.getUserById(m.user_id);
        return {
          handle: u?.handle ?? "unknown",
          display_name: u?.display_name ?? "unknown",
          role: m.role,
          public_key: u?.public_key,
          client_public_key: u?.client_public_key,
        };
      });

      const rawMessages = db.getMessagesForThread(thread_id, (limit ?? 30) + 1, before);

      // Deduplicate fan-out messages for groups (same from_user + created_at)
      const seen = new Set<string>();
      const deduped = rawMessages.filter((msg) => {
        if (thread.type === "group") {
          // For groups, show the copy addressed to the current user (or from the current user)
          if (msg.from_user_id === user.id || msg.to_user_id === user.id) {
            const key = `${msg.from_user_id}:${msg.created_at}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }
          return false;
        }
        return true;
      });

      const hasMore = deduped.length > (limit ?? 30);
      const trimmed = hasMore ? deduped.slice(0, limit ?? 30) : deduped;

      const messages = trimmed.map((msg) => {
        const fromUser = db.getUserById(msg.from_user_id);
        const toUser = db.getUserById(msg.to_user_id);
        let body: string | null = null;

        if (msg.encryption_mode === "server_assisted") {
          if (msg.to_user_id === user.id) {
            // Use epoch-specific key if available
            const epoch = msg.key_epoch ? db.getKeyEpoch(user.id, msg.key_epoch) : null;
            const privKey = epoch?.private_key ?? user.private_key;
            body = decryptMessage(msg.ciphertext, msg.nonce, msg.sender_pub_key, privKey);
          } else {
            const recipient = db.getUserById(msg.to_user_id);
            if (recipient) {
              const epoch = msg.key_epoch ? db.getKeyEpoch(recipient.id, msg.key_epoch) : null;
              const privKey = epoch?.private_key ?? recipient.private_key;
              body = decryptMessage(msg.ciphertext, msg.nonce, msg.sender_pub_key, privKey);
            }
          }
        }

        // Get attachment metadata
        const attachments = db.getAttachmentsForMessage(msg.id);
        const attachmentInfo = attachments.length > 0
          ? attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              mime_type: a.mime_type,
              size_bytes: a.size_bytes,
            }))
          : undefined;

        return {
          id: msg.id,
          thread_id: msg.thread_id,
          from_handle: fromUser?.handle ?? "unknown",
          to_handle: thread.type === "group" ? undefined : (toUser?.handle ?? "unknown"),
          body,
          ciphertext: msg.encryption_mode === "e2e" ? msg.ciphertext : undefined,
          nonce: msg.encryption_mode === "e2e" ? msg.nonce : undefined,
          sender_pub_key: msg.encryption_mode === "e2e" ? msg.sender_pub_key : undefined,
          priority: msg.priority,
          encryption_mode: msg.encryption_mode,
          content_type: msg.content_type ?? "text",
          call_id: msg.call_id ?? undefined,
          reply_to: msg.reply_to,
          attachments: attachmentInfo,
          created_at: msg.created_at,
          created_at_iso: new Date(msg.created_at * 1000).toISOString(),
        };
      });

      const result: Record<string, unknown> = {
        id: thread.id,
        type: thread.type,
        subject: thread.subject,
        messages,
        has_more: hasMore,
        members: memberInfo,
        member_state: member.state,
      };

      if (thread.type === "group") {
        result.name = thread.name;
        result.member_count = members.length;
      } else {
        const other = memberInfo.find((m) => m.handle !== user.handle);
        result.other_handle = other?.handle ?? "unknown";
        result.other_public_key = other?.public_key;
        result.other_client_public_key = other?.client_public_key;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}
