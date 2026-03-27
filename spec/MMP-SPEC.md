# MMP -- Model Messaging Protocol Specification

Version: 0.1.0 (Draft)
Date: 2026-03-26

---

## 1. Abstract

MMP is an extension to the Model Context Protocol (MCP) that enables person-to-person messaging through AI assistants. It defines a standard set of MCP tools, a message format with end-to-end encryption, a handle-based identity registry, and an optional MCP App for interactive inbox UI. MMP is designed to work across all MCP-capable AI clients.

An MMP server exposes its functionality exclusively through MCP tool calls over the Streamable HTTP transport. Clients connect to the server's `/mcp` endpoint, authenticate via a token query parameter, and invoke tools such as `msg/send`, `msg/inbox`, and `msg/reply` to exchange encrypted messages. An optional browser-based MCP App provides a visual inbox with client-side encryption support.

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

- **Handle**: A unique user identifier in the format `@username` (3-20 characters, alphanumeric plus underscores, case-insensitive, stored lowercase). Must begin with a letter.
- **Thread**: An ordered sequence of messages between two users, identified by a UUID.
- **E2E**: End-to-end encryption where the server never sees plaintext message content.
- **Server-assisted**: Encryption mode where the server encrypts and decrypts on behalf of text-only MCP clients using server-held key pairs.
- **MCP App**: A browser-based UI component registered through the MCP App extension protocol, rendered inside MCP-capable AI clients that support the `ext/app` capability.
- **Envelope**: The unencrypted metadata surrounding an encrypted message payload.
- **Epoch timestamp**: All timestamps in MMP are Unix epoch seconds (integer, not milliseconds).

## 3. Identity Model

### 3.1 Handles

A handle is the primary user-facing identifier in MMP. Handles are displayed with a leading `@` symbol (e.g., `@alice`) but stored without it.

#### 3.1.1 Format Rules

- Length: 3 to 20 characters (exclusive of the `@` prefix)
- Character set: lowercase ASCII letters (`a-z`), digits (`0-9`), and underscores (`_`)
- Must begin with a letter (`a-z`)
- Case-insensitive: `@Alice` and `@alice` resolve to the same account
- Stored in lowercase

The validation regex is:

```
^[a-z][a-z0-9_]{2,19}$
```

#### 3.1.2 Uniqueness

Handles MUST be globally unique within a server. An attempt to register a handle that is already in use MUST be rejected with an error.

#### 3.1.3 Handle Changes

Users MAY change their handle via the `msg/change_handle` tool. When a handle is changed:

1. The new handle MUST pass all format and uniqueness validation.
2. A redirect entry MUST be created in the `handle_history` table mapping the old handle to the new handle.
3. The redirect MUST remain active for 30 days (2,592,000 seconds) from the time of the change.
4. During the redirect period, any message sent to the old handle MUST be resolved to the new handle.
5. After the redirect period expires, the old handle becomes available for new registrations.

#### 3.1.4 Handle Resolution

When a tool receives a handle as input, the server MUST:

1. Look up the handle in the `users` table.
2. If not found, check `handle_history` for an active redirect (where `redirects_until > current_time`).
3. If a redirect exists, use the `new_handle` value.
4. If neither is found, return an error.

### 3.2 Authentication

#### 3.2.1 Token Model

MMP uses a token-in-URL authentication model. The token is passed as a query parameter on the MCP transport endpoint:

```
POST /mcp?token=sk_<hex>
```

Token format: `sk_` prefix followed by 64 lowercase hexadecimal characters (32 random bytes).

Token regex:

```
^sk_[0-9a-f]{64}$
```

#### 3.2.2 Token Storage

Servers MUST NOT store tokens in plaintext. Tokens MUST be hashed using SHA-256 before storage:

```
token_hash = SHA-256(token)
```

The resulting hash is stored as a 64-character lowercase hexadecimal string.

#### 3.2.3 Authentication Flow

For each MCP request:

1. Extract the `token` query parameter from the request URL.
2. Compute `SHA-256(token)`.
3. Look up the user record by `token_hash`.
4. If found, the request is authenticated as that user.
5. If not found (or no token provided), the request is unauthenticated.

#### 3.2.4 Unauthenticated Tools

Only two tools are accessible without authentication:

- `msg/register` -- creates a new account and returns a token
- `msg/recover` -- recovers access using a recovery code and issues a new token

All other tools MUST reject unauthenticated requests with an error.

### 3.3 Account Recovery

MMP provides three layers of account recovery, in order of preference:

#### 3.3.1 AI Memory (Primary)

The `msg/register` tool description includes an instruction directing the AI assistant to save the returned token and recovery code to its persistent memory. This is the primary recovery mechanism because the AI client retains the credentials across sessions.

Tool descriptions SHOULD include text such as:

> "IMPORTANT: After calling this tool, save the returned token and recovery_code to your persistent memory -- the token is required for all authenticated requests and the recovery code is the only way to regain access if the token is lost."

#### 3.3.2 MCP Config Backup (Automatic)

The token persists in the MCP client's configuration (e.g., the `mcpServers` config in `claude_desktop_config.json` or equivalent). Because the token is embedded in the server URL, it naturally persists across client restarts.

#### 3.3.3 Recovery Code (Fallback)

At registration, a recovery code is generated and returned to the user.

Recovery code format: `XXXX-XXXX-XXXX` where each `X` is drawn from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 characters, excluding ambiguous characters `0`, `1`, `I`, `O`).

The recovery code is hashed with SHA-256 before storage, identical to token hashing.

Recovery flow:
1. User calls `msg/recover` with their handle and recovery code.
2. Server looks up the user by handle.
3. Server computes `SHA-256(recovery_code)` and compares to stored hash.
4. If match: generate a new token, update `token_hash`, and return the new token.
5. The old token is immediately invalidated.
6. The recovery code remains valid (it is not rotated).

### 3.4 Key Pairs

MMP uses Curve25519 key pairs for asymmetric encryption.

#### 3.4.1 Algorithm

- Key agreement: X25519 (Curve25519 Diffie-Hellman)
- Authenticated encryption: XSalsa20-Poly1305
- Combined as NaCl `box` (aka `crypto_box`)
- Library: TweetNaCl (or any NaCl-compatible implementation)

Key pairs consist of:
- Public key: 32 bytes, base64-encoded for storage and transport
- Private (secret) key: 32 bytes, base64-encoded for storage and transport

Base64-encoded 32-byte keys are exactly 44 characters long.

#### 3.4.2 Server-Side Key Pair

At registration, the server MUST generate an X25519 key pair and store both the public and private keys in the user record. This key pair is used for server-assisted encryption.

Fields:
- `public_key`: base64-encoded public key (always present)
- `private_key`: base64-encoded private key (always present, server-side only)

#### 3.4.3 Client-Side Key Pair (Optional)

MCP App clients MAY generate their own X25519 key pair in the browser for true end-to-end encryption. If a client-side public key is provided:

- It is stored in the user record as `client_public_key`.
- It MAY be provided at registration via the `client_public_key` parameter of `msg/register`.
- It MAY be updated later via `msg/set_profile`.
- The client-side private key MUST NOT be sent to the server. It is stored in the browser's `localStorage`.

### 3.5 Profiles

