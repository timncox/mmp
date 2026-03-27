import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDb, type Db } from "./lib/db.js";
import { extractToken, authenticateUser } from "./lib/auth.js";
import { generateRecoveryCode, hashToken, decryptMessage } from "./lib/crypto.js";
import type { User } from "./lib/types.js";

// Tool registrations
import { registerRegisterTool } from "./tools/register.js";
import { registerRecoverTool } from "./tools/recover.js";
import { registerSendTool } from "./tools/send.js";
import { registerReplyTool } from "./tools/reply.js";
import { registerInboxTool } from "./tools/inbox.js";
import { registerThreadsTool } from "./tools/threads.js";
import { registerDigestTool } from "./tools/digest.js";
import { registerContactsTool } from "./tools/contacts.js";
import { registerLookupTool } from "./tools/lookup.js";
import { registerSearchUsersTool } from "./tools/search-users.js";
import { registerBlockTool } from "./tools/block.js";
import { registerInviteTool } from "./tools/invite.js";
import { registerProfileTool } from "./tools/profile.js";
import { registerOpenInboxTool } from "./tools/open-inbox.js";
import { registerMarkReadTool } from "./tools/mark-read.js";
import { registerArchiveTool } from "./tools/archive.js";
import { registerStarTool } from "./tools/star.js";
import { registerMuteTool } from "./tools/mute.js";
import { registerWhoamiTool } from "./tools/whoami.js";
import { registerThreadTool } from "./tools/thread.js";
import { registerCreateGroupTool } from "./tools/create-group.js";
import { registerAddMemberTool } from "./tools/add-member.js";
import { registerRemoveMemberTool } from "./tools/remove-member.js";
import { registerRotateKeysTool } from "./tools/rotate-keys.js";
import { registerSetWebhookTool } from "./tools/set-webhook.js";
import { mountFederationRoutes } from "./routes/federation.js";
import { checkRate } from "./lib/rate-limit.js";

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const dbPath = process.env.MMP_DB_PATH || "./mmp.db";
export const db: Db = createDb(dbPath);

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------
const SERVER_URL = process.env.MMP_SERVER_URL || `http://localhost:${parseInt(process.env.PORT || "3777", 10)}`;

