# MMP Agent Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent-to-agent capabilities to MMP — profile types, capability advertisement, structured messages, synchronous invocation, and bot discovery.

**Architecture:** Extend the existing MMP server with 4 new database columns (2 on `users`, 2 on `messages`), modify 7 existing tools to pass through the new fields, add 2 new tools (`mmp-invoke`, `mmp-discover`), and add an in-memory pending-invoke map for synchronous call/response correlation.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Vitest, Zod, MCP SDK (Streamable HTTP)

---

## File Map

### Files to modify
- `server/lib/types.ts` — Add `type`, `capabilities` to `User`; `content_type`, `call_id` to `Message` and `WebhookPayload`
- `server/lib/db.ts` — Schema migrations, update `insertUser`/`insertMessage` prepared statements, add `ALLOWED_COLS` entries, add `discoverBots` method
- `server/lib/webhooks.ts` — Pass through `content_type` and `call_id` in webhook payload
- `server/tools/register.ts` — Accept optional `type` param
- `server/tools/profile.ts` — Accept `type` and `capabilities` params
- `server/tools/lookup.ts` — Return `type` and `capabilities`
- `server/tools/search-users.ts` — Include `type` in results
- `server/tools/reply.ts` — Pass default `content_type`/`call_id` to createMessage
- `server/tools/send.ts` — Accept `content_type` and `call_id`, pass to message and webhook
- `server/tools/inbox.ts` — Return `content_type` and `call_id` in message results
- `server/tools/thread.ts` — Return `content_type` and `call_id` in message results
- `server/server.ts` — Register new tools, export invoke pending map

### Files to create
- `server/lib/invoke-map.ts` — In-memory pending invoke map
- `server/tools/invoke.ts` — `mmp-invoke` synchronous tool call
- `server/tools/discover.ts` — `mmp-discover` bot search
- `server/tests/agent-protocol.test.ts` — Tests for all agent protocol features

---

### Task 1: Types and Database Schema

**Files:**
- Modify: `server/lib/types.ts`
- Modify: `server/lib/db.ts`

- [ ] **Step 1: Add new fields to types.ts**

Add `type` and `capabilities` to the `User` interface, `content_type` and `call_id` to `Message`, and update `WebhookPayload`:

```typescript
// In User interface, add after `status: string;`:
  type: "user" | "bot";
  capabilities: string; // JSON array stored as string

// In Message interface, add after `created_at: number;`:
  content_type: "text" | "tool_call" | "tool_result" | "authorization_request" | "authorization_grant";
  call_id: string | null;

// In WebhookPayload interface, add after `timestamp: number;`:
  content_type?: string;
  call_id?: string;
```

- [ ] **Step 2: Add schema migrations to db.ts**

In `createDb()`, after the existing migrations block (after the `starred` migration around line 289), add:

```typescript
  // Agent protocol: add type and capabilities to users
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has("type")) {
    db.exec("ALTER TABLE users ADD COLUMN type TEXT NOT NULL DEFAULT 'user'");
  }
  if (!userColNames.has("capabilities")) {
    db.exec("ALTER TABLE users ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'");
  }

  // Agent protocol: add content_type and call_id to messages
  const msgCols2 = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const msgColNames2 = new Set(msgCols2.map((c) => c.name));
  if (!msgColNames2.has("content_type")) {
    db.exec("ALTER TABLE messages ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text'");
  }
  if (!msgColNames2.has("call_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN call_id TEXT");
  }
```

- [ ] **Step 3: Update CREATE TABLE statements in db.ts**

In the `users` table creation SQL (around line 126-140), add before the closing paren:

```sql
      type TEXT NOT NULL DEFAULT 'user',
      capabilities TEXT NOT NULL DEFAULT '[]'
```

In the `messages` table creation SQL (around line 168-181), add before the closing paren:

```sql
      content_type TEXT NOT NULL DEFAULT 'text',
      call_id TEXT
```

- [ ] **Step 4: Update prepared statements in db.ts**