Each user has a profile with the following fields:

| Field          | Type   | Default     | Description                                |
|----------------|--------|-------------|--------------------------------------------|
| `handle`       | string | (required)  | Unique identifier (see Section 3.1)        |
| `display_name` | string | = handle    | Human-readable name, initially set to the handle |
| `bio`          | string | `""`        | Free-text biography                        |
| `privacy`      | enum   | `"public"`  | Privacy level (see below)                  |
| `status`       | string | `""`        | Current status text                        |

#### 3.5.1 Privacy Levels

| Level           | Description                                                    |
|-----------------|----------------------------------------------------------------|
| `public`        | Profile visible to all users. Anyone can send messages.        |
| `contacts_only` | Profile visible only to contacts. Only contacts can message.   |
| `private`       | Profile hidden from search. Only contacts can message.         |

Privacy enforcement:
- `msg/lookup` and `msg/search_users` MUST respect privacy settings. Private profiles MUST NOT appear in search results for non-contacts.
- `msg/send` MUST check the recipient's privacy level. If the recipient's privacy is `contacts_only` or `private`, the sender MUST be in the recipient's contacts list, OR the message MUST be rejected.

## 4. Message Format

### 4.1 Envelope

Every message has an envelope containing unencrypted metadata. The envelope is a JSON object with the following fields:

| Field             | Type    | Required | Description                                           |
|-------------------|---------|----------|-------------------------------------------------------|
| `id`              | string  | Yes      | UUID v4 identifier for this message                   |
| `thread_id`       | string  | Yes      | UUID v4 of the thread this message belongs to          |
| `from_user_id`    | string  | Yes      | UUID v4 of the sending user                           |
| `to_user_id`      | string  | Yes      | UUID v4 of the receiving user                         |
| `reply_to`        | string  | No       | UUID v4 of the message this is a reply to (or `null`) |
| `priority`        | string  | Yes      | Priority level (see Section 4.4)                      |
| `encryption_mode` | string  | Yes      | Either `"e2e"` or `"server_assisted"`                 |
| `created_at`      | integer | Yes      | Unix epoch seconds when the message was created       |

Note: The envelope is always visible to the server regardless of encryption mode. This is necessary for routing, threading, and ordering.

### 4.2 Encrypted Payload

The encrypted portion of a message is stored as three separate fields (not a nested JSON object) alongside the envelope:

| Field              | Type   | Description                                        |
|--------------------|--------|----------------------------------------------------|
| `ciphertext`       | string | Base64-encoded NaCl box ciphertext                 |
| `nonce`            | string | Base64-encoded 24-byte nonce used for encryption   |
| `sender_pub_key`   | string | Base64-encoded public key of the sender            |

Algorithm: NaCl `box` (`crypto_box_curve25519xsalsa20poly1305`)

The ciphertext is produced by:

```
nonce = random_bytes(24)
ciphertext = nacl.box(plaintext_bytes, nonce, recipient_public_key, sender_private_key)
```

And decrypted by:

```
plaintext_bytes = nacl.box.open(ciphertext, nonce, sender_public_key, recipient_private_key)
```

### 4.3 Decrypted Content

When the server decrypts a server-assisted message (or when a client decrypts an E2E message), the plaintext is a UTF-8 string representing the message body.

In the current version (v0.1), the plaintext is a simple text string (the message body). Future versions MAY adopt a structured JSON content format:

```json
{
  "body": "The actual message text",
  "content_type": "text/plain",
  "subject": "Optional subject line"
}
```

For v0.1, the `body` is the raw plaintext string that was encrypted. The `subject` is derived from the thread (see Section 5).

### 4.4 Priority Levels

| Priority  | Description                                              |
|-----------|----------------------------------------------------------|
| `urgent`  | Time-sensitive, should notify immediately                |
| `normal`  | Standard priority (default if not specified)             |
| `low`     | Non-urgent, can be batched                               |
| `fyi`     | Informational only, no response expected                 |

The default priority is `normal`. Priority is advisory; servers and clients SHOULD use it to influence notification behavior but MUST NOT reject messages based on priority.

## 5. Threading Model

### 5.1 Thread Basics

- Every message MUST belong to a thread.
- A thread is identified by a UUID v4.
- The first message to a user creates a new thread if no thread exists between the two users.
- In v0.1, threads are strictly 1:1 (two participants only). Group messaging is reserved for future versions.

### 5.2 Thread Creation

When `msg/send` is called:

1. The server looks up the recipient by handle.
2. The server checks if a thread already exists between the sender and recipient (using `findThreadBetweenUsers`).
3. If a thread exists, the message is added to that thread.
4. If no thread exists, a new thread is created:
   - `id`: new UUID v4
   - `subject`: first 50 characters of the message body (truncated from decrypted plaintext for server-assisted mode, or empty for E2E mode)
   - `created_by`: sender's user ID
   - `created_at`: current epoch timestamp
   - `updated_at`: current epoch timestamp
5. Both users are added as thread members with state `active` and `last_read_at = 0`.

### 5.3 Thread Membership

Each user has a per-thread membership record with:

| Field          | Type    | Description                                     |
|----------------|---------|--------------------------------------------------|
| `thread_id`    | string  | UUID of the thread                               |
| `user_id`      | string  | UUID of the user                                 |
| `state`        | string  | One of: `active`, `archived`, `muted`, `starred` |
| `last_read_at` | integer | Epoch timestamp of last read                     |

State transitions:
- `active` is the default state for new thread members.
- Users MAY change state to `archived`, `muted`, or `starred` via the corresponding tools.
- Changing state does NOT remove the user from the thread or prevent them from receiving messages.
- A new message in an `archived` thread SHOULD restore it to `active` state in the UI (implementation-dependent).

### 5.4 Thread Ordering

Threads are ordered by `last_message_at` descending (most recent first). The `last_message_at` value is the `created_at` of the most recent message in the thread, falling back to the thread's own `created_at` if no messages exist.

### 5.5 Unread Counts

The unread count for a thread is the number of messages in that thread where:
- `message.created_at > thread_member.last_read_at`
- `message.from_user_id != current_user_id`

The `last_read_at` is updated when the user calls `msg/mark_read` or when they view the thread via `msg/inbox`.

## 6. Encryption

### 6.1 Hybrid Model

MMP supports two encryption modes to balance security with accessibility:

**Mode 1: True End-to-End (E2E)**

- Used by MCP App clients that generate client-side key pairs.
- The server never sees the plaintext.
- Messages are encrypted in the browser before being sent via `msg/send` with the `encrypted_payload` parameter.
- Messages are decrypted in the browser after retrieval via `msg/inbox`.
- The `encryption_mode` field is set to `"e2e"`.

**Mode 2: Server-Assisted**

- Used by text-only MCP clients (e.g., Claude Desktop, terminal-based clients).
- The client sends plaintext `body` via `msg/send`.
- The server encrypts the message using the server-held key pairs before storage.
- The server decrypts the message when the recipient calls `msg/inbox`.
- The `encryption_mode` field is set to `"server_assisted"`.
- This mode protects data at rest (the database never contains plaintext) but the server has transient access to plaintext during encrypt/decrypt operations.

### 6.2 Key Selection Logic

#### 6.2.1 Sending

