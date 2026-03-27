import { createHash, createHmac, randomBytes } from "crypto";
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import type { Db } from "./db.js";
import type {
  ParsedHandle,
  WellKnownMMP,
  FederationEnvelope,
  ServerIdentity,
} from "./types.js";

// ---------------------------------------------------------------------------
// Handle parsing
// ---------------------------------------------------------------------------

/**
 * Parse a handle into local vs remote parts.
 * "@alice" → { user: "alice", server: null, isRemote: false }
 * "@alice@mmp.chat" → { user: "alice", server: "mmp.chat", isRemote: true }
 * "alice@mmp.chat" → { user: "alice", server: "mmp.chat", isRemote: true }
 */
export function parseHandle(handle: string): ParsedHandle {
  // Strip leading @
  const clean = handle.startsWith("@") ? handle.slice(1) : handle;

  const atIdx = clean.indexOf("@");
  if (atIdx === -1) {
    return { user: clean.toLowerCase(), server: null, isRemote: false };
  }

  const user = clean.slice(0, atIdx).toLowerCase();
  const server = clean.slice(atIdx + 1).toLowerCase();

  return { user, server, isRemote: true };
}

/**
 * Format a full federated handle.
 */
export function formatHandle(user: string, server: string | null): string {
  if (!server) return `@${user}`;
  return `@${user}@${server}`;
}

// ---------------------------------------------------------------------------
// Server identity management
// ---------------------------------------------------------------------------

/**
 * Get or create this server's signing identity.
 * Uses Ed25519 for signing federation requests.
 */
export function getOrCreateServerIdentity(
  db: Db,
  serverUrl: string,
): ServerIdentity {
  const existing = db.getServerIdentity(serverUrl);
  if (existing) return existing;

  const keyPair = nacl.sign.keyPair();
  const identity: ServerIdentity = {
    server_url: serverUrl,
    signing_public_key: util.encodeBase64(keyPair.publicKey),
    signing_private_key: util.encodeBase64(keyPair.secretKey),
    created_at: Math.floor(Date.now() / 1000),
  };
  db.setServerIdentity(identity);
  return identity;
}

// ---------------------------------------------------------------------------
// Request signing
// ---------------------------------------------------------------------------

/**
 * Sign a federation request body with the server's Ed25519 key.
 */
export function signPayload(
  payload: string,
  signingPrivateKey: string,
): string {
  const messageBytes = util.decodeUTF8(payload);
  const secretKey = util.decodeBase64(signingPrivateKey);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return util.encodeBase64(signature);
}

/**
 * Verify a signed federation request.
 */
export function verifySignature(
  payload: string,
  signature: string,
  signingPublicKey: string,
): boolean {
  try {
    const messageBytes = util.decodeUTF8(payload);
    const signatureBytes = util.decodeBase64(signature);
    const publicKey = util.decodeBase64(signingPublicKey);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Server discovery
// ---------------------------------------------------------------------------

/**
 * Fetch a remote server's .well-known/mmp.json to discover endpoints and keys.
 * Caches nothing — caller should cache.
 */
export async function discoverServer(
  serverHost: string,
): Promise<WellKnownMMP | null> {
  // Try HTTPS first, then HTTP for local dev
  for (const scheme of ["https", "http"]) {
    try {
      const url = `${scheme}://${serverHost}/.well-known/mmp.json`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as WellKnownMMP;
      if (data.protocol !== "mmp") continue;
      return data;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Remote user lookup
// ---------------------------------------------------------------------------

/**
 * Look up a user on a remote server via its federation API.
 */
export async function lookupRemoteUser(
  serverHost: string,
  handle: string,
): Promise<{
  handle: string;
  display_name: string;
  public_key: string;
} | null> {
  const discovery = await discoverServer(serverHost);
  if (!discovery) return null;

  try {
    const url = `${discovery.federation_endpoint}/lookup?handle=${encodeURIComponent(handle)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      handle: string;
      display_name: string;
      public_key: string;
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Federated message delivery
// ---------------------------------------------------------------------------

/**
 * Deliver a message to a remote server via federation.
 */
export async function deliverToRemote(
  serverHost: string,
  envelope: FederationEnvelope,
  signingPrivateKey: string,
): Promise<{ success: boolean; error?: string }> {
  const discovery = await discoverServer(serverHost);
  if (!discovery) {
    return { success: false, error: `Could not discover server ${serverHost}` };
  }

  const body = JSON.stringify(envelope);
  const signature = signPayload(body, signingPrivateKey);

  try {
    const res = await fetch(`${discovery.federation_endpoint}/deliver`, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        "X-MMP-Signature": signature,
        "X-MMP-Server": envelope.from_server,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Remote server returned ${res.status}: ${text}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error" };
  }
}