export function createMcpServer(
  getUser: () => User | null,
  setUser?: (u: User) => void,
): McpServer {
  const mcp = new McpServer(
    { name: "MMP-Messaging", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Unauthenticated tools (with session upgrade on register/recover)
  registerRegisterTool(mcp, db, setUser);
  registerRecoverTool(mcp, db, setUser);

  // Authenticated tools
  registerSendTool(mcp, db, getUser, SERVER_URL);
  registerReplyTool(mcp, db, getUser);
  registerInboxTool(mcp, db, getUser);
  registerThreadsTool(mcp, db, getUser);
  registerDigestTool(mcp, db, getUser);
  registerContactsTool(mcp, db, getUser);
  registerLookupTool(mcp, db, getUser);
  registerSearchUsersTool(mcp, db, getUser);
  registerBlockTool(mcp, db, getUser);
  registerInviteTool(mcp, db, getUser);
  registerProfileTool(mcp, db, getUser);
  registerOpenInboxTool(mcp, db, getUser);
  registerMarkReadTool(mcp, db, getUser);
  registerArchiveTool(mcp, db, getUser);
  registerStarTool(mcp, db, getUser);
  registerMuteTool(mcp, db, getUser);
  registerWhoamiTool(mcp, db, getUser);
  registerThreadTool(mcp, db, getUser);
  registerCreateGroupTool(mcp, db, getUser);
  registerAddMemberTool(mcp, db, getUser);
  registerRemoveMemberTool(mcp, db, getUser);
  registerRotateKeysTool(mcp, db, getUser);
  registerSetWebhookTool(mcp, db, getUser);

  return mcp;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
// Capture raw body for federation signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

// REST API: digest endpoint for agents/automation
app.get("/api/digest", (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(401).json({ error: "Missing token parameter" }); return; }

  const user = authenticateUser(token, db);
  if (!user) { res.status(401).json({ error: "Invalid token" }); return; }

  const period = (req.query.period as string) || "24h";
  const now = Math.floor(Date.now() / 1000);
  let sinceTs: number;

  switch (period) {
    case "today": {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      sinceTs = Math.floor(todayStart.getTime() / 1000);
      break;
    }
    case "week": sinceTs = now - 7 * 86400; break;
    case "1h": sinceTs = now - 3600; break;
    default: sinceTs = now - 86400; break;
  }

  const threads = db.getThreadsForUser(user.id);
  const userCache = new Map<string, User>();
  userCache.set(user.id, user);
  const getHandle = (userId: string): string => {
    let u = userCache.get(userId);
    if (!u) { u = db.getUserById(userId); if (u) userCache.set(userId, u); }
    return u?.handle ?? "unknown";
  };

  let totalMessages = 0;
  let unreadCount = 0;
  let urgentCount = 0;
  const threadDigests: any[] = [];

  for (const thread of threads) {
    const messages = db.getMessagesForThread(thread.id, 500);
    const periodMessages = messages.filter((m) => m.created_at >= sinceTs);
    if (periodMessages.length === 0) continue;

    const member = db.getThreadMember(thread.id, user.id);
    const threadUnread = periodMessages.filter(
      (m) => member && m.created_at > member.last_read_at && m.from_user_id !== user.id,
    ).length;

    const decrypted = periodMessages.map((msg) => {
      let body: string | null;
      if (msg.encryption_mode === "server_assisted") {
        if (msg.to_user_id === user.id) {
          body = decryptMessage(msg.ciphertext, msg.nonce, msg.sender_pub_key, user.private_key);
        } else {
          const recipient = db.getUserById(msg.to_user_id);
          body = recipient ? decryptMessage(msg.ciphertext, msg.nonce, msg.sender_pub_key, recipient.private_key) : null;
        }
      } else {
        body = "[E2E encrypted]";
      }
      if (msg.priority === "urgent") urgentCount++;
      return {
        from: getHandle(msg.from_user_id),
        body,
        priority: msg.priority,
        time: new Date(msg.created_at * 1000).toISOString(),
      };
    });

    totalMessages += periodMessages.length;
    unreadCount += threadUnread;

    threadDigests.push({
      thread_id: thread.id,
      type: thread.type,
      name: thread.type === "group" ? thread.name : `@${thread.other_handle ?? "unknown"}`,
      unread: threadUnread,
      messages: decrypted,
    });
  }

  res.json({ period, stats: { total_messages: totalMessages, unread: unreadCount, urgent: urgentCount }, threads: threadDigests });
});

// Admin: reset recovery code (requires admin secret)
app.post("/admin/reset-recovery", (req, res) => {
  const secret = req.headers["x-admin-secret"] as string;
  if (secret !== process.env.MMP_ADMIN_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { handle } = req.body;
  if (!handle) { res.status(400).json({ error: "Missing handle" }); return; }
  const user = db.getUserByHandle(handle);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const newCode = generateRecoveryCode();
  db.updateUser(user.id, { recovery_code_hash: hashToken(newCode) });
  res.json({ handle, recovery_code: newCode });
});

// Federation routes
mountFederationRoutes(app, db, SERVER_URL);

// Health check
app.get("/health", (_req, res) => {
  const userCount = db.raw
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count: number };

  res.json({
    status: "ok",
    version: "1.0.0",
    users: userCount.count,
    uptime: process.uptime(),
  });
});

// Landing page
app.get("/", async (_req, res) => {
  try {
    const html = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./public/index.html", import.meta.url), "utf-8")
    );
    res.type("html").send(html);
  } catch {
    res.type("html").send("<h1>MMP — Model Messaging Protocol</h1><p>Server is running.</p>");
  }
});

// Protocol spec (rendered from markdown)
app.get("/spec", async (_req, res) => {
  try {
    const fs = await import("node:fs/promises");
    const { marked } = await import("marked");
    const md = await fs.readFile(new URL("../spec/MMP-SPEC.md", import.meta.url), "utf-8");
    const htmlContent = await marked.parse(md);
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MMP Specification — Model Messaging Protocol</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #e4e4e7; max-width: 800px; margin: 0 auto; padding: 40px 24px; line-height: 1.7; }
  pre { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; overflow-x: auto; font-family: ui-monospace, monospace; font-size: 13px; color: #a1a1aa; white-space: pre-wrap; }
  code { font-family: ui-monospace, monospace; font-size: 13px; background: #18181b; padding: 2px 6px; border-radius: 4px; color: #a1a1aa; }
  pre code { background: none; padding: 0; border-radius: 0; }
  a { color: #7dd3fc; }
  a:hover { text-decoration: underline; }
  h1, h2, h3, h4 { color: #fafafa; margin-top: 2em; margin-bottom: 0.5em; }
  h1 { font-size: 28px; border-bottom: 1px solid #27272a; padding-bottom: 12px; }
  h2 { font-size: 22px; border-bottom: 1px solid #18181b; padding-bottom: 8px; }
  h3 { font-size: 17px; }
  h4 { font-size: 15px; }
  p { margin: 12px 0; }
  ul, ol { margin: 12px 0; padding-left: 24px; }
  li { margin: 4px 0; }
  blockquote { border-left: 3px solid #3b82f6; margin: 16px 0; padding: 8px 16px; color: #a1a1aa; background: #18181b; border-radius: 0 8px 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #27272a; padding: 8px 12px; text-align: left; font-size: 13px; }
  th { background: #18181b; font-weight: 600; color: #fafafa; }
  td { color: #e4e4e7; }
  hr { border: none; border-top: 1px solid #27272a; margin: 32px 0; }
  img { max-width: 100%; }
  .back { display: inline-block; margin-bottom: 24px; color: #7dd3fc; font-size: 14px; text-decoration: none; }
  .back:hover { text-decoration: underline; }
</style>
</head>
<body>
<a href="/" class="back">&larr; Back to mmp.chat</a>
${htmlContent}
</body>
</html>`);
  } catch {
    res.status(404).send("Spec not found.");
  }
});

// Invite landing page
app.get("/invite/:code", (req, res) => {
  const code = req.params.code;
  const invite = db.getInvite(code);

  const status = !invite
    ? "Invalid invite code."
    : invite.claimed_by
      ? "This invite has already been claimed."
      : "This invite is valid. Use it in your MCP client to register.";

  const inviterHandle = invite ? db.getUserById(invite.created_by)?.handle : null;
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MMP Invite${inviterHandle ? ` from @${inviterHandle}` : ""}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #09090b; color: #e4e4e7; max-width: 520px; margin: 80px auto; padding: 0 24px; }
  h1 { font-size: 24px; margin-bottom: 16px; }
  p { line-height: 1.6; color: #a1a1aa; margin-bottom: 12px; }
  code { background: #18181b; border: 1px solid #27272a; padding: 2px 8px; border-radius: 4px; font-family: ui-monospace, monospace; color: #7dd3fc; }
  ol { color: #a1a1aa; line-height: 2; padding-left: 20px; }
  .badge { display: inline-block; font-size: 12px; color: #a1a1aa; border: 1px solid #27272a; border-radius: 20px; padding: 4px 14px; margin-bottom: 24px; }
</style>
</head>
<body>
<div class="badge">Model Messaging Protocol</div>
<h1>${inviterHandle ? `@${inviterHandle} invited you to MMP!` : "You've been invited to MMP!"}</h1>
<p>${status}</p>
<ol>
<li>Add this MCP server to your AI: <code>mmp.chat/mcp</code></li>
<li>Say <em>"Register as @yourname"</em></li>
<li>${inviterHandle ? `You'll be able to message @${inviterHandle} right away.` : "Start messaging!"}</li>
</ol>
<p style="font-size:13px;color:#52525b;margin-top:24px;">Works with Claude, ChatGPT, Copilot, Goose, and any MCP client.</p>
</body>
</html>`);
});

// MCP endpoint — per-request transport with auth
const MAX_SESSIONS = 1000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const transports = new Map<string, StreamableHTTPServerTransport>();
const sessionAuth = new Map<string, { user: User | null }>();
const sessionLastSeen = new Map<string, number>();

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [sid, lastSeen] of sessionLastSeen) {
    if (now - lastSeen > SESSION_TTL_MS) {
      transports.delete(sid);
      sessionAuth.delete(sid);
      sessionLastSeen.delete(sid);
    }
  }
}, 60_000);

app.post("/mcp", async (req, res) => {
  // Rate limit: 60 requests per minute per IP
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const rate = checkRate(`mcp:${clientIp}`, 60, 60_000);
  if (!rate.allowed) {
    res.status(429).json({ error: "Rate limited. Try again later.", retry_after_ms: rate.retryAfterMs });
    return;
  }

  const token = extractToken(req);
  const user = authenticateUser(token, db);

  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    sessionLastSeen.set(sessionId, Date.now());
    const auth = sessionAuth.get(sessionId);
    if (auth && user && !auth.user) {
      auth.user = user;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Reject new sessions if at capacity
  if (transports.size >= MAX_SESSIONS) {
    res.status(503).json({ error: "Server at session capacity. Try again later." });
    return;
  }

  // New session — create mutable auth state
  const auth = { user };
  const getUser = (): User | null => auth.user;
  const setUser = (u: User): void => { auth.user = u; };

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      transports.set(sid, transport);
      sessionAuth.set(sid, auth);
      sessionLastSeen.set(sid, Date.now());
    },
  });

  const mcp = createMcpServer(getUser, setUser);
  await mcp.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
      sessionAuth.delete(transport.sessionId);
      sessionLastSeen.delete(transport.sessionId);
    }
  };

  await transport.handleRequest(req, res, req.body);
});

// Handle GET for SSE streams — session required, or return server info
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    // No session — return server info instead of an error
    // This helps MCP clients that probe the endpoint before initializing
    res.status(200).json({
      name: "MMP-Messaging",
      version: "1.0.0",
      protocol: "mcp",
      transport: "streamable-http",
      instructions: "Send a POST with a JSON-RPC initialize request to begin a session.",
    });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "3777", 10);

app.listen(PORT, () => {
  console.log(`MMP server listening on http://localhost:${PORT}`);
});