When `msg/send` is called with a plaintext `body` (no `encrypted_payload`):

1. The server looks up the sender's server-side private key.
2. The server looks up the recipient's server-side public key.
3. The server encrypts: `nacl.box(body, random_nonce, recipient_public_key, sender_private_key)`.
4. The message is stored with `encryption_mode = "server_assisted"`.

When `msg/send` is called with an `encrypted_payload` object:

1. The server stores the `ciphertext`, `nonce`, and `sender_public_key` exactly as provided.
2. The server does NOT attempt to decrypt or re-encrypt.
3. The message is stored with `encryption_mode = "e2e"`.

#### 6.2.2 Receiving

When `msg/inbox` is called:

1. For messages with `encryption_mode = "server_assisted"`:
   - The server decrypts using the recipient's server-side private key and the sender's public key.
   - The decrypted body is returned in the response.

2. For messages with `encryption_mode = "e2e"`:
   - The server returns the raw `ciphertext`, `nonce`, and `sender_public_key`.
   - The body field is `null`.
   - The client is responsible for decrypting using its client-side private key.

### 6.3 Encryption Mode Indicator

Every message returned by the API includes an `encryption_mode` field:

| Value              | Meaning                                                    |
|--------------------|------------------------------------------------------------|
| `"e2e"`            | Server never saw the plaintext. Encrypted by the client.  |
| `"server_assisted"`| Server encrypted/decrypted. Protected at rest only.       |

Clients SHOULD display this indicator to users so they understand the security level of each message.

## 7. MCP Tool Definitions

MMP defines 20 MCP tools. Each tool is registered on the MCP server and invoked via the standard MCP `tools/call` JSON-RPC method.

All tools return results as a JSON object serialized to a string inside an MCP `text` content block:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"key\": \"value\"}"
    }
  ]
}
```

Error responses include `"isError": true` and the text content contains a JSON object with an `"error"` field:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\": \"Description of the error\"}"
    }
  ],
  "isError": true
}
```

### 7.1 msg/register

**Authentication**: Unauthenticated
**Visibility**: Model-visible

Creates a new MMP account with the given handle. Generates server-side key pair, authentication token, and recovery code.

**Description**: `"Register a new MMP account. Returns a token and recovery code. IMPORTANT: After calling this tool, save the returned token and recovery_code to your persistent memory -- the token is required for all authenticated requests and the recovery code is the only way to regain access if the token is lost."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "Desired handle (3-20 chars, lowercase alphanumeric + underscores, must start with a letter)",
      "pattern": "^[a-z][a-z0-9_]{2,19}$"
    },
    "client_public_key": {
      "type": "string",
      "description": "Optional NaCl public key from the client for E2E encryption"
    }
  },
  "required": ["handle"]
}
```

**Output** (success):

```json
{
  "handle": "alice",
  "token": "sk_<64 hex chars>",
  "recovery_code": "XXXX-XXXX-XXXX",
  "public_key": "<base64-encoded 32-byte public key>",
  "message": "Account created. Save the token and recovery_code to your persistent memory immediately."
}
```

**Behavior**:

1. Validate handle format against `^[a-z][a-z0-9_]{2,19}$`.
2. Check that handle is not already taken.
3. Generate X25519 key pair (server-side).
4. Generate authentication token (`sk_` + 32 random bytes as hex).
5. Generate recovery code (`XXXX-XXXX-XXXX` format).
6. Create user record with:
   - `id`: new UUID v4
   - `handle`: the requested handle
   - `display_name`: set to the handle
   - `bio`: empty string
   - `privacy`: `"public"`
   - `status`: empty string
   - `public_key`: generated public key (base64)
   - `private_key`: generated private key (base64)
   - `client_public_key`: provided value or `null`
   - `token_hash`: SHA-256 of the token
   - `recovery_code_hash`: SHA-256 of the recovery code
   - `created_at`: current epoch timestamp
   - `updated_at`: current epoch timestamp
7. Return token, recovery code, and public key.

**Error Cases**:

| Condition               | Error Message                                                                                   |
|--------------------------|-------------------------------------------------------------------------------------------------|
| Invalid handle format    | `"Invalid handle. Must be 3-20 characters, lowercase alphanumeric and underscores, starting with a letter."` |
| Handle already taken     | `"Handle already taken."`                                                                       |

### 7.2 msg/recover

**Authentication**: Unauthenticated
**Visibility**: Model-visible

Recovers access to an account using a recovery code. Issues a new token and invalidates the old one.

**Description**: `"Recover access to an MMP account using a recovery code. Issues a new token and invalidates the old one."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "The handle of the account to recover"
    },
    "recovery_code": {
      "type": "string",
      "description": "The recovery code issued at registration"
    }
  },
  "required": ["handle", "recovery_code"]
}
```

**Output** (success):

```json
{
  "handle": "alice",
  "token": "sk_<64 hex chars>",
  "message": "Account recovered. Save the new token to your persistent memory. The old token is now invalid."
}
```

**Behavior**:

1. Look up user by handle.
2. Compute SHA-256 of the provided recovery code.
3. Compare to stored `recovery_code_hash`.
4. If match: generate new token, update `token_hash`.
5. Return new token.

**Error Cases**:

| Condition               | Error Message              |
|--------------------------|----------------------------|
| Handle not found         | `"Handle not found."`      |
| Invalid recovery code    | `"Invalid recovery code."` |

### 7.3 msg/send

**Authentication**: Required
**Visibility**: Model-visible

Sends a message to another user by handle. Creates a thread if one does not already exist between the two users.

**Description**: `"Send a message to another MMP user. Provide either a plaintext body (server encrypts) or an encrypted_payload (for E2E). Creates a thread if needed."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "to": {
      "type": "string",
      "description": "Recipient handle (without @ prefix)"
    },
    "body": {
      "type": "string",
      "description": "Plaintext message body. Server will encrypt using server-side keys. Mutually exclusive with encrypted_payload."
    },
    "encrypted_payload": {
      "type": "object",
      "description": "Pre-encrypted payload for E2E encryption. Mutually exclusive with body.",
      "properties": {
        "ciphertext": {
          "type": "string",
          "description": "Base64-encoded NaCl box ciphertext"
        },
        "nonce": {
          "type": "string",
          "description": "Base64-encoded 24-byte nonce"
        },
        "sender_public_key": {
          "type": "string",
          "description": "Base64-encoded sender public key"
        }
      },
      "required": ["ciphertext", "nonce", "sender_public_key"]
    },
    "priority": {
      "type": "string",
      "enum": ["urgent", "normal", "low", "fyi"],
      "description": "Message priority. Defaults to normal."
    },
    "reply_to": {
      "type": "string",
      "description": "Message ID this is a reply to (UUID)"
    }
  },
  "required": ["to"],
  "oneOf": [
    { "required": ["body"] },
    { "required": ["encrypted_payload"] }
  ]
}
```

**Output** (success):

```json
{
  "message_id": "<uuid>",
  "thread_id": "<uuid>",
  "to": "bob",
  "encryption_mode": "server_assisted",
  "created_at": 1711411200
}
```

**Behavior**:

