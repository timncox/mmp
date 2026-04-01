import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "../lib/db.js";
import { registerPending, resolvePending, hasPending } from "../lib/invoke-map.js";
import { v4 as uuidv4 } from "uuid";
import { generateKeyPair, generateToken, hashToken, generateRecoveryCode, encryptMessage } from "../lib/crypto.js";

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

// ─── Database — User type and capabilities ───────────────────────────────────

describe("Database — User type and capabilities", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("creates a bot user with type and capabilities that persist", () => {
    const caps = JSON.stringify([{ name: "weather", description: "Get weather" }]);
    const { user } = createTestUser(db, "weatherbot", { type: "bot", capabilities: caps });

    const found = db.getUserById(user.id);
    expect(found).toBeDefined();
    expect(found!.type).toBe("bot");
    expect(found!.capabilities).toBe(caps);
  });

  it("defaults type to 'user' and capabilities to '[]'", () => {
    const { user } = createTestUser(db, "alice");

    const found = db.getUserById(user.id);
    expect(found).toBeDefined();
    expect(found!.type).toBe("user");
    expect(found!.capabilities).toBe("[]");
  });

  it("updates type and capabilities via updateUser", () => {
    const { user } = createTestUser(db, "futurebot");

    const newCaps = JSON.stringify([{ name: "translate", description: "Translate text" }]);
    db.updateUser(user.id, { type: "bot", capabilities: newCaps });

    const found = db.getUserById(user.id);
    expect(found!.type).toBe("bot");
    expect(found!.capabilities).toBe(newCaps);
  });
});

// ─── Database — Message content_type and call_id ─────────────────────────────

describe("Database — Message content_type and call_id", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  function makeThread(db: Db, createdBy: string) {
    const threadId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    db.createThread({
      id: threadId,
      type: "dm",
      name: "",
      subject: "",
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    });
    return { threadId, now };
  }

  it("creates a message with content_type='tool_call' and a call_id that persist", () => {
    const { user: sender } = createTestUser(db, "sender");
    const { user: recipient } = createTestUser(db, "recipient");
    const { threadId, now } = makeThread(db, sender.id);

    const encrypted = encryptMessage(
      JSON.stringify({ tool: "weather", args: { city: "NYC" } }),
      recipient.public_key,
      sender.private_key,
    );

    const callId = uuidv4();
    const msgId = uuidv4();

    db.createMessage({
      id: msgId,
      thread_id: threadId,
      from_user_id: sender.id,
      to_user_id: recipient.id,
      reply_to: null,
      priority: "normal",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      sender_pub_key: encrypted.sender_public_key,
      encryption_mode: "e2e",
      key_epoch: 0,
      content_type: "tool_call",
      call_id: callId,
      created_at: now,
    });

    const found = db.getMessageById(msgId);
    expect(found).toBeDefined();
    expect(found!.content_type).toBe("tool_call");
    expect(found!.call_id).toBe(callId);
  });

  it("defaults content_type to 'text' and call_id to null", () => {
    const { user: sender } = createTestUser(db, "sender2");
    const { user: recipient } = createTestUser(db, "recipient2");
    const { threadId, now } = makeThread(db, sender.id);

    const encrypted = encryptMessage("hello", recipient.public_key, sender.private_key);
    const msgId = uuidv4();

    db.createMessage({
      id: msgId,
      thread_id: threadId,
      from_user_id: sender.id,
      to_user_id: recipient.id,
      reply_to: null,
      priority: "normal",
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      sender_pub_key: encrypted.sender_public_key,
      encryption_mode: "e2e",
      key_epoch: 0,
      content_type: "text",
      call_id: null,
      created_at: now,
    });

    const found = db.getMessageById(msgId);
    expect(found).toBeDefined();
    expect(found!.content_type).toBe("text");
    expect(found!.call_id).toBeNull();
  });
});

// ─── Database — discoverBots ──────────────────────────────────────────────────

describe("Database — discoverBots", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("only returns bots, not regular users", () => {
    createTestUser(db, "normaluser", { type: "user" });
    createTestUser(db, "mybot", { type: "bot" });

    const results = db.discoverBots("", 50);
    expect(results.every((u) => u.type === "bot")).toBe(true);
    expect(results.some((u) => u.handle === "mybot")).toBe(true);
    expect(results.some((u) => u.handle === "normaluser")).toBe(false);
  });

  it("matches bots by handle", () => {
    createTestUser(db, "weather_bot", { type: "bot" });
    createTestUser(db, "unrelated_bot", { type: "bot" });

    const results = db.discoverBots("weather", 50);
    expect(results.some((u) => u.handle === "weather_bot")).toBe(true);
    expect(results.some((u) => u.handle === "unrelated_bot")).toBe(false);
  });

  it("matches bots by bio", () => {
    createTestUser(db, "translatorbot", {
      type: "bot",
      bio: "I translate text between languages",
    });
    createTestUser(db, "otherbot", { type: "bot", bio: "Unrelated bot" });

    const results = db.discoverBots("translate", 50);
    expect(results.some((u) => u.handle === "translatorbot")).toBe(true);
    expect(results.some((u) => u.handle === "otherbot")).toBe(false);
  });

  it("matches bots by capability descriptions", () => {
    const caps = JSON.stringify([{ name: "forecast", description: "Get weather forecast for any city" }]);
    createTestUser(db, "forecastbot", { type: "bot", capabilities: caps });
    createTestUser(db, "anotherbot", {
      type: "bot",
      capabilities: JSON.stringify([{ name: "translate", description: "Translation service" }]),
    });

    const results = db.discoverBots("forecast", 50);
    expect(results.some((u) => u.handle === "forecastbot")).toBe(true);
    expect(results.some((u) => u.handle === "anotherbot")).toBe(false);
  });

  it("excludes private bots", () => {
    createTestUser(db, "publicbot", { type: "bot", privacy: "public" });
    createTestUser(db, "privatebot", { type: "bot", privacy: "private" });

    const results = db.discoverBots("", 50);
    expect(results.some((u) => u.handle === "publicbot")).toBe(true);
    expect(results.some((u) => u.handle === "privatebot")).toBe(false);
  });
});

// ─── Invoke map ───────────────────────────────────────────────────────────────

describe("Invoke map", () => {
  it("registerPending + resolvePending resolves the promise with the result", async () => {
    const callId = uuidv4();
    const resultPayload = { output: { temperature: 72 } };

    const promise = new Promise<{ output?: unknown; error?: string | null }>((resolve) => {
      registerPending(callId, 5000, resolve);
    });

    resolvePending(callId, resultPayload);

    const result = await promise;
    expect(result).toEqual(resultPayload);
  });

  it("timeout fires if not resolved within the timeout window", async () => {
    const callId = uuidv4();

    const promise = new Promise<{ output?: unknown; error?: string | null }>((resolve) => {
      registerPending(callId, 50, resolve);
    });

    const result = await promise;
    expect(result.error).toBe("__timeout__");
  });

  it("resolvePending returns false for an unknown call_id", () => {
    const unknownId = uuidv4();
    const returned = resolvePending(unknownId, { output: "anything" });
    expect(returned).toBe(false);
  });

  it("hasPending returns true while pending, false after resolve", () => {
    const callId = uuidv4();

    registerPending(callId, 5000, () => {});

    expect(hasPending(callId)).toBe(true);

    resolvePending(callId, { output: "done" });

    expect(hasPending(callId)).toBe(false);
  });

  it("hasPending returns false for an unknown call_id", () => {
    expect(hasPending(uuidv4())).toBe(false);
  });
});
