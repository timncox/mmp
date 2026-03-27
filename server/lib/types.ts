export interface User {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  privacy: "public" | "contacts_only" | "private";
  status: string;
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
  subject: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface ThreadMember {
  thread_id: string;
  user_id: string;
  state: "active" | "archived" | "muted" | "starred";
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
  created_at: number;
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

export interface ThreadWithPreview extends Thread {
  other_handle: string;
  other_display_name: string;
  last_message_body: string | null;
  last_message_at: number;
  unread_count: number;
  member_state: ThreadMember["state"];
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
