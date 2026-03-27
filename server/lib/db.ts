import Database from "better-sqlite3";
import type {
  User,
  Thread,
  ThreadMember,
  Message,
  Contact,
  Block,
  Invite,
  HandleHistory,
  ThreadWithPreview,
  Attachment,
  RemoteUser,
  ServerIdentity,
  KeyEpoch,
  Webhook,
} from "./types.js";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export interface Db {
  // Users
  createUser(user: User): void;
  getUserById(id: string): User | undefined;
  getUserByHandle(handle: string): User | undefined;
  getUserByTokenHash(hash: string): User | undefined;
  updateUser(id: string, fields: Partial<Omit<User, "id">>): void;
  searchUsers(query: string): User[];

  // Handle history
  addHandleRedirect(entry: HandleHistory): void;
  resolveHandle(handle: string): string;

  // Threads
  createThread(thread: Thread): void;
  getThread(id: string): Thread | undefined;
  getThreadMembers(threadId: string): ThreadMember[];
  getThreadMember(threadId: string, userId: string): ThreadMember | undefined;
  getThreadsForUser(userId: string): ThreadWithPreview[];
  updateThreadTimestamp(threadId: string): void;
  updateThreadMemberState(
    threadId: string,
    userId: string,
    state: ThreadMember["state"],
  ): void;
  updateLastReadAt(threadId: string, userId: string): void;
  findThreadBetweenUsers(userA: string, userB: string): Thread | undefined;

  // Messages
  createMessage(message: Message): void;
  getMessagesForThread(
    threadId: string,
    limit?: number,
    before?: number,
  ): Message[];
  getMessagesForUser(
    userId: string,
    limit?: number,
    before?: number,
  ): Message[];
  getUnreadCountForThread(threadId: string, userId: string): number;

  // Contacts
  addContact(contact: Contact): void;
  removeContact(userId: string, contactId: string): void;
  getContacts(userId: string): Contact[];
  isContact(userId: string, contactId: string): boolean;

  // Blocks
  addBlock(block: Block): void;
  removeBlock(userId: string, blockedId: string): void;
  isBlocked(userId: string, blockedId: string): boolean;

  // Invites
  createInvite(invite: Invite): void;
  getInvite(code: string): Invite | undefined;
  claimInvite(code: string, claimedBy: string): void;

  // Attachments
  createAttachment(attachment: Attachment): void;
  getAttachmentsForMessage(messageId: string): Attachment[];

  // Group operations
  addThreadMember(threadId: string, userId: string, role?: string): void;
  removeThreadMember(threadId: string, userId: string): void;
  getThreadMemberCount(threadId: string): number;
  updateThreadMemberRole(threadId: string, userId: string, role: string): void;

  // Remote users (federation)
  upsertRemoteUser(user: RemoteUser): void;
  getRemoteUser(handle: string, server: string): RemoteUser | undefined;
  getRemoteUserById(id: string): RemoteUser | undefined;

  // Server identity (federation)
  getServerIdentity(serverUrl: string): ServerIdentity | undefined;
  setServerIdentity(identity: ServerIdentity): void;

  // Key epochs (forward secrecy)
  createKeyEpoch(epoch: KeyEpoch): void;
  getCurrentEpoch(userId: string): KeyEpoch | undefined;
  getKeyEpoch(userId: string, epoch: number): KeyEpoch | undefined;
  getKeyEpochs(userId: string): KeyEpoch[];
  retireEpoch(userId: string, epoch: number): void;

  // Webhooks
  setWebhook(webhook: Webhook): void;
  getWebhook(userId: string): Webhook | undefined;
  removeWebhook(userId: string): void;

  // Raw access
  raw: Database.Database;
}