Update `insertUser` (around line 292) to include the new columns:

```typescript
    insertUser: db.prepare(`
      INSERT INTO users (id, handle, display_name, bio, privacy, status,
        public_key, private_key, client_public_key, token_hash,
        recovery_code_hash, type, capabilities, created_at, updated_at)
      VALUES (@id, @handle, @display_name, @bio, @privacy, @status,
        @public_key, @private_key, @client_public_key, @token_hash,
        @recovery_code_hash, @type, @capabilities, @created_at, @updated_at)
    `),
```

Update `insertMessage` (around line 339) to include the new columns:

```typescript
    insertMessage: db.prepare(`
      INSERT INTO messages (id, thread_id, from_user_id, to_user_id, reply_to,
        priority, ciphertext, nonce, sender_pub_key, encryption_mode, key_epoch,
        content_type, call_id, created_at)
      VALUES (@id, @thread_id, @from_user_id, @to_user_id, @reply_to,
        @priority, @ciphertext, @nonce, @sender_pub_key, @encryption_mode, @key_epoch,
        @content_type, @call_id, @created_at)
    `),
```

- [ ] **Step 5: Add `type` and `capabilities` to ALLOWED_COLS in updateUser**

In the `updateUser` method (around line 517), add to the `ALLOWED_COLS` set:

```typescript
      const ALLOWED_COLS = new Set([
        "handle", "display_name", "bio", "privacy", "status",
        "public_key", "private_key", "client_public_key",
        "token_hash", "recovery_code_hash",
        "type", "capabilities",
      ]);
```

- [ ] **Step 6: Add discoverBots method to Db interface and implementation**

In the `Db` interface (around line 30), add:

```typescript
  discoverBots(query: string, limit: number): User[];
```

Add a prepared statement in `stmts`:

```typescript
    discoverBots: db.prepare(
      `SELECT * FROM users WHERE type = 'bot' AND privacy != 'private'
       AND (handle LIKE ? OR display_name LIKE ? OR bio LIKE ? OR capabilities LIKE ?)
       LIMIT ?`
    ),
```

Add the implementation in the returned object:

```typescript
    discoverBots(query: string, limit: number): User[] {
      const pattern = `%${query}%`;
      return stmts.discoverBots.all(pattern, pattern, pattern, pattern, limit) as User[];
    },
```

- [ ] **Step 7: Commit**

```bash
git add server/lib/types.ts server/lib/db.ts
git commit -m "feat: add agent protocol types and database schema

Add type/capabilities columns to users table,
content_type/call_id columns to messages table,
discoverBots query method, and schema migrations."
```

---

### Task 2: Update register and profile tools

**Files:**
- Modify: `server/tools/register.ts`
- Modify: `server/tools/profile.ts`

- [ ] **Step 1: Update mmp-register to accept optional type**

In `register.ts`, add `type` to the `inputSchema` (after the `client_public_key` field):

```typescript
      type: z.enum(["user", "bot"]).optional().default("user").describe("Account type — 'user' for humans, 'bot' for automated agents"),
```

In the handler, update the `newUser` object (around line 67) to include:

```typescript
        type: type ?? "user",
        capabilities: "[]",
```

- [ ] **Step 2: Update mmp-set_profile to accept type and capabilities**

In `profile.ts`, add to the `inputSchema` of `mmp-set_profile` (after the `privacy` field):

```typescript
      type: z.enum(["user", "bot"]).optional().describe("Account type"),
      capabilities: z.string().optional().describe("JSON array of capabilities — each with name, description, optional input_schema, optional auth_required"),
```

In the handler, add to the `updates` block (after the `privacy` line):

```typescript
      if (type !== undefined) updates.type = type;
      if (capabilities !== undefined) {
        // Validate it's valid JSON array
        try {
          const parsed = JSON.parse(capabilities);
          if (!Array.isArray(parsed)) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "capabilities must be a JSON array." }) }],
              isError: true,
            };
          }
          updates.capabilities = capabilities;
        } catch {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "capabilities must be valid JSON." }) }],
            isError: true,
          };
        }
      }
```

