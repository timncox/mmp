import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type Db } from "./db.js";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

let db: Db;
let dbPath: string;

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `mmp-test-${randomUUID()}.db`);
  db = createDb(dbPath);
});

afterEach(() => {
  db.raw.close();
  try {
    fs.unlinkSync(dbPath);
    fs.unlinkSync(dbPath + "-wal");
    fs.unlinkSync(dbPath + "-shm");
  } catch {
    // ignore cleanup errors
  }
});

function makeUser(overrides: Partial<import("./types.js").User> = {}): import("./types.js").User {
  const id = randomUUID();
  return {
    id,
    handle: `user_${id.slice(0, 8)}`,
    display_name: "Test User",
    bio: "",
    privacy: "public",
    status: "",
    public_key: "pk_test",
    private_key: "sk_test",
    client_public_key: null,
    token_hash: `hash_${id}`,
    recovery_code_hash: `recovery_${id}`,
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("Database", () => {
  describe("table creation", () => {
    it("should create all tables", () => {
      const tables = db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain("users");
      expect(names).toContain("threads");
      expect(names).toContain("thread_members");
      expect(names).toContain("messages");
      expect(names).toContain("contacts");
      expect(names).toContain("blocks");
      expect(names).toContain("invites");
      expect(names).toContain("handle_history");
    });

    it("should create indexes", () => {
      const indexes = db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'",
        )
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain("idx_messages_thread");
      expect(names).toContain("idx_messages_to");
      expect(names).toContain("idx_thread_members_user");
      expect(names).toContain("idx_users_handle");
    });
  });

  describe("user CRUD", () => {
    it("should create and retrieve a user by id", () => {
      const user = makeUser();
      db.createUser(user);
      const found = db.getUserById(user.id);
      expect(found).toBeDefined();
      expect(found!.handle).toBe(user.handle);
      expect(found!.display_name).toBe("Test User");
    });

    it("should retrieve user by handle", () => {
      const user = makeUser({ handle: "alice" });
      db.createUser(user);
      const found = db.getUserByHandle("alice");
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
    });

    it("should retrieve user by token hash", () => {
      const user = makeUser({ token_hash: "abc123" });
      db.createUser(user);
      const found = db.getUserByTokenHash("abc123");
      expect(found).toBeDefined();
      expect(found!.id).toBe(user.id);
    });

    it("should update user fields", () => {
      const user = makeUser();
      db.createUser(user);
      db.updateUser(user.id, { display_name: "Updated Name", bio: "Hello" });
      const found = db.getUserById(user.id)!;
      expect(found.display_name).toBe("Updated Name");
      expect(found.bio).toBe("Hello");
    });

    it("should search users by handle or display_name", () => {
      const user = makeUser({ handle: "searchable_handle", display_name: "Searchable User" });
      db.createUser(user);
      const results = db.searchUsers("searchable");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].id).toBe(user.id);
    });

    it("should return undefined for non-existent user", () => {
      expect(db.getUserById("nonexistent")).toBeUndefined();
      expect(db.getUserByHandle("nonexistent")).toBeUndefined();
    });
  });

  describe("handle uniqueness", () => {
    it("should reject duplicate handles", () => {
      const user1 = makeUser({ handle: "unique_handle" });
      const user2 = makeUser({ handle: "unique_handle" });
      db.createUser(user1);
      expect(() => db.createUser(user2)).toThrow();
    });
  });

  describe("threads and members", () => {
    it("should create a thread and add members", () => {
      const user1 = makeUser();
      const user2 = makeUser();
      db.createUser(user1);
      db.createUser(user2);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "Test Thread",
        created_by: user1.id,
        created_at: ts,
        updated_at: ts,
      });

      // Add members via raw since createThread doesn't add members
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user1.id);
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user2.id);

      const thread = db.getThread(threadId);
      expect(thread).toBeDefined();
      expect(thread!.subject).toBe("Test Thread");

      const members = db.getThreadMembers(threadId);
      expect(members).toHaveLength(2);

      const member = db.getThreadMember(threadId, user1.id);
      expect(member).toBeDefined();
      expect(member!.state).toBe("active");
    });

    it("should find thread between two users", () => {
      const user1 = makeUser();
      const user2 = makeUser();
      db.createUser(user1);
      db.createUser(user2);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "",
        created_by: user1.id,
        created_at: ts,
        updated_at: ts,
      });
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user1.id);
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user2.id);

      const found = db.findThreadBetweenUsers(user1.id, user2.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(threadId);
    });

    it("should update thread member state", () => {
      const user = makeUser();
      db.createUser(user);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "",
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
      });
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user.id);

      db.updateThreadMemberState(threadId, user.id, "archived");
      const member = db.getThreadMember(threadId, user.id)!;
      expect(member.state).toBe("archived");
    });
  });

  describe("message insert and retrieve", () => {
    it("should insert and retrieve messages for a thread", () => {
      const user1 = makeUser();
      const user2 = makeUser();
      db.createUser(user1);
      db.createUser(user2);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "",
        created_by: user1.id,
        created_at: ts,
        updated_at: ts,
      });
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user1.id);
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user2.id);

      const msgId = randomUUID();
      db.createMessage({
        id: msgId,
        thread_id: threadId,
        from_user_id: user1.id,
        to_user_id: user2.id,
        reply_to: null,
        priority: "normal",
        ciphertext: "encrypted_data",
        nonce: "nonce123",
        sender_pub_key: "pk_sender",
        encryption_mode: "e2e",
        key_epoch: 0,
        created_at: ts,
      });

      const messages = db.getMessagesForThread(threadId);
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(msgId);
      expect(messages[0].ciphertext).toBe("encrypted_data");
    });

    it("should retrieve messages for a user", () => {
      const user1 = makeUser();
      const user2 = makeUser();
      db.createUser(user1);
      db.createUser(user2);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "",
        created_by: user1.id,
        created_at: ts,
        updated_at: ts,
      });

      db.createMessage({
        id: randomUUID(),
        thread_id: threadId,
        from_user_id: user1.id,
        to_user_id: user2.id,
        reply_to: null,
        priority: "normal",
        ciphertext: "msg_for_user2",
        nonce: "nonce",
        sender_pub_key: "pk",
        encryption_mode: "e2e",
        key_epoch: 0,
        created_at: ts,
      });

      const messages = db.getMessagesForUser(user2.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].to_user_id).toBe(user2.id);
    });

    it("should count unread messages", () => {
      const user1 = makeUser();
      const user2 = makeUser();
      db.createUser(user1);
      db.createUser(user2);

      const threadId = randomUUID();
      const ts = Math.floor(Date.now() / 1000);
      db.createThread({
        id: threadId,
        type: "dm",
        name: "",
        subject: "",
        created_by: user1.id,
        created_at: ts,
        updated_at: ts,
      });
      db.raw
        .prepare(
          "INSERT INTO thread_members (thread_id, user_id, role, state, last_read_at) VALUES (?, ?, 'member', 'active', 0)",
        )
        .run(threadId, user2.id);

      // Add 3 messages from user1 to user2
      for (let i = 0; i < 3; i++) {
        db.createMessage({
          id: randomUUID(),
          thread_id: threadId,
          from_user_id: user1.id,
          to_user_id: user2.id,
          reply_to: null,
          priority: "normal",
          ciphertext: `msg_${i}`,
          nonce: "n",
          sender_pub_key: "pk",
          encryption_mode: "e2e",
        key_epoch: 0,
          created_at: ts + i + 1,
        });
      }

      const unread = db.getUnreadCountForThread(threadId, user2.id);
      expect(unread).toBe(3);
    });
  });
});
