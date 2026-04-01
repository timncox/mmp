# MMP Agent Protocol — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Author:** Tim Cox + Claude

---

## 1. Problem

MCP (Model Context Protocol) installation and management is painful. Users must manually configure each MCP server in each AI client's settings — separate URLs, API keys, and config files per integration, per client. There is no discovery mechanism, no portable identity, and no way for an AI assistant to connect to new capabilities at runtime.

MMP already solves the transport problem: a user registers `@tim` once and can message from Claude, ChatGPT, Copilot, or any MCP client. Bots like `@squarespace`, `@nyc_civic`, and `@ticket_fighter` already provide capabilities through text-based conversation. But today, bots can't advertise what they can do, assistants can't discover bots programmatically, and all interaction is natural language text — unreliable for structured operations.

## 2. Vision

**MCPs become contacts, not installations.** Instead of configuring N MCP servers across M clients, the user has one MMP connection and reaches every bot through it. The assistant discovers bots, sees their capabilities, and invokes them through structured messages — all through the single MMP MCP server it already has.

Key properties:
- **Portable identity** — authorize a bot once as `@tim`, works from every AI client
- **Zero-install capabilities** — no MCP server to add, no config to edit, no API keys to manage
- **Discoverable** — assistants can search for bots by what they can do
- **Structured invocation** — typed tool calls with JSON input/output, not text parsing
- **Backward compatible** — existing bots and users are unaffected

## 3. Design

### 3.1 Profile Extensions

Add two fields to the user profile model:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | enum | `"user"` | `"user"` or `"bot"` |
| `capabilities` | JSON array | `[]` | Capabilities the account advertises |

#### Capability schema

```json
{
  "name": "update_page",
  "description": "Edit page content, sections, and blocks on a Squarespace site",
  "input_schema": {
    "page_id": { "type": "string", "required": true },
    "title": { "type": "string" },
    "body": { "type": "string" }
  },
  "auth_required": false
}
```

- `name` (string, required): Machine-readable identifier for the capability.
- `description` (string, required): Human-readable description of what the capability does.
- `input_schema` (object, optional): JSON object describing expected input fields with types. If present, assistants can send structured `tool_call` messages. If omitted, the capability is descriptive only.
- `auth_required` (boolean, optional, default `false`): Hints that first-use authorization is needed before this capability can be invoked.

#### How they're set

- `type` can be set at registration (new optional `type` parameter on `mmp-register`, defaults to `"user"`) or updated via `mmp-set_profile`.
- `capabilities` are set via `mmp-set_profile`. Bots typically call this on startup to advertise their current capabilities.

#### How they're read

- `mmp-lookup` returns `type` and `capabilities` in the response.
- `mmp-search_users` includes `type` in results.
- `mmp-discover` (new tool, see Section 3.4) searches across bot capabilities.

#### Database change

```sql
ALTER TABLE users ADD COLUMN type TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN capabilities TEXT DEFAULT '[]';
```

`capabilities` is stored as a JSON string.

### 3.2 Structured Message Content Types

Add a `content_type` field to messages. This field is part of the unencrypted envelope (alongside `priority`) so the server can route on it without decrypting. The body itself — whether text or JSON — is encrypted as before.

| content_type | Body format | Use case |
|---|---|---|
| `"text"` (default) | Plain text string | Normal human/bot conversation |
| `"tool_call"` | JSON object | Assistant invoking a bot capability |
| `"tool_result"` | JSON object | Bot returning a result |
| `"authorization_request"` | JSON object | Bot requesting user authorization |
| `"authorization_grant"` | JSON object | User approving authorization |

#### tool_call body

```json
{
  "tool": "update_page",
  "call_id": "550e8400-e29b-41d4-a716-446655440000",
  "input": {
    "page_id": "about",
    "title": "About Us",
    "body": "Welcome to our restaurant."
  }
}
```