Note: The destructured handler params need to include `type` and `capabilities`. Since `type` shadows the TypeScript keyword, use it directly — Zod handles the naming. Update the destructured params: `({ display_name, bio, status, privacy, type, capabilities })`.

- [ ] **Step 3: Commit**

```bash
git add server/tools/register.ts server/tools/profile.ts
git commit -m "feat: accept type and capabilities in register and profile tools"
```

---

### Task 3: Update lookup and search-users tools

**Files:**
- Modify: `server/tools/lookup.ts`
- Modify: `server/tools/search-users.ts`

- [ ] **Step 1: Return type and capabilities from mmp-lookup**

In `lookup.ts`, update the return object (around line 48) to include the new fields:

```typescript
              type: target.type,
              capabilities: JSON.parse(target.capabilities || "[]"),
```

Add these after the `privacy` field in the returned JSON object.

- [ ] **Step 2: Include type in mmp-search_users results**

In `search-users.ts`, update the `.map()` call (around line 32) to include:

```typescript
          type: u.type,
```

Add this after the `status` field in the mapped object.

- [ ] **Step 3: Commit**

```bash
git add server/tools/lookup.ts server/tools/search-users.ts
git commit -m "feat: return type and capabilities in lookup and search results"
```

---

### Task 4: Update mmp-send with content_type and call_id

**Files:**
- Modify: `server/tools/send.ts`
- Modify: `server/lib/webhooks.ts`

- [ ] **Step 1: Add content_type and call_id to mmp-send inputSchema**

In `send.ts`, add to the `inputSchema` (after the `thread_id` field):

```typescript
      content_type: z
        .enum(["text", "tool_call", "tool_result", "authorization_request", "authorization_grant"])
        .optional()
        .default("text")
        .describe("Message content type — 'text' for normal messages, 'tool_call'/'tool_result' for structured agent invocations"),
      call_id: z.string().optional().describe("Correlation ID for tool_call/tool_result messages"),
```

- [ ] **Step 2: Pass content_type and call_id through all createMessage calls**

In `send.ts`, every `db.createMessage()` call needs two new fields. There are 4 calls total — one for group fan-out (around line 123), one for the DM-in-group fallthrough, one for federated sends (around line 330), and one for local DM sends (around line 440).

Add to each `db.createMessage({...})` call:

```typescript
              content_type: content_type ?? "text",
              call_id: call_id ?? null,
```

Update the destructured handler params to include `content_type` and `call_id`:
`({ to, body, attachments, encrypted_payload, priority, thread_id, content_type, call_id })`

- [ ] **Step 3: Pass content_type and call_id in webhook payloads**

In `send.ts`, every `fireWebhook()` call includes a payload object. Add to each:

```typescript
                content_type: content_type ?? "text",
                call_id: call_id ?? undefined,
```