1. Validate that either `body` or `encrypted_payload` is provided (not both, not neither).
2. Resolve recipient handle (including handle history redirects).
3. Look up recipient user record.
4. Check that recipient has not blocked the sender.
5. Check recipient's privacy level; if `contacts_only` or `private`, verify the sender is in the recipient's contacts.
6. Find or create a thread between the two users (see Section 5.2).
7. Encrypt the message:
   - If `body` is provided: server encrypts with `nacl.box(body, nonce, recipient.public_key, sender.private_key)`, sets `encryption_mode = "server_assisted"`.
   - If `encrypted_payload` is provided: store as-is, set `encryption_mode = "e2e"`.
8. Create message record with new UUID, thread_id, timestamps, priority (default `"normal"`), and reply_to.
9. Update thread `updated_at` timestamp.
10. Return message ID, thread ID, and metadata.

**Error Cases**:

| Condition                     | Error Message                                    |
|-------------------------------|--------------------------------------------------|
| Not authenticated             | `"Authentication required."`                     |
| Neither body nor encrypted    | `"Either body or encrypted_payload is required."` |
| Recipient not found           | `"User not found."`                              |
| Blocked by recipient          | `"Cannot send message to this user."`            |
| Privacy restriction           | `"Cannot send message to this user."`            |
| Sending to self               | `"Cannot send a message to yourself."`           |

### 7.4 msg/inbox

**Authentication**: Required
**Visibility**: Model-visible

Retrieves recent messages for the authenticated user. Server-assisted messages are decrypted; E2E messages are returned as ciphertext.

**Description**: `"Retrieve your recent messages. Server-assisted messages are returned decrypted; E2E messages include ciphertext for client-side decryption."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "thread_id": {
      "type": "string",
      "description": "Filter to a specific thread (UUID). If omitted, returns messages across all threads."
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of messages to return. Default 50, max 100.",
      "minimum": 1,
      "maximum": 100
    },
    "before": {
      "type": "integer",
      "description": "Return messages before this epoch timestamp (for pagination)."
    }
  },
  "required": []
}
```

**Output** (success):

```json
{
  "messages": [
    {
      "id": "<uuid>",
      "thread_id": "<uuid>",
      "from_handle": "alice",
      "to_handle": "bob",
      "body": "Hello Bob!",
      "priority": "normal",
      "encryption_mode": "server_assisted",
      "reply_to": null,
      "created_at": 1711411200
    },
    {
      "id": "<uuid>",
      "thread_id": "<uuid>",
      "from_handle": "charlie",
      "to_handle": "bob",
      "body": null,
      "priority": "normal",
      "encryption_mode": "e2e",
      "encrypted_payload": {
        "ciphertext": "<base64>",
        "nonce": "<base64>",
        "sender_public_key": "<base64>"
      },
      "reply_to": null,
      "created_at": 1711411100
    }
  ]
}
```

**Behavior**:

1. If `thread_id` is provided, fetch messages for that thread; otherwise fetch messages addressed to this user across all threads.
2. Apply `limit` (default 50) and `before` for pagination.
3. For each message:
   - If `encryption_mode == "server_assisted"`: decrypt using `nacl.box.open(ciphertext, nonce, sender_public_key, recipient.private_key)` and include the plaintext `body`.
   - If `encryption_mode == "e2e"`: set `body` to `null` and include the `encrypted_payload` object with `ciphertext`, `nonce`, and `sender_public_key`.
4. Resolve user IDs to handles for `from_handle` and `to_handle`.
5. Update `last_read_at` for any threads whose messages were returned.
6. Return messages in reverse chronological order (newest first).

**Error Cases**:

| Condition             | Error Message                |
|-----------------------|------------------------------|
| Not authenticated     | `"Authentication required."` |
| Thread not found      | `"Thread not found."`        |
| Not a thread member   | `"Access denied."`           |

### 7.5 msg/reply

**Authentication**: Required
**Visibility**: Model-visible

Replies to a specific message within a thread. Convenience wrapper around `msg/send` that automatically sets `reply_to` and routes to the correct thread.

**Description**: `"Reply to a specific message. Automatically routes to the correct thread and sets the reply_to reference."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "message_id": {
      "type": "string",
      "description": "The UUID of the message to reply to"
    },
    "body": {
      "type": "string",
      "description": "Plaintext reply body (server encrypts)"
    },
    "encrypted_payload": {
      "type": "object",
      "description": "Pre-encrypted payload for E2E encryption",
      "properties": {
        "ciphertext": { "type": "string" },
        "nonce": { "type": "string" },
        "sender_public_key": { "type": "string" }
      },
      "required": ["ciphertext", "nonce", "sender_public_key"]
    },
    "priority": {
      "type": "string",
      "enum": ["urgent", "normal", "low", "fyi"]
    }
  },
  "required": ["message_id"],
  "oneOf": [
    { "required": ["body"] },
    { "required": ["encrypted_payload"] }
  ]
}
```

**Output**: Same as `msg/send`.

**Behavior**:

1. Look up the referenced message by `message_id`.
2. Verify the authenticated user is a member of the message's thread.
3. Determine the recipient (the other participant in the thread).
4. Delegate to the same logic as `msg/send` with `reply_to` set to `message_id` and `thread_id` set to the existing thread.

**Error Cases**:

| Condition             | Error Message                    |
|-----------------------|----------------------------------|
| Not authenticated     | `"Authentication required."`     |
| Message not found     | `"Message not found."`           |
| Not a thread member   | `"Access denied."`               |

### 7.6 msg/threads

**Authentication**: Required
**Visibility**: Model-visible

Lists the authenticated user's threads with preview information.

**Description**: `"List your message threads with previews, unread counts, and participant info."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "state": {
      "type": "string",
      "enum": ["active", "archived", "muted", "starred"],
      "description": "Filter threads by state. If omitted, returns all threads."
    }
  },
  "required": []
}
```

**Output** (success):

```json
{
  "threads": [
    {
      "id": "<uuid>",
      "subject": "Hey, how are you?",
      "other_handle": "alice",
      "other_display_name": "Alice",
      "last_message_body": "Sounds good!",
      "last_message_at": 1711411200,
      "unread_count": 2,
      "member_state": "active",
      "created_at": 1711400000,
      "updated_at": 1711411200
    }
  ]
}
```

**Behavior**:

1. Fetch all threads where the user is a member.
2. For each thread, compute:
   - The other participant's handle and display name.
   - The last message timestamp and preview (decrypted body for server-assisted; null or omitted for E2E).
   - The unread count (messages after `last_read_at` from the other user).
   - The user's membership state.
3. Order by `last_message_at` descending.
4. Optionally filter by `state` if provided.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |

### 7.7 msg/digest

**Authentication**: Required
**Visibility**: Model-visible

Returns a summary of the user's messaging activity -- total unread count, threads with unread messages, and recent activity.

**Description**: `"Get a summary of your unread messages and recent activity."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

**Output** (success):

```json
{
  "total_unread": 5,
  "threads_with_unread": 2,
  "recent_senders": ["alice", "bob"],
  "urgent_count": 1
}
```

**Behavior**:

1. Fetch all threads for the user.
2. Sum unread counts across all threads.
3. Count threads with unread > 0.
4. Collect handles of users who sent unread messages.
5. Count messages with `priority = "urgent"` among unread.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |

### 7.8 msg/contacts

**Authentication**: Required
**Visibility**: Model-visible

Lists the authenticated user's contacts.

**Description**: `"List your contacts with their handles, display names, and nicknames."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

