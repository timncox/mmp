# MMP — Model Messaging Protocol

Person-to-person messaging through AI assistants. Send and receive encrypted messages using any MCP-capable client — Claude, ChatGPT, Copilot, Goose, and more.

**Live at [mmp.chat](https://mmp.chat)** | [Protocol Spec](https://mmp.chat/spec)

## What is MMP?

MMP is an MCP extension protocol that makes your AI assistant a messaging client. Instead of messaging through Slack, email, or iMessage, you message through your AI — using `@handles` just like any other platform.

```
You:    "Send @alice hey, want to grab coffee tomorrow?"
Claude: Message sent to @alice via MMP.

You:    "Send @bob@their-server.com joining the project next week"
Claude: Message sent to @bob@their-server.com via federation.
```

Your AI assistant becomes the interface. No app to install, no account to create on a website — just connect the MCP server and start messaging.

## Features

- **Handle-based identity** — `@username` namespace, discoverable, portable
- **End-to-end encryption** — NaCl box (X25519 + XSalsa20-Poly1305) for all messages
- **Dual encryption modes** — true E2E for MCP App clients, server-assisted for text-only AI clients
- **Forward secrecy** — epoch-based key rotation, old keys preserved for decrypting history
- **Federation** — `@user@server.com` addressing, server-to-server delivery with Ed25519 signed requests
- **Group messaging** — create groups, manage members, fan-out encrypted delivery
- **File attachments** — send base64-encoded files with messages, encrypted per-recipient
- **Works everywhere** — any MCP client over Streamable HTTP transport
- **MCP App inbox** — browser-based UI with client-side crypto for MCP clients that support apps
- **Invite system** — generate invite links to onboard friends
- **AI-native recovery** — tokens saved to AI memory, recovery codes as fallback

## Quick Start

### Connect to mmp.chat

Add this MCP server to your AI client:

```
URL: https://mmp.chat/mcp
```

Then tell your AI: **"Register as @yourname on MMP"**

You'll get a token (saved automatically) and a recovery code. That's it — you're on MMP.

### Self-Host

```bash
cd server
npm install
npm run dev
```

The server starts on port 3777. Set `MMP_DB_PATH` for persistent storage.

For federation, set `MMP_SERVER_URL` to your public URL (e.g., `https://mmp.example.com`).

#### Docker

```bash
docker build -t mmp .
docker run -p 3777:3777 -v mmp-data:/data -e MMP_SERVER_URL=https://mmp.example.com mmp
```

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3777` | Server port |
| `MMP_DB_PATH` | `./mmp.db` | SQLite database path |
| `MMP_SERVER_URL` | `http://localhost:3777` | Public URL (required for federation) |

## MCP Tools

### Identity
| Tool | Description |
|------|-------------|
| `mmp-register` | Create an account, get a token and recovery code |
| `mmp-recover` | Recover access with your recovery code |
| `mmp-whoami` | Check your identity and auth status |
| `mmp-change_handle` | Change your @handle (30-day redirect) |
| `mmp-set_profile` | Update display name, bio, status, privacy |

### Messaging
| Tool | Description |
|------|-------------|
| `mmp-send` | Send a message — local DMs, groups, or federated (`@user@server`) |
| `mmp-reply` | Reply in a thread, with optional file attachments |
| `mmp-inbox` | Get your messages (filterable by time, unread) |
| `mmp-threads` | List threads with previews and unread counts |
| `mmp-thread` | View a single thread with all messages and attachments |
| `mmp-digest` | Get a summary digest of recent activity |

### Groups
| Tool | Description |
|------|-------------|
| `mmp-create-group` | Create a group thread with initial members |
| `mmp-add-member` | Add a member to a group (owner/admin only) |
| `mmp-remove-member` | Remove a member or leave a group |

### Security & Automation
| Tool | Description |
|------|-------------|
| `mmp-rotate-keys` | Rotate encryption keys for forward secrecy |
| `mmp-set-webhook` | Register a webhook URL for real-time push notifications |

### Organization
| Tool | Description |
|------|-------------|
| `mmp-contacts` | Manage your contact list |
| `mmp-add_contact` | Add someone to contacts |
| `mmp-lookup` | Look up a user's profile by handle |
| `mmp-search-users` | Search for users |
| `mmp-block` | Block/unblock a user |
| `mmp-mark-read` | Mark a thread as read |
| `mmp-archive` | Archive a thread |
| `mmp-star` | Star/unstar a thread |
| `mmp-mute` | Mute/unmute a thread |
| `mmp-invite` | Generate an invite link |
| `mmp-open-inbox` | Open the MCP App inbox UI |

## Encryption

All messages are encrypted using NaCl `crypto_box` (X25519 key agreement + XSalsa20-Poly1305 authenticated encryption).

**Server-assisted mode** (default): The server holds key pairs and encrypts/decrypts on behalf of text-only MCP clients. Your AI sees plaintext; the database stores ciphertext.

**E2E mode**: MCP App clients generate their own key pair in the browser. The server never sees plaintext. Pass `encrypted_payload` to `mmp-send` instead of `body`.

**Group encryption**: Messages are fan-out encrypted — one ciphertext per recipient, each encrypted with that recipient's public key. Same for file attachments.

## Forward Secrecy

MMP supports epoch-based key rotation for forward secrecy:

```
You: "Rotate my MMP keys"
Claude: Keys rotated. New epoch: 3. Old messages remain decryptable.
```

- Call `mmp-rotate-keys` to generate a fresh X25519 key pair
- The old key pair is retired but preserved — historical messages still decrypt
- New messages use the latest keys automatically
- Each message is tagged with its encryption epoch
- Rotate periodically (e.g., weekly) for better security posture
- If a key is compromised, only messages encrypted with that epoch are exposed

## Federation

MMP servers can exchange messages across instances using `@user@server` addressing:

```
You: "Send @alice@other-server.com hello from my server!"
Claude: Message sent via federation to @alice@other-server.com
```

### How it works

1. **Discovery**: Servers publish `/.well-known/mmp.json` with their MCP endpoint, federation endpoint, and Ed25519 signing key
2. **User lookup**: `GET /federation/lookup?handle=alice` returns public profile + current encryption key
3. **Message delivery**: `POST /federation/deliver` accepts an encrypted envelope signed by the sending server
4. **Verification**: Receiving server fetches the sender's `.well-known/mmp.json` to verify the Ed25519 signature

### Security model

- All server-to-server requests are signed with Ed25519 (not HMAC — no shared secrets)
- Messages are encrypted with the recipient's public key before transit
- The sending server encrypts; the receiving server stores the ciphertext
- Remote users are cached locally but keys are re-fetched on send
- Server identity keys are generated on first boot and stored in the database

### Setting up federation

```bash
# Set your public URL so other servers can discover you
export MMP_SERVER_URL=https://mmp.example.com

# Start the server — federation endpoints are enabled automatically
npm run dev

# Verify discovery endpoint
curl https://mmp.example.com/.well-known/mmp.json
```

## File Attachments

Send files with any message by including the `attachments` parameter:

```json
{
  "to": "alice",
  "body": "Here's that document",
  "attachments": [
    {
      "filename": "notes.pdf",
      "mime_type": "application/pdf",
      "data": "<base64-encoded content>"
    }
  ]
}
```

Attachments are encrypted per-recipient, same as message bodies. They work across DMs, groups, and federated messages.

## Webhooks

Register a webhook URL to get real-time push notifications instead of polling:

```
You: "Set up a webhook at https://my-server.com/hooks/mmp"
Claude: Webhook registered. You'll get a POST on every new message.
```

When a message arrives, MMP POSTs to your URL:

```json
{
  "event": "message.received",
  "message_id": "uuid",
  "thread_id": "uuid",
  "from_handle": "alice",
  "to_handle": "your-agent",
  "priority": "normal",
  "has_attachments": false,
  "timestamp": 1711500000
}
```

Requests include an `X-MMP-Signature` header (HMAC-SHA256 of the body using your webhook secret) and `X-MMP-Event` header. Use `mmp-set-webhook` with `action: "status"` to check your current webhook, or `action: "remove"` to delete it.

## Agent-to-Agent Messaging

MMP treats agents as first-class participants. Any MCP client — human or automated — can register a handle and communicate with any other.

**Same inbox, any AI**: Register `@yourname` once. Access the same inbox from Claude, ChatGPT, Copilot, or any MCP client by connecting with the same token. Your messages, threads, and contacts are shared.

**Separate identities**: Register different handles (`@tim`, `@tims-research-bot`) with separate tokens for different purposes. Each has its own inbox, contacts, and keys.

**Cross-platform agent pipelines**: A Claude agent sends results to a GPT agent, which forwards a summary to a human — all over encrypted MMP messages with webhook-driven real-time delivery.

Example flow:
1. `@data-collector` (GPT) gathers data, sends to `@analyzer` (Claude) via MMP
2. `@analyzer` receives a webhook push, processes the data, sends findings to `@reviewer` (human)
3. `@reviewer` reads the findings in their AI client and replies — the reply flows back through the chain

## Architecture

```
mmp/
├── server/
│   ├── server.ts         # Entry point, Express routes, MCP transport
│   ├── lib/
│   │   ├── db.ts         # SQLite schema + queries (better-sqlite3)
│   │   ├── crypto.ts     # NaCl encryption/decryption
│   │   ├── federation.ts # Handle parsing, discovery, S2S auth
│   │   ├── webhooks.ts   # Webhook dispatch (HMAC-signed push)
│   │   ├── auth.ts       # Token extraction + authentication
│   │   └── types.ts      # TypeScript interfaces
│   ├── routes/
│   │   └── federation.ts # .well-known, /federation/deliver, /federation/lookup
│   └── tools/            # One file per MCP tool (26 tools)
├── app/                  # MCP App inbox UI (Vite + TypeScript)
│   └── src/
│       ├── crypto/       # Client-side NaCl for E2E mode
│       └── views/        # Inbox, thread, compose, settings views
├── spec/                 # Protocol specification
└── Dockerfile            # Production container
```

**Stack**: Express 5, MCP SDK (Streamable HTTP), better-sqlite3, TweetNaCl, Vite

**Deployed on**: Railway with persistent SQLite volume

## Protocol

See the full [MMP Protocol Specification](https://mmp.chat/spec) for details on:

- Identity model and handle resolution
- Authentication (token-in-URL, SHA-256 hashed storage)
- Encryption modes and key management
- Message format and thread semantics
- Privacy levels and blocking
- Federation protocol (server discovery, signed delivery)
- Forward secrecy (epoch-based key rotation)

## License

MIT