There are 3 `fireWebhook` calls: group recipients (around line 162), federated (not applicable — federated sends don't fire local webhooks), and local DM (around line 477).

- [ ] **Step 4: Update WebhookPayload type usage in webhooks.ts**

No code changes needed in `webhooks.ts` — the `WebhookPayload` type was already updated in Task 1 and the `fireWebhook` function just serializes whatever payload it receives. The new fields are optional on the type, so existing calls without them still work.

- [ ] **Step 5: Commit**

```bash
git add server/tools/send.ts server/lib/webhooks.ts
git commit -m "feat: add content_type and call_id to mmp-send and webhooks"
```

---

### Task 5: Update reply tool with content_type and call_id defaults

**Files:**
- Modify: `server/tools/reply.ts`

The `reply.ts` tool also calls `db.createMessage()` and `fireWebhook()`. Since reply messages will typically be text, we just need to pass the default values so the new columns are populated.

- [ ] **Step 1: Add content_type and call_id to createMessage in reply.ts**

In `reply.ts`, the `db.createMessage()` call (around line 118) needs two new fields. Add after `key_epoch: keyEpoch,`:

```typescript
          content_type: "text",
          call_id: null,
```

- [ ] **Step 2: Commit**

```bash
git add server/tools/reply.ts
git commit -m "feat: pass content_type and call_id defaults in reply tool"
```

---

### Task 6: Update inbox and thread tools

**Files:**
- Modify: `server/tools/inbox.ts`
- Modify: `server/tools/thread.ts`

- [ ] **Step 1: Return content_type and call_id from mmp-inbox**

In `inbox.ts`, update the `decryptedMessages.push()` call (around line 86). Add to the object being pushed:

```typescript
          content_type: msg.content_type ?? "text",
          call_id: msg.call_id ?? undefined,
```

Add these after the `encryption_mode` field.

- [ ] **Step 2: Return content_type and call_id from mmp-thread**

In `thread.ts`, update the message mapping (the `return` inside `deduped.map()`, around line 116). Add to the returned object:

```typescript
          content_type: msg.content_type ?? "text",
          call_id: msg.call_id ?? undefined,
```

Add these after the `encryption_mode` field.

- [ ] **Step 3: Commit**

```bash
git add server/tools/inbox.ts server/tools/thread.ts
git commit -m "feat: return content_type and call_id in inbox and thread results"
```

---

### Task 7: Invoke pending map

**Files:**
- Create: `server/lib/invoke-map.ts`

- [ ] **Step 1: Create invoke-map.ts**

```typescript
/**
 * In-memory map for pending mmp-invoke calls.
 * When mmp-invoke sends a tool_call, it registers a callback here.
 * When mmp-send stores a tool_result with a matching call_id, it resolves the callback.
 */

export interface PendingInvoke {
  resolve: (result: { output?: unknown; error?: string | null; authorization?: unknown }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingInvoke>();

export function registerPending(
  callId: string,
  timeoutMs: number,
  resolve: PendingInvoke["resolve"],
): void {
  const timer = setTimeout(() => {
    pending.delete(callId);
    resolve({ error: `__timeout__` });
  }, timeoutMs);

  pending.set(callId, { resolve, timer });
}

export function resolvePending(callId: string, result: { output?: unknown; error?: string | null; authorization?: unknown }): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(callId);
  entry.resolve(result);
  return true;
}

export function hasPending(callId: string): boolean {
  return pending.has(callId);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/invoke-map.ts
git commit -m "feat: add in-memory invoke pending map for synchronous tool calls"
```

---

### Task 8: Hook invoke-map into mmp-send

**Files:**
- Modify: `server/tools/send.ts`

- [ ] **Step 1: Import and call resolvePending in mmp-send**

At the top of `send.ts`, add:

```typescript
import { resolvePending } from "../lib/invoke-map.js";
```

After each `db.createMessage()` call for a **local DM** (around line 440) and **group** (around line 123), add a check: if the message has a `call_id` and `content_type` is `"tool_result"` or `"authorization_request"`, try to resolve a pending invoke.

For the local DM path, add right after `db.createMessage()` and before `db.updateThreadTimestamp()` (around line 453):

```typescript
      // Resolve pending invoke if this is a tool_result or authorization_request
      if (call_id && (content_type === "tool_result" || content_type === "authorization_request")) {
        try {
          const parsedBody = JSON.parse(body || "{}");
          if (content_type === "tool_result") {
            resolvePending(call_id, { output: parsedBody.output, error: parsedBody.error });
          } else {
            resolvePending(call_id, { authorization: parsedBody });
          }
        } catch {
          // Body wasn't valid JSON — don't resolve
        }
      }
```

For the group fan-out path, add a similar block after the group `db.createMessage()` loop (around line 155), but only resolve once (not per-recipient):

```typescript
      // Resolve pending invoke for group tool_results
      if (call_id && (content_type === "tool_result" || content_type === "authorization_request")) {
        try {
          const parsedBody = JSON.parse(body || "{}");
          if (content_type === "tool_result") {
            resolvePending(call_id, { output: parsedBody.output, error: parsedBody.error });
          } else {
            resolvePending(call_id, { authorization: parsedBody });
          }
        } catch {
          // Body wasn't valid JSON — don't resolve
        }
      }
```

- [ ] **Step 2: Commit**

```bash
git add server/tools/send.ts
git commit -m "feat: resolve pending invokes when tool_result messages are sent"
```

---

### Task 9: mmp-invoke tool

**Files:**
- Create: `server/tools/invoke.ts`
- Modify: `server/server.ts`

- [ ] **Step 1: Create invoke.ts**

```typescript
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
    description:
      "Invoke a capability on an MMP bot synchronously — sends a structured tool_call and waits for the bot's tool_result response. " +
      "Use mmp-discover to find bots and their capabilities first, or mmp-lookup to check a specific bot's capabilities.",
    inputSchema: {
      to: z.string().describe("Bot handle to invoke (e.g., '@squarespace')"),
      tool: z.string().describe("Capability name to invoke (must match a name in the bot's capabilities)"),
      input: z
        .record(z.unknown())
        .optional()
        .default({})
        .describe("Input data for the tool"),
      timeout: z
        .number()
        .optional()
        .default(30)
        .describe("Seconds to wait for response (default 30, max 60)"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ to, tool, input, timeout }) => {
    const user = getUser();
    if (!user) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
        isError: true,
      };
    }

    const effectiveTimeout = Math.min(Math.max(timeout ?? 30, 1), 60);
    const callId = uuidv4();

    // Resolve the target bot
    const parsed = parseHandle(to);
    if (parsed.isRemote) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Federated invoke is not yet supported. Use mmp-send with content_type 'tool_call' for remote bots." }) }],
        isError: true,
      };
    }

    const resolvedHandle = db.resolveHandle(parsed.user);
    const recipient = db.getUserByHandle(resolvedHandle);
    if (!recipient) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Bot '${to}' not found.` }) }],
        isError: true,
      };
    }

    if (recipient.type !== "bot") {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `'${resolvedHandle}' is not a bot. Use mmp-send for regular messages.` }) }],
        isError: true,
      };
    }

    // Build the tool_call body
    const bodyJson = JSON.stringify({ tool, call_id: callId, input: input ?? {} });

    // Encrypt
    const senderEpoch = db.getCurrentEpoch(user.id);
    const senderPrivateKey = senderEpoch?.private_key ?? user.private_key;
    const recipientEpoch = db.getCurrentEpoch(recipient.id);
    const recipientPubKey = recipientEpoch?.public_key ?? recipient.public_key;
    const keyEpoch = senderEpoch?.epoch ?? 0;

    const encrypted = encryptMessage(bodyJson, recipientPubKey, senderPrivateKey);

    // Find or create thread
    let threadId = db.findThreadBetweenUsers(user.id, recipient.id)?.id;
    const now = Math.floor(Date.now() / 1000);

    if (!threadId) {
      threadId = uuidv4();
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: `invoke:${tool}`,
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

    // Fire webhook to notify the bot
    fireWebhook(db, recipient.id, {
      event: "message.received",
      message_id: messageId,
      thread_id: threadId,
      from_handle: user.handle,
      to_handle: recipient.handle,
      priority: "normal",
      has_attachments: false,
      timestamp: now,
      content_type: "tool_call",
      call_id: callId,
    });

    // Wait for the bot to respond
    const startTime = Date.now();

    const result = await new Promise<{ output?: unknown; error?: string | null; authorization?: unknown }>((resolve) => {
      registerPending(callId, effectiveTimeout * 1000, resolve);
    });

    const durationMs = Date.now() - startTime;

    // Handle timeout
    if (result.error === "__timeout__") {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            call_id: callId,
            timeout: true,
            message: `Bot did not respond within ${effectiveTimeout}s. Check inbox for the result later.`,
            thread_id: threadId,
          }),
        }],
      };
    }

    // Handle authorization request
    if (result.authorization) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            call_id: callId,
            authorization_required: true,
            ...result.authorization as object,
          }),
        }],
      };
    }

    // Handle success or error
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          call_id: callId,
          output: result.output,
          error: result.error ?? null,
          from: resolvedHandle,
          duration_ms: durationMs,
        }),
      }],
    };
  });
}
```

- [ ] **Step 2: Register mmp-invoke in server.ts**

At the top of `server.ts`, add the import (after the other tool imports):

```typescript
import { registerInvokeTool } from "./tools/invoke.js";
```

In `createMcpServer()`, add after `registerDownloadTool` (around line 88):

```typescript
  registerInvokeTool(mcp, db, getUser);