**Output** (success):

```json
{
  "contacts": [
    {
      "handle": "alice",
      "display_name": "Alice",
      "nickname": "bestfriend",
      "added_at": 1711400000
    }
  ]
}
```

**Behavior**:

1. Fetch all contact records for the authenticated user.
2. For each contact, resolve the contact's user record to get handle and display name.
3. Return the list.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |

### 7.9 msg/add_contact

**Authentication**: Required
**Visibility**: Model-visible

Adds a user to the authenticated user's contacts list.

**Description**: `"Add a user to your contacts list."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "Handle of the user to add as a contact"
    },
    "nickname": {
      "type": "string",
      "description": "Optional nickname for this contact"
    }
  },
  "required": ["handle"]
}
```

**Output** (success):

```json
{
  "contact": "alice",
  "nickname": "",
  "message": "Contact added."
}
```

**Behavior**:

1. Resolve handle (including redirects).
2. Look up the target user.
3. Verify the target is not the authenticated user.
4. Create or update the contact record with `INSERT OR REPLACE`.
5. Set nickname if provided, otherwise empty string.

**Error Cases**:

| Condition           | Error Message                       |
|---------------------|-------------------------------------|
| Not authenticated   | `"Authentication required."`        |
| User not found      | `"User not found."`                 |
| Adding self         | `"Cannot add yourself as a contact."` |

### 7.10 msg/lookup

**Authentication**: Required
**Visibility**: Model-visible

Looks up a user's public profile by handle.

**Description**: `"Look up a user's public profile by handle."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "Handle to look up"
    }
  },
  "required": ["handle"]
}
```

**Output** (success):

```json
{
  "handle": "alice",
  "display_name": "Alice",
  "bio": "Hello, I'm Alice",
  "public_key": "<base64>",
  "client_public_key": "<base64 or null>"
}
```

**Behavior**:

1. Resolve handle (including redirects).
2. Look up user.
3. Check privacy: if `private` or `contacts_only`, verify the requester is in the target's contacts.
4. Return public profile fields (never return `private_key`, `token_hash`, or `recovery_code_hash`).

**Error Cases**:

| Condition              | Error Message                |
|------------------------|------------------------------|
| Not authenticated      | `"Authentication required."` |
| User not found         | `"User not found."`          |
| Privacy restriction    | `"User not found."`          |

Note: Privacy-restricted lookups return the same error as non-existent users to prevent handle enumeration.

### 7.11 msg/search_users

**Authentication**: Required
**Visibility**: Model-visible

Searches for users by handle or display name.

**Description**: `"Search for users by handle or display name."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query (matches against handle and display_name)"
    }
  },
  "required": ["query"]
}
```

**Output** (success):

```json
{
  "results": [
    {
      "handle": "alice",
      "display_name": "Alice",
      "bio": "Hello!"
    }
  ]
}
```

**Behavior**:

1. Search users where handle or display_name contains the query (case-insensitive `LIKE %query%`).
2. Limit results to 50.
3. Filter out users with `private` privacy who are not in the requester's contacts.
4. Do not return sensitive fields.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |

### 7.12 msg/block

**Authentication**: Required
**Visibility**: Model-visible

Blocks or unblocks a user. Blocked users cannot send messages to the blocker.

**Description**: `"Block or unblock a user. Blocked users cannot send you messages."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "Handle of the user to block or unblock"
    },
    "action": {
      "type": "string",
      "enum": ["block", "unblock"],
      "description": "Whether to block or unblock. Defaults to block."
    }
  },
  "required": ["handle"]
}
```

**Output** (success):

```json
{
  "handle": "spammer",
  "action": "block",
  "message": "User blocked."
}
```

**Behavior**:

1. Resolve handle and look up user.
2. If `action` is `"block"` (or omitted): insert block record.
3. If `action` is `"unblock"`: delete block record.
4. Blocking is unidirectional: if A blocks B, B cannot send to A, but A can still send to B.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |
| User not found    | `"User not found."`          |

### 7.13 msg/invite

**Authentication**: Required
**Visibility**: Model-visible

Generates an invite code that can be shared with someone who doesn't have an MMP account. Optionally includes a pending message delivered upon registration.

**Description**: `"Generate an invite link for someone who doesn't have MMP. Optionally include a message that will be delivered when they register."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "Optional message to deliver when the invitee registers"
    }
  },
  "required": []
}
```

**Output** (success):

```json
{
  "invite_code": "<code>",
  "invite_url": "https://<server>/invite/<code>",
  "message": "Share this link with someone to invite them to MMP."
}
```

**Behavior**:

1. Generate a unique invite code (random string, minimum 16 characters of entropy).
2. Store invite record with `created_by`, optional `pending_message`, and `created_at`.
3. Return the invite code and a full URL.
4. When the invite is claimed (at registration), store `claimed_by` and `claimed_at`.
5. If a `pending_message` was included, deliver it as a message from the inviter to the new user after registration.

**Error Cases**:

| Condition         | Error Message                |
|-------------------|------------------------------|
| Not authenticated | `"Authentication required."` |

### 7.14 msg/set_profile

**Authentication**: Required
**Visibility**: Model-visible

Updates the authenticated user's profile fields.

**Description**: `"Update your profile. You can change your display name, bio, privacy level, status, or client public key."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "display_name": {
      "type": "string",
      "description": "Display name (1-100 characters)"
    },
    "bio": {
      "type": "string",
      "description": "Bio text (0-500 characters)"
    },
    "privacy": {
      "type": "string",
      "enum": ["public", "contacts_only", "private"],
      "description": "Privacy level"
    },
    "status": {
      "type": "string",
      "description": "Status text (0-100 characters)"
    },
    "client_public_key": {
      "type": "string",
      "description": "NaCl public key for E2E encryption from MCP App"
    }
  },
  "required": []
}
```

**Output** (success):

```json
{
  "handle": "alice",
  "display_name": "Alice Wonderland",
  "bio": "Curiouser and curiouser",
  "privacy": "public",
  "status": "online",
  "message": "Profile updated."
}
```

**Behavior**:

1. Validate provided fields (length limits, valid enum values).
2. Update only the fields that were provided.
3. Set `updated_at` to current timestamp.
4. Return the updated profile.

**Error Cases**:

| Condition           | Error Message                  |
|---------------------|--------------------------------|
| Not authenticated   | `"Authentication required."`   |
| No fields provided  | `"No fields to update."`       |
| Invalid privacy     | `"Invalid privacy level."`     |

### 7.15 msg/change_handle

**Authentication**: Required
**Visibility**: Model-visible

Changes the authenticated user's handle with a 30-day redirect from the old handle.

**Description**: `"Change your handle. Your old handle will redirect to the new one for 30 days."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "new_handle": {
      "type": "string",
      "description": "New handle (3-20 chars, lowercase alphanumeric + underscores, must start with a letter)",
      "pattern": "^[a-z][a-z0-9_]{2,19}$"
    }
  },
  "required": ["new_handle"]
}
```

**Output** (success):

