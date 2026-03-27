import { z } from "zod";
import { randomBytes } from "crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerSetWebhookTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.tool(
    "mmp-set-webhook",
    "Register a webhook URL to get notified in real-time when you receive messages. Great for agents that need push notifications instead of polling. Use action 'remove' to delete your webhook.",
    {
      url: z.string().url().optional().describe("HTTPS URL to receive webhook POST requests"),
      events: z
        .array(z.enum(["message.received", "message.sent"]))
        .optional()
        .default(["message.received"])
        .describe("Events to subscribe to"),
      action: z
        .enum(["set", "remove", "status"])
        .optional()
        .default("set")
        .describe("'set' to register, 'remove' to delete, 'status' to check current webhook"),
    },
    async ({ url, events, action }) => {
      const user = getUser();
      if (!user) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
          isError: true,
        };
      }

      if (action === "remove") {
        db.removeWebhook(user.id);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ removed: true }) }],
        };
      }

      if (action === "status") {
        const existing = db.getWebhook(user.id);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ webhook: null, note: "No webhook configured. Use mmp-set-webhook to register one." }) }],
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              url: existing.url,
              events: existing.events.split(","),
              created_at: existing.created_at,
            }),
          }],
        };
      }

      // Set webhook
      if (!url) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "URL is required when action is 'set'." }) }],
          isError: true,
        };
      }

      const secret = randomBytes(32).toString("hex");
      const now = Math.floor(Date.now() / 1000);

      db.setWebhook({
        user_id: user.id,
        url,
        secret,
        events: (events ?? ["message.received"]).join(","),
        created_at: now,
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            registered: true,
            url,
            events: events ?? ["message.received"],
            secret,
            note: "Save this secret — it's used to verify webhook signatures via HMAC-SHA256. Requests include X-MMP-Signature and X-MMP-Event headers.",
          }),
        }],
      };
    },
  );
}