```

- [ ] **Step 3: Commit**

```bash
git add server/tools/invoke.ts server/server.ts
git commit -m "feat: add mmp-invoke tool for synchronous bot invocation"
```

---

### Task 10: mmp-discover tool

**Files:**
- Create: `server/tools/discover.ts`
- Modify: `server/server.ts`

- [ ] **Step 1: Create discover.ts**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../lib/db.js";
import type { User } from "../lib/types.js";

export function registerDiscoverTool(
  server: McpServer,
  db: Db,
  getUser: () => User | null,
): void {
  server.registerTool("mmp-discover", {
    description:
      "Search for MMP bots by capability. Returns bots whose handle, name, bio, or capability descriptions match the query. " +
      "Use this to find bots that can perform specific tasks.",
    inputSchema: {
      query: z.string().describe("Search text to match against bot profiles and capabilities"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum results to return (default 10, max 50)"),
    },
    _meta: { ui: { resourceUri: "ui://mmp/inbox.html" } },
  }, async ({ query, limit }) => {
    const user = getUser();
    if (!user) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required." }) }],
        isError: true,
      };
    }

    const effectiveLimit = Math.min(Math.max(limit ?? 10, 1), 50);
    const results = db.discoverBots(query, effectiveLimit);

    const bots = results.map((bot) => {
      let capabilities: unknown[] = [];
      try {
        capabilities = JSON.parse(bot.capabilities || "[]");
      } catch {
        capabilities = [];
      }

      return {
        handle: bot.handle,
        display_name: bot.display_name,
        bio: bot.bio,
        status: bot.status,
        capabilities,
      };
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ bots, count: bots.length }),
      }],
    };
  });
}
```

