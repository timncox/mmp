import nacl from "tweetnacl";
import util from "tweetnacl-util";
import { createHash, randomBytes } from "crypto";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateKeyPair(): KeyPair {
  const pair = nacl.box.keyPair();
  return {
    publicKey: util.encodeBase64(pair.publicKey),
    privateKey: util.encodeBase64(pair.secretKey),
  };
}

export function generateToken(): string {
  return "sk_" + randomBytes(32).toString("hex");
}

export function generateRecoveryCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  const parts: string[] = [];
  for (let p = 0; p < 3; p++) {
    let segment = "";
    for (let i = 0; i < 4; i++) {
      segment += chars[bytes[p * 4 + i] % chars.length];
    }
    parts.push(segment);
  }
  return parts.join("-");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface EncryptedResult {
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
}

export function encryptMessage(
  plaintext: string,
  recipientPublicKey: string,
  senderPrivateKey: string,
): EncryptedResult {
  const msgBytes = util.decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPk = util.decodeBase64(recipientPublicKey);
  const senderSk = util.decodeBase64(senderPrivateKey);

  const encrypted = nacl.box(msgBytes, nonce, recipientPk, senderSk);

  // Derive the sender's public key from the private key
  const senderKeyPair = nacl.box.keyPair.fromSecretKey(senderSk);

  return {
    ciphertext: util.encodeBase64(encrypted),
    nonce: util.encodeBase64(nonce),
    sender_public_key: util.encodeBase64(senderKeyPair.publicKey),
  };
}

export function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientPrivateKey: string,
): string | null {
  try {
    const ciphertextBytes = util.decodeBase64(ciphertext);
    const nonceBytes = util.decodeBase64(nonce);
    const senderPk = util.decodeBase64(senderPublicKey);
    const recipientSk = util.decodeBase64(recipientPrivateKey);

    const decrypted = nacl.box.open(
      ciphertextBytes,
      nonceBytes,
      senderPk,
      recipientSk,
    );
    if (!decrypted) return null;
    return util.encodeUTF8(decrypted);
  } catch {
    return null;
  }
}
