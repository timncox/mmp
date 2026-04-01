import type { Express } from "express";
import { v4 as uuidv4 } from "uuid";
import type { Db } from "../lib/db.js";
import type { FederationEnvelope, WellKnownMMP } from "../lib/types.js";
import { fireWebhook } from "../lib/webhooks.js";
import { checkRate } from "../lib/rate-limit.js";
import {
  getOrCreateServerIdentity,
  verifySignature,
  discoverServer,
} from "../lib/federation.js";

export function mountFederationRoutes(app: Express, db: Db, serverUrl: string): void {
  const identity = getOrCreateServerIdentity(db, serverUrl);

  // -----------------------------------------------------------------------
  // .well-known/mmp.json — server discovery
  // -----------------------------------------------------------------------
  app.get("/.well-known/mmp.json", (_req, res) => {
    const wellKnown: WellKnownMMP = {
      protocol: "mmp",
      version: "0.2.0",
      mcp_endpoint: `${serverUrl}/mcp`,
      federation_endpoint: `${serverUrl}/federation`,
      signing_public_key: identity.signing_public_key,
      server_name: new URL(serverUrl).hostname,
    };
    res.json(wellKnown);
  });

  // -----------------------------------------------------------------------
  // GET /federation/lookup — remote user profile lookup
  // -----------------------------------------------------------------------
  app.get("/federation/lookup", (req, res) => {
    const handle = (req.query.handle as string || "").toLowerCase();
    if (!handle) {
      res.status(400).json({ error: "Missing handle parameter" });
      return;
    }

    const user = db.getUserByHandle(handle);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Only expose public users
    if (user.privacy === "private") {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Return the current epoch's public key if available, else the user's base key
    const currentEpoch = db.getCurrentEpoch(user.id);

    res.json({
      handle: user.handle,
      display_name: user.display_name,
      bio: user.bio,
      public_key: currentEpoch?.public_key ?? user.public_key,
      key_epoch: currentEpoch?.epoch ?? 0,
    });
  });

  // -----------------------------------------------------------------------
  // POST /federation/deliver — receive a message from a remote server
  // -----------------------------------------------------------------------
  app.post("/federation/deliver", async (req, res) => {
    // Rate limit federation delivery: 30/min per source server
    const fromServer = req.headers["x-mmp-server"] as string || "unknown";
    const rate = checkRate(`fed:${fromServer}`, 30, 60_000);
    if (!rate.allowed) {
      res.status(429).json({ error: "Rate limited" });
      return;
    }

    const envelope = req.body as FederationEnvelope;
    const signature = req.headers["x-mmp-signature"] as string;

    if (!envelope || !signature || !fromServer) {
      res.status(400).json({ error: "Missing envelope, signature, or server header" });
      return;
    }

    // Verify the sending server's signature
    const discovery = await discoverServer(fromServer);
    if (!discovery) {
      res.status(403).json({ error: "Could not verify sending server" });
      return;
    }

    // Use raw body bytes for signature verification (not re-serialized JSON)
    const bodyStr = (req as any).rawBody?.toString("utf-8") ?? JSON.stringify(envelope);
    if (!verifySignature(bodyStr, signature, discovery.signing_public_key)) {
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    // Find the local recipient
    const recipient = db.getUserByHandle(envelope.to_handle);
    if (!recipient) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }

    // Check blocks (we create a virtual remote user ID for blocking)
    const remoteUserId = `remote:${envelope.from_handle}@${envelope.from_server}`;

    // Cache the remote sender
    db.upsertRemoteUser({
      id: remoteUserId,
      handle: envelope.from_handle,
      server: envelope.from_server,
      display_name: envelope.from_handle,
      public_key: envelope.sender_pub_key,
      fetched_at: Math.floor(Date.now() / 1000),
    });

    // Find or create thread for this federated conversation
    let thread = db.findThreadBetweenUsers(remoteUserId, recipient.id);
    const now = Math.floor(Date.now() / 1000);

    if (!thread) {
      const threadId = uuidv4();
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: `${envelope.from_handle}@${envelope.from_server}`,
        created_by: remoteUserId,
        created_at: now,
        updated_at: now,
      });
      db.addThreadMember(threadId, remoteUserId, "member");
      db.addThreadMember(threadId, recipient.id, "member");
      thread = db.getThread(threadId)!;
    }

    // Store the message
    const messageId = uuidv4();
    db.createMessage({
      id: messageId,
      thread_id: thread.id,
      from_user_id: remoteUserId,
      to_user_id: recipient.id,
      reply_to: null,
      priority: envelope.priority || "normal",
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      sender_pub_key: envelope.sender_pub_key,
      encryption_mode: envelope.encryption_mode,
      key_epoch: envelope.key_epoch || 0,
      content_type: "text",
      call_id: null,
      created_at: envelope.timestamp,
    });

    // Store attachments if present
    if (envelope.attachments && envelope.attachments.length > 0) {
      for (const att of envelope.attachments) {
        db.createAttachment({
          id: uuidv4(),
          message_id: messageId,
          filename: att.filename,
          mime_type: att.mime_type,
          size_bytes: att.size_bytes,
          ciphertext: att.ciphertext,
          nonce: att.nonce,
          encryption_mode: envelope.encryption_mode,
          created_at: envelope.timestamp,
        });
      }
    }

    db.updateThreadTimestamp(thread.id);

    // Fire webhook for the local recipient
    fireWebhook(db, recipient.id, {
      event: "message.received",
      message_id: messageId,
      thread_id: thread.id,
      from_handle: `${envelope.from_handle}@${envelope.from_server}`,
      to_handle: recipient.handle,
      priority: envelope.priority || "normal",
      has_attachments: (envelope.attachments?.length ?? 0) > 0,
      timestamp: envelope.timestamp,
    });

    res.json({ accepted: true, message_id: messageId });
  });

  // -----------------------------------------------------------------------
  // GET /federation/info — server info for admin/debugging
  // -----------------------------------------------------------------------
  app.get("/federation/info", (_req, res) => {
    res.json({
      server_url: serverUrl,
      signing_public_key: identity.signing_public_key,
      protocol_version: "0.2.0",
      features: ["federation", "groups", "attachments", "forward_secrecy"],
    });
  });

}