- [ ] **Step 2: Register mmp-discover in server.ts**

At the top of `server.ts`, add the import:

```typescript
import { registerDiscoverTool } from "./tools/discover.js";
```

In `createMcpServer()`, add after the `registerInvokeTool` line:

```typescript
  registerDiscoverTool(mcp, db, getUser);
```

- [ ] **Step 3: Commit**

```bash
git add server/tools/discover.ts server/server.ts
git commit -m "feat: add mmp-discover tool for bot capability search"
```

---

### Task 11: Tests

**Files:**
- Create: `server/tests/agent-protocol.test.ts`

- [ ] **Step 1: Create test file with database and type tests**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "../lib/db.js";
import { registerPending, resolvePending, hasPending } from "../lib/invoke-map.js";
import { v4 as uuidv4 } from "uuid";
import { generateKeyPair, generateToken, hashToken, generateRecoveryCode, encryptMessage, decryptMessage } from "../lib/crypto.js";

function createTestUser(db: Db, handle: string, overrides: Record<string, unknown> = {}) {
  const keyPair = generateKeyPair();
  const token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: uuidv4(),
    handle,
    display_name: handle,
    bio: "",
    privacy: "public" as const,
    status: "",
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    client_public_key: null,
    token_hash: hashToken(token),
    recovery_code_hash: hashToken(generateRecoveryCode()),
    type: "user" as const,
    capabilities: "[]",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  db.createUser(user);
  return { user, token };
}