- `tool` (string, required): Name of the capability to invoke, matching a `name` in the bot's `capabilities`.
- `call_id` (string, required): UUID v4 for correlating the call with its result.
- `input` (object, required): Input data matching the capability's `input_schema`.

#### tool_result body

```json
{
  "call_id": "550e8400-e29b-41d4-a716-446655440000",
  "output": {
    "success": true,
    "url": "https://example.com/about"
  },
  "error": null
}
```

- `call_id` (string, required): Matches the originating `tool_call`.
- `output` (object | null): Result data on success.
- `error` (string | null): Error description on failure.

#### authorization_request body

```json
{
  "request_id": "uuid",
  "service": "Squarespace",
  "scopes": ["read_pages", "write_pages"],
  "description": "Access to edit pages on your Squarespace site",
  "oauth_url": "https://squarespace.com/oauth/authorize?client_id=...&redirect_uri=..."
}
```

- `request_id` (string, required): UUID for correlating with a grant response.
- `service` (string, required): Human-readable name of the service.
- `scopes` (string array, required): Permissions being requested.
- `description` (string, required): Human-readable explanation for the user.
- `oauth_url` (string, optional): If present, the user must authorize via this URL (Path A). If absent, the bot accepts in-conversation grants (Path B).

#### authorization_grant body

```json
{
  "request_id": "uuid",
  "approved": true
}
```

- `request_id` (string, required): Matches the originating `authorization_request`.
- `approved` (boolean, required): Whether the user approved the request.

#### Backward compatibility

`content_type` defaults to `"text"`. Existing messages, tools, and bots that don't set it continue to work unchanged.

#### Database change

```sql
ALTER TABLE messages ADD COLUMN content_type TEXT DEFAULT 'text';
ALTER TABLE messages ADD COLUMN call_id TEXT;
```

#### Changes to `mmp-send`

Add optional parameters:
- `content_type` (enum, default `"text"`): The content type of the message.
- `call_id` (string, optional): Correlation ID, required when `content_type` is `"tool_call"` or `"tool_result"`.

When `content_type` is `"tool_call"` or `"tool_result"`, the `body` field is expected to be a JSON string. The server stores it the same way as text — encrypts and stores. No special server-side parsing needed.

#### Changes to `mmp-inbox` and `mmp-thread`

Return `content_type` and `call_id` in message results so clients can distinguish structured messages from text.

### 3.3 `mmp-invoke` — Synchronous Tool Invocation

New MCP tool that sends a structured tool call and waits for the result.

#### Input schema

```json
{
  "to": "@squarespace",
  "tool": "update_page",
  "input": { "page_id": "about", "title": "About Us" },
  "timeout": 30
}
```

- `to` (string, required): Bot handle to invoke.
- `tool` (string, required): Capability name to invoke.
- `input` (object, optional): Input data for the tool.
- `timeout` (integer, optional): Seconds to wait for a response. Default 30, max 60.

#### Output (success)

```json
{
  "call_id": "uuid",
  "output": { "success": true, "url": "https://example.com/about" },
  "from": "squarespace",
  "duration_ms": 1200
}
```

#### Output (timeout)

```json
{
  "call_id": "uuid",
  "timeout": true,
  "message": "Bot did not respond within 30s. Check inbox for the result later.",
  "thread_id": "uuid"
}
```

#### Output (authorization required)

```json
{
  "call_id": "uuid",
  "authorization_required": true,
  "service": "Squarespace",
  "scopes": ["read_pages", "write_pages"],
  "description": "Access to edit pages on your Squarespace site",
  "oauth_url": "https://squarespace.com/oauth/authorize?..."
}
```

When the bot replies with `content_type: "authorization_request"` instead of `tool_result`, the invoke returns the auth request to the caller.

#### Internal flow

