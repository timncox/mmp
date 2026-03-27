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
      subject TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_members (
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_thread_members_user ON thread_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
  `);

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
      "INSERT INTO threads (id, subject, created_by, created_at, updated_at) VALUES (@id, @subject, @created_by, @created_at, @updated_at)",
    ),
    getThread: db.prepare("SELECT * FROM threads WHERE id = ?"),
    getThreadMembers: db.prepare(
      "SELECT * FROM thread_members WHERE thread_id = ?",
    ),
    getThreadMember: db.prepare(
      "SELECT * FROM thread_members WHERE thread_id = ? AND user_id = ?",
    ),
    insertThreadMember: db.prepare(
      "INSERT INTO thread_members (thread_id, user_id, state, last_read_at) VALUES (@thread_id, @user_id, @state, @last_read_at)",
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
        priority, ciphertext, nonce, sender_pub_key, encryption_mode, created_at)
      VALUES (@id, @thread_id, @from_user_id, @to_user_id, @reply_to,
        @priority, @ciphertext, @nonce, @sender_pub_key, @encryption_mode, @created_at)
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

    findThreadBetweenUsers: db.prepare(`
      SELECT t.* FROM threads t
      JOIN thread_members tm1 ON tm1.thread_id = t.id AND tm1.user_id = ?
      JOIN thread_members tm2 ON tm2.thread_id = t.id AND tm2.user_id = ?
      LIMIT 1
    `),

    getThreadsForUser: db.prepare(`
      SELECT
        t.*,
        other_user.handle AS other_handle,
        other_user.display_name AS other_display_name,
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
      JOIN thread_members tm2 ON tm2.thread_id = t.id AND tm2.user_id != ?
      JOIN users other_user ON other_user.id = tm2.user_id
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
      const sets = Object.keys(fields)
        .map((k) => `${k} = @${k}`)
        .join(", ");
      if (!sets) return;
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

    // Raw access
    raw: db,
  };
}
