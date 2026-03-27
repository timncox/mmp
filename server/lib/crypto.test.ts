import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  generateToken,
  generateRecoveryCode,
  hashToken,
  encryptMessage,
  decryptMessage,
} from "./crypto.js";

describe("Crypto Helpers", () => {
  describe("generateKeyPair", () => {
    it("should return base64-encoded public and private keys", () => {
      const pair = generateKeyPair();
      expect(pair.publicKey).toBeDefined();
      expect(pair.privateKey).toBeDefined();
      // Base64 strings for 32-byte keys = 44 chars
      expect(pair.publicKey.length).toBe(44);
      expect(pair.privateKey.length).toBe(44);
    });

    it("should generate unique key pairs", () => {
      const pair1 = generateKeyPair();
      const pair2 = generateKeyPair();
      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
    });
  });

  describe("generateToken", () => {
    it("should start with sk_ prefix", () => {
      const token = generateToken();
      expect(token.startsWith("sk_")).toBe(true);
    });

    it("should be sk_ + 64 hex chars (32 bytes)", () => {
      const token = generateToken();
      expect(token.length).toBe(3 + 64); // "sk_" + 64 hex
      expect(/^sk_[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("should generate unique tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("generateRecoveryCode", () => {
    it("should match XXXX-XXXX-XXXX format", () => {
      const code = generateRecoveryCode();
      expect(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)).toBe(true);
    });

    it("should not contain ambiguous characters (0, 1, I, O)", () => {
      // Generate many codes to increase confidence
      for (let i = 0; i < 100; i++) {
        const code = generateRecoveryCode();
        expect(code).not.toMatch(/[01IO]/);
      }
    });
  });

  describe("hashToken", () => {
    it("should return a hex string", () => {
      const hash = hashToken("test_token");
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it("should be deterministic", () => {
      const hash1 = hashToken("same_token");
      const hash2 = hashToken("same_token");
      expect(hash1).toBe(hash2);
    });

    it("should differ for different inputs", () => {
      const hash1 = hashToken("token_a");
      const hash2 = hashToken("token_b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("encrypt / decrypt round-trip", () => {
    it("should encrypt and decrypt a message successfully", () => {
      const sender = generateKeyPair();
      const recipient = generateKeyPair();

      const plaintext = "Hello, secure world!";
      const encrypted = encryptMessage(
        plaintext,
        recipient.publicKey,
        sender.privateKey,
      );

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.nonce).toBeDefined();
      expect(encrypted.sender_public_key).toBe(sender.publicKey);

      const decrypted = decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.sender_public_key,
        recipient.privateKey,
      );

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode text", () => {
      const sender = generateKeyPair();
      const recipient = generateKeyPair();

      const plaintext = "Hello, world! Emojis: 🔐🔑 Accents: cafe\u0301";
      const encrypted = encryptMessage(
        plaintext,
        recipient.publicKey,
        sender.privateKey,
      );
      const decrypted = decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.sender_public_key,
        recipient.privateKey,
      );
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("wrong-key failure", () => {
    it("should return null when decrypting with wrong key", () => {
      const sender = generateKeyPair();
      const recipient = generateKeyPair();
      const wrongRecipient = generateKeyPair();

      const encrypted = encryptMessage(
        "secret message",
        recipient.publicKey,
        sender.privateKey,
      );

      const result = decryptMessage(
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.sender_public_key,
        wrongRecipient.privateKey,
      );

      expect(result).toBeNull();
    });

    it("should return null for corrupted ciphertext", () => {
      const sender = generateKeyPair();
      const recipient = generateKeyPair();

      const encrypted = encryptMessage(
        "test",
        recipient.publicKey,
        sender.privateKey,
      );

      const result = decryptMessage(
        "corrupted_base64_data_aaaa",
        encrypted.nonce,
        encrypted.sender_public_key,
        recipient.privateKey,
      );

      expect(result).toBeNull();
    });
  });
});