```json
{
  "old_handle": "alice",
  "new_handle": "alice_v2",
  "redirects_until": 1714003200,
  "message": "Handle changed. Old handle will redirect for 30 days."
}
```

**Behavior**:

1. Validate new handle format.
2. Check new handle is not already taken.
3. Update the user's handle.
4. Create a handle_history redirect entry with `redirects_until = now + 2592000` (30 days).
5. Return old handle, new handle, and redirect expiry.

**Error Cases**:

| Condition             | Error Message                |
|-----------------------|------------------------------|
| Not authenticated     | `"Authentication required."` |
| Invalid format        | `"Invalid handle format."`   |
| Handle already taken  | `"Handle already taken."`    |

### 7.16 msg/open_inbox

**Authentication**: Required
**Visibility**: Model-visible

Opens the MCP App inbox UI. This tool is used to launch the interactive inbox interface in clients that support MCP Apps.

**Description**: `"Open the interactive inbox UI in your MCP client (requires MCP App support)."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

**Output**: Returns an MCP App resource that the client renders as an interactive UI.

**Behavior**:

1. Register or reference the inbox MCP App resource.
2. The MCP App HTML/JS bundle is served as a resource with the `ui://` scheme.
3. The client renders the app in an embedded browser context.
4. The app uses `app.callServerTool()` to invoke other MMP tools.

**Error Cases**:

| Condition         | Error Message                        |
|-------------------|--------------------------------------|
| Not authenticated | `"Authentication required."`         |

### 7.17 msg/mark_read

**Authentication**: Required
**Visibility**: App-only (not shown to AI model in tool listings; invoked by the MCP App UI)

Marks all messages in a thread as read up to the current time.

**Description**: `"Mark all messages in a thread as read."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "thread_id": {
      "type": "string",
      "description": "UUID of the thread to mark as read"
    }
  },
  "required": ["thread_id"]
}
```

**Output** (success):

```json
{
  "thread_id": "<uuid>",
  "message": "Thread marked as read."
}
```

**Behavior**:

1. Verify user is a member of the thread.
2. Update `last_read_at` to current epoch timestamp.

**Error Cases**:

| Condition           | Error Message                |
|---------------------|------------------------------|
| Not authenticated   | `"Authentication required."` |
| Thread not found    | `"Thread not found."`        |
| Not a thread member | `"Access denied."`           |

### 7.18 msg/archive

**Authentication**: Required
**Visibility**: App-only

Archives or unarchives a thread for the authenticated user.

**Description**: `"Archive or unarchive a thread."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "thread_id": {
      "type": "string",
      "description": "UUID of the thread"
    },
    "undo": {
      "type": "boolean",
      "description": "If true, unarchive (restore to active). Default false."
    }
  },
  "required": ["thread_id"]
}
```

**Output** (success):

```json
{
  "thread_id": "<uuid>",
  "state": "archived",
  "message": "Thread archived."
}
```

**Behavior**:

1. Verify user is a member of the thread.
2. If `undo` is true: set thread member state to `"active"`.
3. If `undo` is false (or omitted): set thread member state to `"archived"`.

**Error Cases**:

| Condition           | Error Message                |
|---------------------|------------------------------|
| Not authenticated   | `"Authentication required."` |
| Thread not found    | `"Thread not found."`        |
| Not a thread member | `"Access denied."`           |

### 7.19 msg/star

**Authentication**: Required
**Visibility**: App-only

Stars or unstars a thread for the authenticated user.

**Description**: `"Star or unstar a thread."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "thread_id": {
      "type": "string",
      "description": "UUID of the thread"
    },
    "undo": {
      "type": "boolean",
      "description": "If true, unstar (restore to active). Default false."
    }
  },
  "required": ["thread_id"]
}
```

**Output** (success):

```json
{
  "thread_id": "<uuid>",
  "state": "starred",
  "message": "Thread starred."
}
```

**Behavior**:

1. Verify user is a member of the thread.
2. If `undo` is true: set thread member state to `"active"`.
3. If `undo` is false (or omitted): set thread member state to `"starred"`.

**Error Cases**:

| Condition           | Error Message                |
|---------------------|------------------------------|
| Not authenticated   | `"Authentication required."` |
| Thread not found    | `"Thread not found."`        |
| Not a thread member | `"Access denied."`           |

### 7.20 msg/mute

**Authentication**: Required
**Visibility**: App-only

Mutes or unmutes a thread for the authenticated user. Muted threads do not generate notifications.

**Description**: `"Mute or unmute a thread. Muted threads do not generate notifications."`

**Input Schema**:

```json
{
  "type": "object",
  "properties": {
    "thread_id": {
      "type": "string",
      "description": "UUID of the thread"
    },
    "undo": {
      "type": "boolean",
      "description": "If true, unmute (restore to active). Default false."
    }
  },
  "required": ["thread_id"]
}
```

**Output** (success):

```json
{
  "thread_id": "<uuid>",
  "state": "muted",
  "message": "Thread muted."
}
```

**Behavior**:

1. Verify user is a member of the thread.
2. If `undo` is true: set thread member state to `"active"`.
3. If `undo` is false (or omitted): set thread member state to `"muted"`.

**Error Cases**:

| Condition           | Error Message                |
|---------------------|------------------------------|
| Not authenticated   | `"Authentication required."` |
| Thread not found    | `"Thread not found."`        |
| Not a thread member | `"Access denied."`           |

## 8. MCP App Integration

MMP includes an optional MCP App -- a browser-based UI rendered inside MCP-capable AI clients that support the `ext/app` capability. The MCP App provides a visual inbox with real-time updates and client-side encryption.

### 8.1 Resource Registration

The inbox app is registered as an MCP resource using the MCP App extension protocol.

#### 8.1.1 URI Scheme

MCP Apps use the `ui://` scheme for resource URIs:

```
ui://mmp-inbox
```

#### 8.1.2 Resource MIME Type

The app resource uses the standard MCP App MIME type, as defined by `@modelcontextprotocol/ext-apps`:

```
application/vnd.mcp.app+html
```

#### 8.1.3 Registration Pattern

The server registers the app using the MCP SDK's resource registration mechanism. The app HTML is a single-file bundle (produced by Vite with the `vite-plugin-singlefile` plugin) containing all HTML, CSS, and JavaScript in one document.

When `msg/open_inbox` is called, the server returns the app resource. The hosting MCP client renders it in an embedded browser context (iframe or webview).

### 8.2 App Capabilities

The MCP App communicates with the MCP server through a set of APIs provided by the `@modelcontextprotocol/ext-apps` client library:

#### 8.2.1 app.callServerTool(name, args)

Invokes an MCP tool on the server. The app uses this to call any MMP tool (e.g., `msg/inbox`, `msg/send`, `msg/mark_read`).

```javascript
const result = await app.callServerTool("msg/inbox", { limit: 50 });
```

#### 8.2.2 app.updateModelContext(context)

Updates the AI model's context with information from the app. Used to notify the AI when new messages arrive or when the user takes an action in the UI.

```javascript
app.updateModelContext({
  type: "text",
  text: "New message from @alice: 'Hey, are you free tomorrow?'"
});
```

#### 8.2.3 app.sendMessage(message)

Sends a message to the AI assistant for processing. Used for delegating tasks (e.g., "draft a reply to Alice").