describe("Agent Protocol — Database", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("creates a user with type and capabilities", () => {
    const { user } = createTestUser(db, "testbot", {
      type: "bot",
      capabilities: JSON.stringify([{ name: "ping", description: "Pong" }]),
    });

    const fetched = db.getUserByHandle("testbot");
    expect(fetched).toBeDefined();
    expect(fetched!.type).toBe("bot");
    expect(JSON.parse(fetched!.capabilities)).toEqual([{ name: "ping", description: "Pong" }]);
  });

  it("defaults type to 'user' and capabilities to '[]'", () => {
    createTestUser(db, "alice");

    const fetched = db.getUserByHandle("alice");
    expect(fetched!.type).toBe("user");
    expect(fetched!.capabilities).toBe("[]");
  });

  it("updates type and capabilities via updateUser", () => {
    const { user } = createTestUser(db, "mybot");

    db.updateUser(user.id, {
      type: "bot",
      capabilities: JSON.stringify([{ name: "greet", description: "Say hello" }]),
    });

    const fetched = db.getUserByHandle("mybot");
    expect(fetched!.type).toBe("bot");
    expect(JSON.parse(fetched!.capabilities)).toHaveLength(1);
  });

  it("creates a message with content_type and call_id", () => {
    const { user: sender } = createTestUser(db, "sender");
    const { user: receiver } = createTestUser(db, "receiver");

    const threadId = uuidv4();
    db.createThread({
      id: threadId,
      type: "dm",
      name: "",
      subject: "test",
      created_by: sender.id,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    });
    db.addThreadMember(threadId, sender.id, "owner");
    db.addThreadMember(threadId, receiver.id);

    const callId = uuidv4();
    const encrypted = encryptMessage("test body", receiver.public_key, sender.private_key);

    db.createMessage({
      id: uuidv4(),
      thread_id: threadId,
      from_user_id: sender.id,
      to_user_id: receiver.id,
      reply_to: null,
      priority: "normal",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      sender_pub_key: encrypted.sender_public_key,
      encryption_mode: "server_assisted",
      key_epoch: 0,
      content_type: "tool_call",
      call_id: callId,
      created_at: Math.floor(Date.now() / 1000),
    });

    const messages = db.getMessagesForThread(threadId, 10);
    expect(messages).toHaveLength(1);
    expect(messages[0].content_type).toBe("tool_call");
    expect(messages[0].call_id).toBe(callId);
  });

  it("defaults content_type to 'text' and call_id to null", () => {
    const { user: sender } = createTestUser(db, "sender2");
    const { user: receiver } = createTestUser(db, "receiver2");

    const threadId = uuidv4();
    db.createThread({
      id: threadId,
      type: "dm",
      name: "",
      subject: "test",
      created_by: sender.id,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    });
    db.addThreadMember(threadId, sender.id, "owner");
    db.addThreadMember(threadId, receiver.id);

    const encrypted = encryptMessage("hello", receiver.public_key, sender.private_key);

    db.createMessage({
      id: uuidv4(),
      thread_id: threadId,
      from_user_id: sender.id,
      to_user_id: receiver.id,
      reply_to: null,
      priority: "normal",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      sender_pub_key: encrypted.sender_public_key,
      encryption_mode: "server_assisted",
      key_epoch: 0,
      content_type: "text",
      call_id: null,
      created_at: Math.floor(Date.now() / 1000),
    });

    const messages = db.getMessagesForThread(threadId, 10);
    expect(messages[0].content_type).toBe("text");
    expect(messages[0].call_id).toBeNull();
  });

  it("discovers bots by query", () => {
    createTestUser(db, "webbot", {
      type: "bot",
      capabilities: JSON.stringify([{ name: "update_page", description: "Edit website pages" }]),
      bio: "Manages websites",
    });
    createTestUser(db, "databot", {
      type: "bot",
      capabilities: JSON.stringify([{ name: "query_db", description: "Query databases" }]),
      bio: "Database helper",
    });
    createTestUser(db, "alice"); // regular user — should not appear

    const results = db.discoverBots("website", 10);
    expect(results).toHaveLength(1);
    expect(results[0].handle).toBe("webbot");
  });

  it("discovers bots by capability name", () => {
    createTestUser(db, "pagebot", {
      type: "bot",
      capabilities: JSON.stringify([{ name: "update_page", description: "Edit pages" }]),
    });

    const results = db.discoverBots("update_page", 10);
    expect(results).toHaveLength(1);
    expect(results[0].handle).toBe("pagebot");
  });

  it("excludes private bots from discover", () => {
    createTestUser(db, "secretbot", {
      type: "bot",
      privacy: "private",
      capabilities: JSON.stringify([{ name: "secret", description: "Hidden" }]),
    });

    const results = db.discoverBots("secret", 10);
    expect(results).toHaveLength(0);
  });
});

