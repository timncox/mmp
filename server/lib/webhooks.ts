import { createHmac } from "crypto";
import type { Db } from "./db.js";
import type { WebhookPayload } from "./types.js";

/**
 * Fire a webhook for a recipient if they have one configured.
 * Non-blocking — failures are logged but don't affect message delivery.
 */
export function fireWebhook(
  db: Db,
  recipientUserId: string,
  payload: WebhookPayload,
): void {
  const webhook = db.getWebhook(recipientUserId);
  if (!webhook) return;

  // Check if this event type is subscribed
  const events = webhook.events.split(",");
  if (!events.includes(payload.event)) return;

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", webhook.secret)
    .update(body)
    .digest("hex");

  // Fire and forget
  fetch(webhook.url, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      "X-MMP-Signature": signature,
      "X-MMP-Event": payload.event,
    },
    body,
  }).catch((err) => {
    console.error(`Webhook delivery failed for ${recipientUserId}:`, err.message);
  });
}
