export interface User {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  privacy: "public" | "contacts_only" | "private";
  status: string;
  type: "user" | "bot";
  capabilities: string; // JSON array stored as string
  public_key: string;
  private_key: string;
  client_public_key: string | null;
  token_hash: string;
  recovery_code_hash: string;
  created_at: number;
  updated_at: number;
}

export interface Thread {
  id: string;
  type: "dm" | "group";
  name: string;
  subject: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ThreadMember {
  thread_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  state: "active" | "archived" | "muted";
  starred: number; // 0 or 1 (SQLite boolean)
  last_read_at: number;
}

export interface Message {
  id: string;
  thread_id: string;
  from_user_id: string;
  to_user_id: string;
  reply_to: string | null;
  priority: "urgent" | "normal" | "low" | "fyi";
  ciphertext: string;
  nonce: string;
  sender_pub_key: string;
  encryption_mode: "e2e" | "server_assisted";
  key_epoch: number;
  created_at: number;
  content_type: "text" | "tool_call" | "tool_result" | "authorization_request" | "authorization_grant";
  call_id: string | null;
}

export interface Contact {
  user_id: string;
  contact_id: string;
  nickname: string;
  created_at: number;
}

export interface Block {
  user_id: string;
  blocked_id: string;
}

export interface Invite {
  code: string;
  created_by: string;
  pending_message: string | null;
  created_at: number;
  claimed_by: string | null;
  claimed_at: number | null;
}

export interface HandleHistory {
  old_handle: string;
  new_handle: string;
  redirects_until: number;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  ciphertext: string;
  nonce: string;
  encryption_mode: "e2e" | "server_assisted";
  created_at: number;
}

export interface ThreadWithPreview extends Thread {
  other_handle: string | null;
  other_display_name: string | null;
  member_count: number;
  last_message_body: string | null;
  last_message_at: number;
  unread_count: number;
  member_state: ThreadMember["state"];
  starred: number;
}

export interface DecryptedMessage {
  id: string;
  thread_id: string;
  from_handle: string;
  to_handle: string;
  body: string | null;
  priority: Message["priority"];
  encryption_mode: Message["encryption_mode"];
  reply_to: string | null;
  created_at: number;
}

export interface UserProfile {
  handle: string;
  display_name: string;
  bio: string;
  public_key: string;
  client_public_key: string | null;
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
}

// --- Federation types ---

export interface RemoteUser {
  id: string;
  handle: string;
  server: string;
  display_name: string;
  public_key: string;
  fetched_at: number;
}

export interface ServerIdentity {
  server_url: string;
  signing_public_key: string;
  signing_private_key: string;
  created_at: number;
}

export interface FederationEnvelope {
  from_handle: string;
  from_server: string;
  to_handle: string;
  ciphertext: string;
  nonce: string;
  sender_pub_key: string;
  encryption_mode: "e2e" | "server_assisted";
  key_epoch: number;
  priority: Message["priority"];
  attachments?: {
    filename: string;
    mime_type: string;
    size_bytes: number;
    ciphertext: string;
    nonce: string;
  }[];
  timestamp: number;
  signature: string;
}

export interface WellKnownMMP {
  protocol: "mmp";
  version: string;
  mcp_endpoint: string;
  federation_endpoint: string;
  signing_public_key: string;
  server_name: string;
}

// --- Key epoch types ---

export interface KeyEpoch {
  id: number;
  user_id: string;
  epoch: number;
  public_key: string;
  private_key: string;
  created_at: number;
  retired_at: number | null;
}

export interface ParsedHandle {
  user: string;
  server: string | null;
  isRemote: boolean;
}

// --- Webhook types ---

export interface Webhook {
  user_id: string;
  url: string;
  secret: string;
  events: string;
  created_at: number;
}

export interface WebhookPayload {
  event: "message.received" | "message.sent";
  message_id: string;
  thread_id: string;
  from_handle: string;
  to_handle: string;
  priority: string;
  has_attachments: boolean;
  timestamp: number;
  content_type?: string;
  call_id?: string;
}