1. Generate a `call_id` (UUID v4).
2. Create a message with `content_type: "tool_call"`, `call_id`, and the JSON body `{ tool, call_id, input }`.
3. Send the message to the bot via normal `mmp-send` logic (encryption, threading, webhook).
4. Register a pending callback in an in-memory `Map<call_id, { resolve, reject, timer }>`.
5. Start a timeout timer.
6. When `mmp-send` is called by the bot with `content_type: "tool_result"` (or `"authorization_request"`) and a matching `call_id`:
   - Resolve the pending callback with the result.
   - Clear the timeout timer.
   - The message is still stored in the thread for history.
7. If the timer fires before a response arrives, resolve with a timeout error.

#### Bot side

The bot's experience doesn't change architecturally. It receives a webhook with the tool_call, processes it, and calls `mmp-send` to reply with a `tool_result`. It doesn't need to know the caller is waiting synchronously.

### 3.4 `mmp-discover` — Bot Discovery

New MCP tool that searches for bots by capability.

#### Input schema

```json
{
  "query": "manage website",
  "limit": 10
}
```

- `query` (string, required): Search text to match against bot profiles and capabilities.
- `limit` (integer, optional): Maximum results to return. Default 10, max 50.

#### Output

```json
{
  "bots": [
    {
      "handle": "squarespace",
      "display_name": "Squarespace",
      "bio": "Manage your Squarespace website",
      "capabilities": [
        {
          "name": "update_page",
          "description": "Edit page content, sections, blocks",
          "input_schema": {
            "page_id": { "type": "string", "required": true },
            "title": { "type": "string" },
            "body": { "type": "string" }
          }
        },
        {
          "name": "manage_blog",
          "description": "Create, update, delete blog posts",
          "input_schema": {
            "action": { "type": "string", "required": true },
            "title": { "type": "string" },
            "body": { "type": "string" }
          }
        }
      ]
    }
  ]
}
```

#### Behavior

1. Filter to accounts where `type = 'bot'`.
2. Text search (SQL LIKE) across `handle`, `display_name`, `bio`, and capability `name` + `description` fields.
3. Respect privacy levels — private bots only visible to contacts.
4. Return results ordered by relevance (number of fields matched).

This is intentionally simple text matching. For v1, the bot ecosystem is small. Ranked results, categories, and semantic search can be added later.

### 3.5 Authorization Flow

Two paths, one protocol. Optional in v1.

#### Path A: OAuth redirect (third-party services)

1. Assistant calls `mmp-invoke` on a bot that requires auth.
2. Bot replies with `content_type: "authorization_request"` including `oauth_url`.
3. `mmp-invoke` returns the auth request to the assistant.
4. Assistant presents the OAuth URL to the user.
5. User authorizes in browser, bot receives OAuth callback.
6. Bot stores the grant keyed by the user's MMP handle/ID.
7. Assistant retries `mmp-invoke` — now it works.

#### Path B: In-conversation grant (MMP-native services)

1. Bot replies with `content_type: "authorization_request"` without `oauth_url`.
2. `mmp-invoke` returns the auth request to the assistant.
3. Assistant asks user: "NYC Civic Bot wants to access your location data. Approve?"
4. User approves.
5. Assistant sends `content_type: "authorization_grant"` with matching `request_id`.
6. Bot receives the grant, stores it, proceeds.

#### Portable authorization

Bots store auth grants keyed by MMP user ID, not by client. `@tim` authorizes once and it works from Claude, ChatGPT, or any other client. The bot's relationship is with the MMP identity, not the AI client.

#### V1 scope

Authorization message types are defined in the spec so bots can use them, but no existing bot is required to implement auth. Existing bots (nyc_civic, ticket_fighter, squarespace) are either operator-authorized or use public data.

### 3.6 Webhook Enhancement

The webhook payload gains two fields when a structured message is received:

```json
{
  "event": "message.received",
  "message_id": "uuid",
  "thread_id": "uuid",
  "from_handle": "tim",
  "to_handle": "squarespace",
  "content_type": "tool_call",
  "call_id": "uuid",
  "priority": "normal",
  "has_attachments": false,
  "timestamp": 1711500000
}
```

Existing webhooks that don't check `content_type` continue to work — the field is additive.

### 3.7 Bot Developer Experience

**Minimal bot with structured capabilities:**

```typescript
// On startup — advertise capabilities
await mmpClient.callTool("mmp-set_profile", {
  type: "bot",
  capabilities: JSON.stringify([
    {
      name: "update_page",
      description: "Edit page content on a Squarespace site",
      input_schema: {
        page_id: { type: "string", required: true },
        title: { type: "string" },
        body: { type: "string" }
      }
    }
  ])
});

// Webhook handler
app.post("/webhook/mmp", async (req, res) => {
  const payload = req.body;

  if (payload.content_type === "tool_call") {
    // Structured invocation
    const { tool, call_id, input } = JSON.parse(payload.body);

    let output;
    if (tool === "update_page") {
      output = await updatePage(input.page_id, input.title, input.body);
    } else {
      output = { error: `Unknown tool: ${tool}` };
    }

    await mmpClient.callTool("mmp-send", {
      to: `@${payload.from_handle}`,
      body: JSON.stringify({ call_id, output }),
      content_type: "tool_result",
      call_id,
    });
  } else {
    // Regular text message — handle as before
    await handleTextMessage(payload);
  }

  res.json({ ok: true });
});
```

**Key principles:**
- No SDK required. Bots are just HTTP servers that handle webhooks and call MMP tools.
- Bots can support both text and structured messages — text is the fallback.
- Existing bots are unchanged. They can adopt structured capabilities incrementally.

## 4. Summary of Changes

### Database

| Table | Column | Type | Default |
|-------|--------|------|---------|
| `users` | `type` | `TEXT` | `'user'` |
| `users` | `capabilities` | `TEXT` | `'[]'` |
| `messages` | `content_type` | `TEXT` | `'text'` |
| `messages` | `call_id` | `TEXT` | `NULL` |

### Modified tools (7)

| Tool | Change |
|---|---|
| `mmp-register` | Add optional `type` param |
| `mmp-set_profile` | Add `type` and `capabilities` params |
| `mmp-lookup` | Return `type` and `capabilities` |
| `mmp-search_users` | Include `type` in results |
| `mmp-send` | Add optional `content_type` and `call_id` params |
| `mmp-inbox` | Return `content_type` and `call_id` in messages |
| `mmp-thread` | Return `content_type` and `call_id` in messages |

### New tools (2)

| Tool | Purpose |
|---|---|
| `mmp-invoke` | Synchronous tool call — send tool_call, wait for tool_result |
| `mmp-discover` | Search bots by capability |

### Server-side additions

- **Invoke pending map:** In-memory `Map<string, { resolve, reject, timer }>` keyed by `call_id`. When `mmp-send` stores a `tool_result` with a `call_id` matching a pending invoke, it resolves the callback.
- **Webhook enhancement:** Payload includes `content_type` and `call_id` when applicable.

### What does NOT change

- Encryption — structured messages encrypted identically to text
- Threading — tool_call/tool_result messages live in normal threads
- Federation — structured messages federate the same way
- MCP App — inbox UI shows structured messages with appropriate formatting
- Existing bots — continue to work with text messages unchanged

## 5. Future Work (Out of Scope for V1)

- **Federated invoke** — `mmp-invoke` across federated servers
- **Bot categories** — structured taxonomy for `mmp-discover`
- **Semantic search** — vector-based capability discovery
- **Bot SDK** — npm package with helpers for common patterns
- **Capability versioning** — schema evolution for bot capabilities
- **Rate limiting per bot** — per-user rate limits on invoke calls
- **Bot verification** — verified badge for trusted bots
- **Streaming tool results** — for long-running operations that produce incremental output
