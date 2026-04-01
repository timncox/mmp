import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";
import { encryptMessage } from "../lib/crypto.js";
import { fireWebhook } from "../lib/webhooks.js";
import { registerPending } from "../lib/invoke-map.js";
import { parseHandle } from "../lib/federation.js";

export function registerInvokeTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-invoke", {
    description: "Invoke a capability on an MMP bot and wait for the result. Sends a tool_call message to the bot and blocks until the bot replies with a tool_result (or times out). Only works with local bots.",
    inputSchema: {
      to: z.string().describe("Handle of the bot to invoke (e.g. @weather_bot)"),
      tool: z.string().describe("Name of the capability/tool to invoke on the bot"),
      input: z.record(z.string(), z.unknown()).optional().describe("Input parameters to pass to the tool"),
      timeout: z.number().int().min(1).max(60).optional().default(30).describe("Seconds to wait for the bot's response (default 30, max 60)"),
    },
  }, async ({ to, tool, input, timeout }) => {
    const user = getUser();
    if (!user) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
        isError: true,
      };
    }

    // Parse handle — no federation support for invoke yet
    const parsed = parseHandle(to);
    if (parsed.isRemote) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Federated invoke is not yet supported. Only local bots can be invoked." }) }],
        isError: true,
      };
    }

    // Resolve handle redirects
    const resolvedHandle = db.resolveHandle(parsed.user);
    const recipient = db.getUserByHandle(resolvedHandle);
    if (!recipient) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Bot '${to}' not found.` }) }],
        isError: true,
      };
    }

    // Must be a bot
    if (recipient.type !== "bot") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `'${to}' is not a bot. mmp-invoke only works with bot accounts.` }) }],
        isError: true,
      };
    }

    if (recipient.id === user.id) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Cannot invoke yourself." }) }],
        isError: true,
      };
    }

    const callId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Build the tool_call body
    const toolCallBody = JSON.stringify({ tool, call_id: callId, input: input ?? {} });

    // Get sender's current key epoch
    const senderEpoch = db.getCurrentEpoch(user.id);
    const senderPrivateKey = senderEpoch?.private_key ?? user.private_key;
    const keyEpoch = senderEpoch?.epoch ?? 0;

    // Use recipient's current epoch key if available
    const recipientEpoch = db.getCurrentEpoch(recipient.id);
    const recipientPubKey = recipientEpoch?.public_key ?? recipient.public_key;

    // Encrypt the tool_call message
    const encrypted = encryptMessage(toolCallBody, recipientPubKey, senderPrivateKey);

    // Find or create DM thread between caller and bot
    let threadId: string;
    const existingThread = db.findThreadBetweenUsers(user.id, recipient.id);
    if (existingThread) {
      threadId = existingThread.id;
    } else {
      threadId = uuidv4();
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: `Invoke: ${tool}`,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      });
      db.addThreadMember(threadId, user.id, "owner");
      db.updateLastReadAt(threadId, user.id);
      db.addThreadMember(threadId, recipient.id);
    }

    // Store the tool_call message
    const messageId = uuidv4();
    db.createMessage({
      id: messageId,
      thread_id: threadId,
      from_user_id: user.id,
      to_user_id: recipient.id,
      reply_to: null,
      priority: "normal",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      sender_pub_key: encrypted.sender_public_key,
      encryption_mode: "server_assisted",
      key_epoch: keyEpoch,
      content_type: "tool_call",
      call_id: callId,
      created_at: now,
    });

    db.updateThreadTimestamp(threadId);

    // Notify the bot via webhook
    fireWebhook(db, recipient.id, {
      event: "message.received",
      message_id: messageId,
      thread_id: threadId,
      from_handle: user.handle,
      to_handle: recipient.handle,
      priority: "normal",
      has_attachments: false,
      content_type: "tool_call",
      call_id: callId,
      timestamp: now,
    });

    // Wait for the bot to respond via registerPending
    const timeoutMs = (timeout ?? 30) * 1000;
    const startMs = Date.now();

    const result = await new Promise<{ output?: unknown; error?: string | null; authorization?: unknown }>(
      (resolve) => {
        registerPending(callId, timeoutMs, resolve);
      },
    );

    const durationMs = Date.now() - startMs;

    // Timeout case
    if (result.error === "__timeout__") {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "timeout",
            call_id: callId,
            thread_id: threadId,
            message: `Bot did not respond within ${timeout ?? 30} seconds.`,
          }),
        }],
      };
    }

    // Authorization required
    if (result.authorization !== undefined) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "authorization_required",
            call_id: callId,
            thread_id: threadId,
            authorization: result.authorization,
            duration_ms: durationMs,
          }),
        }],
      };
    }

    // Error from bot
    if (result.error) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "error",
            call_id: callId,
            thread_id: threadId,
            error: result.error,
            duration_ms: durationMs,
          }),
        }],
        isError: true,
      };
    }

    // Success
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "ok",
          call_id: callId,
          thread_id: threadId,
          output: result.output,
          duration_ms: durationMs,
        }),
      }],
    };
  });
}