describe("Agent Protocol — Invoke Map", () => {
  it("registers and resolves a pending invoke", async () => {
    const callId = uuidv4();
    const promise = new Promise<{ output?: unknown; error?: string | null }>((resolve) => {
      registerPending(callId, 5000, resolve);
    });

    expect(hasPending(callId)).toBe(true);
    resolvePending(callId, { output: { success: true } });

    const result = await promise;
    expect(result.output).toEqual({ success: true });
    expect(hasPending(callId)).toBe(false);
  });

  it("times out if not resolved", async () => {
    const callId = uuidv4();
    const promise = new Promise<{ output?: unknown; error?: string | null }>((resolve) => {
      registerPending(callId, 50, resolve); // 50ms timeout
    });

    const result = await promise;
    expect(result.error).toBe("__timeout__");
    expect(hasPending(callId)).toBe(false);
  });

  it("returns false when resolving unknown call_id", () => {
    const resolved = resolvePending("nonexistent", { output: {} });
    expect(resolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/timcox/tim-os/mmp/server && npx vitest run tests/agent-protocol.test.ts`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/tests/agent-protocol.test.ts
git commit -m "test: add agent protocol tests for db, types, invoke map, and discovery"
```

---

### Task 12: Update MMP spec document

**Files:**
- Modify: `spec/MMP-SPEC.md`

- [ ] **Step 1: Add agent protocol section to the spec**

Add a new section at the end of the spec (before any appendices) titled `## 11. Agent Protocol`. Include:

- Section 11.1: Profile Extensions (type, capabilities)
- Section 11.2: Structured Content Types (content_type, call_id on messages)
- Section 11.3: mmp-invoke tool definition (input schema, output, behavior)
- Section 11.4: mmp-discover tool definition (input schema, output, behavior)
- Section 11.5: Authorization Flow (Path A: OAuth, Path B: in-conversation)

Reference the design spec at `docs/superpowers/specs/2026-03-31-agent-protocol-design.md` for the full content to add. The spec section should follow the same format as existing tool definitions in Section 7 (see 7.1, 7.2 as examples).

- [ ] **Step 2: Update the tool count in the spec**

The spec says "MMP defines 20 MCP tools" in Section 7. Update this to 22 (adding mmp-invoke and mmp-discover). Also update the README.md which says "MCP Tools (28)" — update to 30.

- [ ] **Step 3: Commit**

```bash
git add spec/MMP-SPEC.md README.md
git commit -m "docs: add agent protocol to MMP spec and update tool counts"
```

---

### Task 13: Verify build

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compilation**

Run: `cd /Users/timcox/tim-os/mmp/server && npx tsc --noEmit`

Expected: No errors. If there are type errors, fix them — the most likely issue is the `type` field name conflicting with TypeScript (it won't — `type` as a property name is fine in TS objects/interfaces, it's only reserved as a type-level keyword).

- [ ] **Step 2: Run all tests**

Run: `cd /Users/timcox/tim-os/mmp/server && npx vitest run`

Expected: All tests pass.

- [ ] **Step 3: Commit any fixes**

If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve build and test issues from agent protocol implementation"
```