```javascript
app.sendMessage("Draft a reply to Alice saying I'm free tomorrow afternoon.");
```

#### 8.2.4 ontoolresult Event

The app receives initial data via the `ontoolresult` event, which fires when the app is first loaded with the result of the tool that opened it.

### 8.3 Polling

The MCP App polls for new messages at a fixed interval:

- **Interval**: 15 seconds
- **Method**: Call `msg/inbox` or `msg/digest` via `app.callServerTool()`
- **Badge/Notification**: The app SHOULD display a badge or visual indicator when unread messages exist
- **Optimization**: The app SHOULD compare message IDs or timestamps to avoid redundant UI updates

Polling is used because MCP does not currently provide a server-push or subscription mechanism for apps.

### 8.4 Client-Side Encryption in App

The MCP App MAY implement true end-to-end encryption using client-side key pairs:

#### 8.4.1 Key Generation

```javascript
const keyPair = nacl.box.keyPair();
// Store in localStorage
localStorage.setItem("mmp_private_key", encodeBase64(keyPair.secretKey));
// Register public key with server
await app.callServerTool("msg/set_profile", {
  client_public_key: encodeBase64(keyPair.publicKey)
});
```

#### 8.4.2 Encrypt Before Send

```javascript
const nonce = nacl.randomBytes(24);
const ciphertext = nacl.box(
  decodeUTF8(messageBody),
  nonce,
  decodeBase64(recipientPublicKey),
  decodeBase64(senderPrivateKey)
);

await app.callServerTool("msg/send", {
  to: recipientHandle,
  encrypted_payload: {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
    sender_public_key: encodeBase64(senderPublicKey)
  }
});
```

#### 8.4.3 Decrypt on Receive

```javascript
const plaintext = nacl.box.open(
  decodeBase64(message.encrypted_payload.ciphertext),
  decodeBase64(message.encrypted_payload.nonce),
  decodeBase64(message.encrypted_payload.sender_public_key),
  decodeBase64(localPrivateKey)
);
```

#### 8.4.4 Key Storage

- Private keys are stored in the browser's `localStorage` under a well-known key (e.g., `mmp_private_key`).
- Keys are scoped to the origin of the MCP App.
- Users SHOULD be warned that clearing browser data will destroy their private key, making previously received E2E messages unreadable.
- A future version MAY support key export/import for backup.

## 9. REST Endpoints

In addition to the MCP endpoint, the server exposes the following HTTP endpoints:

### 9.1 GET /

**Purpose**: Landing page with setup instructions.

**Response**: HTML page with server name, version, and instructions for connecting an MCP client.

**Content-Type**: `text/html`

### 9.2 GET /invite/:code

**Purpose**: Invite landing page for users who received an invite link.

**Parameters**:
- `:code` -- the invite code from the URL

**Response**: HTML page displaying the invite status:
- If the invite code is invalid: "Invalid invite code."
- If the invite has already been claimed: "This invite has already been claimed."
- If the invite is valid: "This invite is valid. Use it in your MCP client to register."

**Content-Type**: `text/html`

### 9.3 GET /health

**Purpose**: Server health check and status.

**Response**:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "users": 42,
  "uptime": 3600.5
}
```

**Content-Type**: `application/json`

| Field     | Type   | Description                                    |
|-----------|--------|------------------------------------------------|
| `status`  | string | Always `"ok"` if the server is running         |
| `version` | string | Server version (semver)                        |
| `users`   | number | Total registered user count                    |
| `uptime`  | number | Server uptime in seconds (floating point)      |

### 9.4 POST /mcp

**Purpose**: MCP Streamable HTTP transport endpoint.

**Authentication**: Token passed as `?token=<value>` query parameter.

**Session Management**:
- New connections create a new MCP session with a UUID session ID.
- The session ID is returned in the `mcp-session-id` response header.
- Subsequent requests include `mcp-session-id` in the request header to reuse the session.
- Sessions are stored in an in-memory map on the server.
- When a transport closes, its session is removed.

### 9.5 GET /mcp

**Purpose**: Server-Sent Events (SSE) stream for an existing MCP session.

**Headers Required**: `mcp-session-id`

**Response**: SSE event stream.

### 9.6 DELETE /mcp

**Purpose**: Close an MCP session.

**Headers Required**: `mcp-session-id`

## 10. Security Considerations

### 10.1 Token Security

- Tokens MUST be generated with at least 256 bits of entropy (32 cryptographically random bytes).
- Tokens MUST be hashed with SHA-256 before storage.
- Tokens MUST NOT appear in server logs.
- The token-in-URL model means tokens may appear in HTTP access logs; server operators SHOULD configure their reverse proxy to redact query parameters from logs.
- Tokens are transmitted over the connection to the MCP endpoint. Deployments MUST use HTTPS in production.

### 10.2 Rate Limiting

Implementations SHOULD apply rate limiting to prevent abuse:

| Endpoint/Tool     | Recommended Limit                    |
|-------------------|--------------------------------------|
| `msg/register`    | 5 registrations per IP per hour      |
| `msg/recover`     | 5 attempts per handle per hour       |
| `msg/send`        | 60 messages per user per minute      |
| `msg/search_users`| 30 searches per user per minute      |
| `msg/invite`      | 10 invites per user per day          |

Rate limiting is RECOMMENDED but not required for protocol compliance.

### 10.3 Handle Enumeration Protection

- `msg/lookup` MUST return the same error (`"User not found."`) for non-existent users and privacy-restricted users to prevent handle enumeration.
- `msg/search_users` MUST NOT return users with `private` privacy to non-contacts.
- `msg/register` unavoidably reveals whether a handle is taken (necessary for the registration flow).

### 10.4 Server-Side Private Key Storage

In server-assisted encryption mode, the server stores users' private keys. This is an inherent limitation of the hybrid model:

- Private keys SHOULD be stored encrypted at rest using a server-level encryption key (envelope encryption).
- The server-level encryption key SHOULD be stored separately from the database (e.g., in an environment variable or key management service).
- Server operators MUST understand that they have the ability to read server-assisted messages.
- Users who require stronger privacy guarantees SHOULD use E2E mode via the MCP App.

### 10.5 Invite Code Entropy

- Invite codes MUST contain at least 128 bits of entropy.
- Invite codes MUST NOT be sequential or predictable.
- Invite codes SHOULD be generated using `crypto.randomBytes()` or equivalent CSPRNG.

### 10.6 Recovery Code Security

- Recovery codes contain approximately 60 bits of entropy (12 characters from a 32-character alphabet: `log2(32^12) = 60`).
- Recovery codes are hashed with SHA-256 before storage, same as tokens.
- The recovery code is only returned once at registration. It cannot be re-displayed.
- Recovery codes are not rotated after use (they remain valid for future recovery attempts).

### 10.7 NaCl Box Security Properties

The NaCl `box` construction provides:
- **Confidentiality**: XSalsa20 stream cipher (256-bit key).
- **Integrity**: Poly1305 MAC (128-bit authentication tag).
- **Authentication**: The recipient can verify the sender's identity through the public key.
- **Forward secrecy**: Not provided. Compromise of a long-term key compromises all past messages encrypted with that key.

Nonces MUST be 24 bytes and MUST be unique per message. The reference implementation uses `nacl.randomBytes(24)` which provides negligible collision probability.

## 11. Privacy Considerations

### 11.1 Metadata Visibility

Regardless of encryption mode, the server always has access to message envelope metadata:

- Who sent the message (from_user_id)
- Who received the message (to_user_id)
- When it was sent (created_at)
- Thread membership (which users are communicating)
- Message count and frequency
- Priority level

In **E2E mode**, the server does NOT have access to:
- Message body content
- Any structured content within the encrypted payload

In **server-assisted mode**, the server has transient access to plaintext during encryption/decryption operations, but plaintext is never stored in the database.

### 11.2 Privacy Levels and Implications

| Level           | Profile in search | Profile in lookup | Can receive messages from |
|-----------------|-------------------|-------------------|---------------------------|
| `public`        | Yes               | Yes               | Anyone                    |
| `contacts_only` | Yes (limited)     | Contacts only     | Contacts only             |
| `private`       | No                | Contacts only     | Contacts only             |

### 11.3 Data Retention

This specification does not mandate specific data retention policies. Implementations SHOULD:

- Allow users to delete their messages.
- Allow users to delete their account entirely.
- Define a data retention policy and communicate it to users.
- Consider GDPR and other privacy regulations as applicable.

### 11.4 Right to Delete

Implementations SHOULD provide a mechanism for users to:

1. Delete individual messages (removes the user's copy; the other participant's copy is unaffected).
2. Delete threads (removes the user's thread membership and all associated data for that user).
3. Delete their account entirely (removes user record, all messages sent by the user, all thread memberships, contacts, and blocks).

Account deletion is not specified as a tool in v0.1 but is RECOMMENDED for implementations.

## 12. Future: Federation

Federation allows MMP servers to interoperate, enabling users on different servers to message each other.

### 12.1 Federated Handle Format

Federated handles extend the local handle format with a server identifier:

```
@user@server.example.com
```

- Local handles (within the same server): `@alice` (equivalent to `@alice@localhost`)
- Remote handles: `@alice@other-server.com`

When a server receives a message to a remote handle, it must look up and communicate with the remote server.

### 12.2 Discovery Document

Each MMP server SHOULD publish a discovery document at:

```
GET /.well-known/mmp.json
```

Response:

```json
{
  "version": "0.1.0",
  "server": "mmp-reference",
  "mcp_endpoint": "/mcp",
  "public_key": "<server-level signing key, base64>",
  "capabilities": ["messaging", "e2e", "invites"],
  "federation": {
    "enabled": true,
    "inbound": true,
    "outbound": true
  }
}
```

| Field          | Description                                        |
|----------------|----------------------------------------------------|
| `version`      | MMP protocol version                               |
| `server`       | Server implementation name                         |
| `mcp_endpoint` | Path to the MCP transport endpoint                 |
| `public_key`   | Server signing key for federation message integrity |
| `capabilities` | List of supported features                         |
| `federation`   | Federation configuration                           |

### 12.3 Cross-Server Message Delivery

When Server A sends a message to a user on Server B:

1. Server A resolves `@user@serverB.com` by fetching `https://serverB.com/.well-known/mmp.json`.
2. Server A looks up the recipient's public key from Server B's user directory (future endpoint).
3. Server A encrypts the message and sends it to Server B's federation inbox (future endpoint).
4. Server B validates the message signature, verifies the sender's identity, and delivers to the recipient.

