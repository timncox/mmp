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
    { name: "mmp", version: "1.0.0" },
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
app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MMP — MCP Messaging Protocol</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    h1 { font-size: 1.5rem; }
    p { line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>MMP Server</h1>
  <p>MCP Messaging Protocol reference implementation.</p>
  <p>Connect your MCP client to <code>POST /mcp</code> with a valid token.</p>
</body>
</html>`);
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

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MMP Invite</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
    h1 { font-size: 1.5rem; }
    p { line-height: 1.6; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>MMP Invite</h1>
  <p>${status}</p>
  <p>Invite code: <code>${code}</code></p>
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
  });

  const mcp = createMcpServer(getUser);
  await mcp.connect(transport);

  // Store transport by session ID after connection
  if (transport.sessionId) {
    transports.set(transport.sessionId, transport);
  }

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
const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen(PORT, () => {
  console.log(`MMP server listening on http://localhost:${PORT}`);
});
