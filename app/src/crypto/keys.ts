import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";

const PRIVATE_KEY_STORAGE = "mmp_private_key";
const PUBLIC_KEY_STORAGE = "mmp_public_key";

export interface ClientKeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateClientKeyPair(): ClientKeyPair {
  const pair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(pair.publicKey),
    privateKey: encodeBase64(pair.secretKey),
  };
}

export function savePrivateKey(key: string): void {
  localStorage.setItem(PRIVATE_KEY_STORAGE, key);
}

export function savePublicKey(key: string): void {
  localStorage.setItem(PUBLIC_KEY_STORAGE, key);
}

export function getPrivateKey(): string | null {
  return localStorage.getItem(PRIVATE_KEY_STORAGE);
}

export function getPublicKey(): string | null {
  return localStorage.getItem(PUBLIC_KEY_STORAGE);
}

export function hasClientKeys(): boolean {
  return (
    localStorage.getItem(PRIVATE_KEY_STORAGE) !== null &&
    localStorage.getItem(PUBLIC_KEY_STORAGE) !== null
  );
}

export function getKeyPairFromPrivate(privateKeyB64: string): ClientKeyPair {
  const secretKey = decodeBase64(privateKeyB64);
  const pair = nacl.box.keyPair.fromSecretKey(secretKey);
  return {
    publicKey: encodeBase64(pair.publicKey),
    privateKey: privateKeyB64,
  };
}
