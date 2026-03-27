import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, decodeUTF8 } from "tweetnacl-util";
import { getPrivateKey, getKeyPairFromPrivate } from "./keys.js";

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
}

export function encryptForRecipient(
  plaintext: string,
  recipientPublicKey: string,
): EncryptedPayload {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error("No private key found. Please complete onboarding first.");
  }

  const msgBytes = decodeUTF8(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPk = decodeBase64(recipientPublicKey);
  const senderSk = decodeBase64(privateKey);

  const encrypted = nacl.box(msgBytes, nonce, recipientPk, senderSk);
  if (!encrypted) {
    throw new Error("Encryption failed");
  }

  const keyPair = getKeyPairFromPrivate(privateKey);

  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
    sender_public_key: keyPair.publicKey,
  };
}