export function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE TABLE IF NOT EXISTS handle_history (
      old_handle TEXT NOT NULL,
      new_handle TEXT NOT NULL,
      redirects_until INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'dm',
      name TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      state TEXT NOT NULL DEFAULT 'active',
      last_read_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (thread_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
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
      key_epoch INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      user_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      PRIMARY KEY (user_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      pending_message TEXT,
      created_at INTEGER NOT NULL,
      claimed_by TEXT,
      claimed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      ciphertext TEXT NOT NULL,
      nonce TEXT NOT NULL,
      encryption_mode TEXT NOT NULL DEFAULT 'server_assisted',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remote_users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      server TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      public_key TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      UNIQUE(handle, server)
    );

    CREATE TABLE IF NOT EXISTS server_identity (
      server_url TEXT PRIMARY KEY,
      signing_public_key TEXT NOT NULL,
      signing_private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_epochs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retired_at INTEGER,
      UNIQUE(user_id, epoch)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_thread_members_user ON thread_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
    CREATE TABLE IF NOT EXISTS webhooks (
      user_id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT 'message.received',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_key_epochs_user ON key_epochs(user_id, epoch);
    CREATE INDEX IF NOT EXISTS idx_remote_users_handle ON remote_users(handle, server);
  `);

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(threads)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("type")) {
    db.exec("ALTER TABLE threads ADD COLUMN type TEXT NOT NULL DEFAULT 'dm'");
  }
  if (!colNames.has("name")) {
    db.exec("ALTER TABLE threads ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }

  // Add key_epoch to messages
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!new Set(msgCols.map((c) => c.name)).has("key_epoch")) {
    db.exec("ALTER TABLE messages ADD COLUMN key_epoch INTEGER NOT NULL DEFAULT 0");
  }

  const memberCols = db.prepare("PRAGMA table_info(thread_members)").all() as { name: string }[];
  const memberColNames = new Set(memberCols.map((c) => c.name));
  if (!memberColNames.has("role")) {
    db.exec("ALTER TABLE thread_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  }

  // Prepared statements
  const stmts = {
    insertUser: db.prepare(`
      INSERT INTO users (id, handle, display_name, bio, privacy, status,
        public_key, private_key, client_public_key, token_hash,
        recovery_code_hash, created_at, updated_at)
      VALUES (@id, @handle, @display_name, @bio, @privacy, @status,
        @public_key, @private_key, @client_public_key, @token_hash,
        @recovery_code_hash, @created_at, @updated_at)
    `),
    getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
    getUserByHandle: db.prepare("SELECT * FROM users WHERE handle = ?"),
    getUserByTokenHash: db.prepare(
      "SELECT * FROM users WHERE token_hash = ?",
    ),
    searchUsers: db.prepare(
      "SELECT * FROM users WHERE handle LIKE ? OR display_name LIKE ? LIMIT 50",
    ),

    insertHandleRedirect: db.prepare(
      "INSERT INTO handle_history (old_handle, new_handle, redirects_until) VALUES (@old_handle, @new_handle, @redirects_until)",
    ),
    resolveHandle: db.prepare(
      "SELECT new_handle FROM handle_history WHERE old_handle = ? AND redirects_until > ? ORDER BY redirects_until DESC LIMIT 1",
    ),

    insertThread: db.prepare(
      "INSERT INTO threads (id, type, name, subject, created_by, created_at, updated_at) VALUES (@id, @type, @name, @subject, @created_by, @created_at, @updated_at)",
    ),
    getThread: db.prepare("SELECT * FROM threads WHERE id = ?"),
    getThreadMembers: db.prepare(
      "SELECT * FROM thread_members WHERE thread_id = ?",
    ),
    getThreadMember: db.prepare(
      "SELECT * FROM thread_members WHERE thread_id = ? AND user_id = ?",
    ),
    insertThreadMember: db.prepare(
      "INSERT OR IGNORE INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (@thread_id, @user_id, @role, @state, @last_read_at)",
    ),
    updateThreadTimestamp: db.prepare(
      "UPDATE threads SET updated_at = ? WHERE id = ?",
    ),
    updateThreadMemberState: db.prepare(
      "UPDATE thread_members SET state = ? WHERE thread_id = ? AND user_id = ?",
    ),
    updateLastReadAt: db.prepare(
      "UPDATE thread_members SET last_read_at = ? WHERE thread_id = ? AND user_id = ?",
    ),

    insertMessage: db.prepare(`
      INSERT INTO messages (id, thread_id, from_user_id, to_user_id, reply_to,
        priority, ciphertext, nonce, sender_pub_key, encryption_mode, key_epoch, created_at)
      VALUES (@id, @thread_id, @from_user_id, @to_user_id, @reply_to,
        @priority, @ciphertext, @nonce, @sender_pub_key, @encryption_mode, @key_epoch, @created_at)
    `),
    getMessagesForThread: db.prepare(
      "SELECT * FROM messages WHERE thread_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
    ),
    getMessagesForUser: db.prepare(
      "SELECT * FROM messages WHERE to_user_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
    ),
    getUnreadCountForThread: db.prepare(`
      SELECT COUNT(*) as count FROM messages m
      JOIN thread_members tm ON tm.thread_id = m.thread_id AND tm.user_id = ?
      WHERE m.thread_id = ? AND m.created_at > tm.last_read_at AND m.from_user_id != ?
    `),

    insertContact: db.prepare(
      "INSERT OR REPLACE INTO contacts (user_id, contact_id, nickname, created_at) VALUES (@user_id, @contact_id, @nickname, @created_at)",
    ),
    removeContact: db.prepare(
      "DELETE FROM contacts WHERE user_id = ? AND contact_id = ?",
    ),
    getContacts: db.prepare("SELECT * FROM contacts WHERE user_id = ?"),
    isContact: db.prepare(
      "SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?",
    ),

    insertBlock: db.prepare(
      "INSERT OR REPLACE INTO blocks (user_id, blocked_id) VALUES (@user_id, @blocked_id)",
    ),
    removeBlock: db.prepare(
      "DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?",
    ),
    isBlocked: db.prepare(
      "SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?",
    ),

    insertInvite: db.prepare(
      "INSERT INTO invites (code, created_by, pending_message, created_at, claimed_by, claimed_at) VALUES (@code, @created_by, @pending_message, @created_at, @claimed_by, @claimed_at)",
    ),
    getInvite: db.prepare("SELECT * FROM invites WHERE code = ?"),
    claimInvite: db.prepare(
      "UPDATE invites SET claimed_by = ?, claimed_at = ? WHERE code = ?",
    ),

    // Attachments
    insertAttachment: db.prepare(`
      INSERT INTO attachments (id, message_id, filename, mime_type, size_bytes,
        ciphertext, nonce, encryption_mode, created_at)
      VALUES (@id, @message_id, @filename, @mime_type, @size_bytes,
        @ciphertext, @nonce, @encryption_mode, @created_at)
    `),
    getAttachmentsForMessage: db.prepare(
      "SELECT * FROM attachments WHERE message_id = ?",
    ),

    // Group operations
    removeThreadMember: db.prepare(
      "DELETE FROM thread_members WHERE thread_id = ? AND user_id = ?",
    ),
    getThreadMemberCount: db.prepare(
      "SELECT COUNT(*) as count FROM thread_members WHERE thread_id = ?",
    ),
    updateThreadMemberRole: db.prepare(
      "UPDATE thread_members SET role = ? WHERE thread_id = ? AND user_id = ?",
    ),

    // Remote users
    upsertRemoteUser: db.prepare(`
      INSERT OR REPLACE INTO remote_users (id, handle, server, display_name, public_key, fetched_at)
      VALUES (@id, @handle, @server, @display_name, @public_key, @fetched_at)
    `),
    getRemoteUser: db.prepare(
      "SELECT * FROM remote_users WHERE handle = ? AND server = ?",
    ),
    getRemoteUserById: db.prepare(
      "SELECT * FROM remote_users WHERE id = ?",
    ),

    // Server identity
    getServerIdentity: db.prepare(
      "SELECT * FROM server_identity WHERE server_url = ?",
    ),
    setServerIdentity: db.prepare(`
      INSERT OR REPLACE INTO server_identity (server_url, signing_public_key, signing_private_key, created_at)
      VALUES (@server_url, @signing_public_key, @signing_private_key, @created_at)
    `),

    // Key epochs
    insertKeyEpoch: db.prepare(`
      INSERT INTO key_epochs (user_id, epoch, public_key, private_key, created_at, retired_at)
      VALUES (@user_id, @epoch, @public_key, @private_key, @created_at, @retired_at)
    `),
    getCurrentEpoch: db.prepare(
      "SELECT * FROM key_epochs WHERE user_id = ? AND retired_at IS NULL ORDER BY epoch DESC LIMIT 1",
    ),
    getKeyEpoch: db.prepare(
      "SELECT * FROM key_epochs WHERE user_id = ? AND epoch = ?",
    ),
    getKeyEpochs: db.prepare(
      "SELECT * FROM key_epochs WHERE user_id = ? ORDER BY epoch ASC",
    ),
    retireEpoch: db.prepare(
      "UPDATE key_epochs SET retired_at = ? WHERE user_id = ? AND epoch = ?",
    ),

    // Webhooks
    setWebhook: db.prepare(`
      INSERT OR REPLACE INTO webhooks (user_id, url, secret, events, created_at)
      VALUES (@user_id, @url, @secret, @events, @created_at)
    `),
    getWebhook: db.prepare("SELECT * FROM webhooks WHERE user_id = ?"),
    removeWebhook: db.prepare("DELETE FROM webhooks WHERE user_id = ?"),

    findThreadBetweenUsers: db.prepare(`
      SELECT t.* FROM threads t
      JOIN thread_members tm1 ON tm1.thread_id = t.id AND tm1.user_id = ?
      JOIN thread_members tm2 ON tm2.thread_id = t.id AND tm2.user_id = ?
      LIMIT 1
    `),

    getThreadsForUser: db.prepare(`
      SELECT
        t.*,
        CASE WHEN t.type = 'dm' THEN other_user.handle ELSE NULL END AS other_handle,
        CASE WHEN t.type = 'dm' THEN other_user.display_name ELSE NULL END AS other_display_name,
        (SELECT COUNT(*) FROM thread_members WHERE thread_id = t.id) AS member_count,
        tm.state AS member_state,
        COALESCE(
          (SELECT m.created_at FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
          t.created_at
        ) AS last_message_at,
        COALESCE(
          (SELECT m.ciphertext FROM messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
          NULL
        ) AS last_message_body,
        (
          SELECT COUNT(*) FROM messages m
          WHERE m.thread_id = t.id AND m.created_at > tm.last_read_at AND m.from_user_id != ?
        ) AS unread_count
      FROM threads t
      JOIN thread_members tm ON tm.thread_id = t.id AND tm.user_id = ?
      LEFT JOIN thread_members tm2 ON tm2.thread_id = t.id AND tm2.user_id != ? AND t.type = 'dm'
      LEFT JOIN users other_user ON other_user.id = tm2.user_id
      GROUP BY t.id
      ORDER BY last_message_at DESC
    `),
  };

  return {
    // Users
    createUser(user: User): void {
      stmts.insertUser.run(user);
    },

    getUserById(id: string): User | undefined {
      return stmts.getUserById.get(id) as User | undefined;
    },

    getUserByHandle(handle: string): User | undefined {
      return stmts.getUserByHandle.get(handle) as User | undefined;
    },

    getUserByTokenHash(hash: string): User | undefined {
      return stmts.getUserByTokenHash.get(hash) as User | undefined;
    },

    updateUser(id: string, fields: Partial<Omit<User, "id">>): void {
      const ALLOWED_COLS = new Set([
        "handle", "display_name", "bio", "privacy", "status",
        "public_key", "private_key", "client_public_key",
        "token_hash", "recovery_code_hash",
      ]);
      const safeKeys = Object.keys(fields).filter((k) => ALLOWED_COLS.has(k));
      if (safeKeys.length === 0) return;
      const sets = safeKeys.map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE users SET ${sets}, updated_at = @updated_at WHERE id = @id`).run({
        ...fields,
        updated_at: now(),
        id,
      });
    },

    searchUsers(query: string): User[] {
      const pattern = `%${query}%`;
      return stmts.searchUsers.all(pattern, pattern) as User[];
    },

    // Handle history
    addHandleRedirect(entry: HandleHistory): void {
      stmts.insertHandleRedirect.run(entry);
    },

    resolveHandle(handle: string): string {
      const row = stmts.resolveHandle.get(handle, now()) as
        | { new_handle: string }
        | undefined;
      return row ? row.new_handle : handle;
    },

    // Threads
    createThread(thread: Thread): void {
      stmts.insertThread.run(thread);
    },

    getThread(id: string): Thread | undefined {
      return stmts.getThread.get(id) as Thread | undefined;
    },

    getThreadMembers(threadId: string): ThreadMember[] {
      return stmts.getThreadMembers.all(threadId) as ThreadMember[];
    },

    getThreadMember(
      threadId: string,
      userId: string,
    ): ThreadMember | undefined {
      return stmts.getThreadMember.get(threadId, userId) as
        | ThreadMember
        | undefined;
    },

    getThreadsForUser(userId: string): ThreadWithPreview[] {
      return stmts.getThreadsForUser.all(
        userId,
        userId,
        userId,
      ) as ThreadWithPreview[];
    },

    updateThreadTimestamp(threadId: string): void {
      stmts.updateThreadTimestamp.run(now(), threadId);
    },

    updateThreadMemberState(
      threadId: string,
      userId: string,
      state: ThreadMember["state"],
    ): void {
      stmts.updateThreadMemberState.run(state, threadId, userId);
    },

    updateLastReadAt(threadId: string, userId: string): void {
      stmts.updateLastReadAt.run(now(), threadId, userId);
    },

    findThreadBetweenUsers(
      userA: string,
      userB: string,
    ): Thread | undefined {
      return stmts.findThreadBetweenUsers.get(userA, userB) as
        | Thread
        | undefined;
    },

    // Messages
    createMessage(message: Message): void {
      stmts.insertMessage.run(message);
    },

    getMessagesForThread(
      threadId: string,
      limit = 50,
      before?: number,
    ): Message[] {
      const ts = before ?? now() + 1;
      return stmts.getMessagesForThread.all(threadId, ts, limit) as Message[];
    },

    getMessagesForUser(
      userId: string,
      limit = 50,
      before?: number,
    ): Message[] {
      const ts = before ?? now() + 1;
      return stmts.getMessagesForUser.all(userId, ts, limit) as Message[];
    },

    getUnreadCountForThread(threadId: string, userId: string): number {
      const row = stmts.getUnreadCountForThread.get(
        userId,
        threadId,
        userId,
      ) as { count: number };
      return row.count;
    },

    // Contacts
    addContact(contact: Contact): void {
      stmts.insertContact.run(contact);
    },

    removeContact(userId: string, contactId: string): void {
      stmts.removeContact.run(userId, contactId);
    },

    getContacts(userId: string): Contact[] {
      return stmts.getContacts.all(userId) as Contact[];
    },

    isContact(userId: string, contactId: string): boolean {
      return !!stmts.isContact.get(userId, contactId);
    },

    // Blocks
    addBlock(block: Block): void {
      stmts.insertBlock.run(block);
    },

    removeBlock(userId: string, blockedId: string): void {
      stmts.removeBlock.run(userId, blockedId);
    },

    isBlocked(userId: string, blockedId: string): boolean {
      return !!stmts.isBlocked.get(userId, blockedId);
    },

    // Invites
    createInvite(invite: Invite): void {
      stmts.insertInvite.run(invite);
    },

    getInvite(code: string): Invite | undefined {
      return stmts.getInvite.get(code) as Invite | undefined;
    },

    claimInvite(code: string, claimedBy: string): void {
      stmts.claimInvite.run(claimedBy, now(), code);
    },

    // Remote users
    upsertRemoteUser(user: RemoteUser): void {
      stmts.upsertRemoteUser.run(user);
    },

    getRemoteUser(handle: string, server: string): RemoteUser | undefined {
      return stmts.getRemoteUser.get(handle, server) as RemoteUser | undefined;
    },

    getRemoteUserById(id: string): RemoteUser | undefined {
      return stmts.getRemoteUserById.get(id) as RemoteUser | undefined;
    },

    // Server identity
    getServerIdentity(serverUrl: string): ServerIdentity | undefined {
      return stmts.getServerIdentity.get(serverUrl) as ServerIdentity | undefined;
    },

    setServerIdentity(identity: ServerIdentity): void {
      stmts.setServerIdentity.run(identity);
    },

    // Key epochs
    createKeyEpoch(epoch: KeyEpoch): void {
      stmts.insertKeyEpoch.run(epoch);
    },

    getCurrentEpoch(userId: string): KeyEpoch | undefined {
      return stmts.getCurrentEpoch.get(userId) as KeyEpoch | undefined;
    },

    getKeyEpoch(userId: string, epoch: number): KeyEpoch | undefined {
      return stmts.getKeyEpoch.get(userId, epoch) as KeyEpoch | undefined;
    },

    getKeyEpochs(userId: string): KeyEpoch[] {
      return stmts.getKeyEpochs.all(userId) as KeyEpoch[];
    },

    retireEpoch(userId: string, epoch: number): void {
      stmts.retireEpoch.run(now(), userId, epoch);
    },

    // Attachments
    createAttachment(attachment: Attachment): void {
      stmts.insertAttachment.run(attachment);
    },

    getAttachmentsForMessage(messageId: string): Attachment[] {
      return stmts.getAttachmentsForMessage.all(messageId) as Attachment[];
    },

    // Group operations
    addThreadMember(threadId: string, userId: string, role = "member"): void {
      stmts.insertThreadMember.run({
        thread_id: threadId,
        user_id: userId,
        role,
        state: "active",
        last_read_at: 0,
      });
    },

    removeThreadMember(threadId: string, userId: string): void {
      stmts.removeThreadMember.run(threadId, userId);
    },

    getThreadMemberCount(threadId: string): number {
      const row = stmts.getThreadMemberCount.get(threadId) as { count: number };
      return row.count;
    },

    updateThreadMemberRole(threadId: string, userId: string, role: string): void {
      stmts.updateThreadMemberRole.run(role, threadId, userId);
    },

    // Webhooks
    setWebhook(webhook: Webhook): void {
      stmts.setWebhook.run(webhook);
    },

    getWebhook(userId: string): Webhook | undefined {
      return stmts.getWebhook.get(userId) as Webhook | undefined;
    },

    removeWebhook(userId: string): void {
      stmts.removeWebhook.run(userId);
    },

    // Raw access
    raw: db,
  };
}
