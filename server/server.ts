import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDb, type Db } from "./lib/db.js";
import { extractToken, authenticateUser } from "./lib/auth.js";
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

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const dbPath = process.env.MMP_DB_PATH || "./mmp.db";
export const db: Db = createDb(dbPath);

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------
export function createMcpServer(getUser: () => User | null): McpServer {
  const mcp = new McpServer(
    { name: "MMP-Messaging", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Unauthenticated tools
  registerRegisterTool(mcp, db);
  registerRecoverTool(mcp, db);

  // Authenticated tools
  registerSendTool(mcp, db, getUser);
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

  return mcp;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

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
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const token = extractToken(req);
  const user = authenticateUser(token, db);

  const getUser = (): User | null => user;

  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — create transport and MCP server
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      transports.set(sid, transport);
    },
  });

  const mcp = createMcpServer(getUser);
  await mcp.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
    }
  };

  await transport.handleRequest(req, res, req.body);
});

// Handle GET and DELETE for SSE streams
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
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