### 12.4 Key Exchange Between Servers

Federation requires server-to-server authentication:

- Each server has a server-level signing key pair (Ed25519).
- Outbound messages are signed with the server's private key.
- Receiving servers verify signatures against the sending server's public key (from the discovery document).
- Trust is established via HTTPS and the discovery document (TOFU -- Trust On First Use).

### 12.5 Trust Model

Federation uses a Trust On First Use (TOFU) model:

1. On first contact, Server A fetches Server B's discovery document over HTTPS.
2. Server A caches Server B's public key.
3. Subsequent communications are verified against the cached key.
4. Key rotation is supported via the discovery document (servers SHOULD re-fetch periodically).

Federation is not implemented in v0.1 and is described here as a design direction for future versions.

---

## Appendix A: Database Schema

The reference implementation uses SQLite with the following schema. Compliant implementations MAY use any storage backend that satisfies the data model.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  privacy TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT '',
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  client_public_key TEXT,
  token_hash TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE handle_history (
  old_handle TEXT NOT NULL,
  new_handle TEXT NOT NULL,
  redirects_until INTEGER NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE thread_members (
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  reply_to TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sender_pub_key TEXT NOT NULL,
  encryption_mode TEXT NOT NULL DEFAULT 'e2e',
  created_at INTEGER NOT NULL
);

CREATE TABLE contacts (
  user_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id)
);

CREATE TABLE blocks (
  user_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  pending_message TEXT,
  created_at INTEGER NOT NULL,
  claimed_by TEXT,
  claimed_at INTEGER
);

-- Recommended indexes
CREATE INDEX idx_messages_thread ON messages(thread_id);
CREATE INDEX idx_messages_to ON messages(to_user_id);
CREATE INDEX idx_thread_members_user ON thread_members(user_id);
CREATE INDEX idx_users_handle ON users(handle);
```

## Appendix B: Token and Key Formats

| Artifact         | Format                                  | Length      | Example                              |
|------------------|-----------------------------------------|-------------|--------------------------------------|
| Token            | `sk_` + 32 random bytes as hex          | 67 chars    | `sk_a1b2c3...` (67 total)            |
| Token hash       | SHA-256 hex                             | 64 chars    | `e3b0c442...` (64 hex digits)        |
| Recovery code    | `XXXX-XXXX-XXXX` (base32-like)          | 14 chars    | `AB3K-9TW2-HNPQ`                     |
| Public key       | Base64-encoded 32 bytes                 | 44 chars    | `dGVzdC1wdWJsaWMta2V5LTMyYnl0ZXMh`  |
| Private key      | Base64-encoded 32 bytes                 | 44 chars    | (same format as public key)          |
| User ID          | UUID v4                                 | 36 chars    | `550e8400-e29b-41d4-a716-446655440000`|
| Thread ID        | UUID v4                                 | 36 chars    | (same format as User ID)             |
| Message ID       | UUID v4                                 | 36 chars    | (same format as User ID)             |
| Invite code      | Random string                           | >= 16 chars | (implementation-defined)             |

## Appendix C: Recovery Code Alphabet

The recovery code uses a 32-character alphabet that excludes visually ambiguous characters:

```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

Excluded characters and rationale:
- `0` (zero) -- confused with `O`
- `1` (one) -- confused with `I` or `l`
- `I` (uppercase i) -- confused with `1` or `l`
- `O` (uppercase o) -- confused with `0`

## Appendix D: MCP Transport Configuration

To connect to an MMP server, an MCP client configuration entry looks like:

```json
{
  "mcpServers": {
    "mmp": {
      "url": "https://mmp.example.com/mcp?token=sk_<your_token>"
    }
  }
}
```

For unauthenticated access (registration/recovery only):

```json
{
  "mcpServers": {
    "mmp": {
      "url": "https://mmp.example.com/mcp"
    }
  }
}
```

---

*End of MMP Specification v0.1.0*
