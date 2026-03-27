import type { Request } from "express";
import { hashToken } from "./crypto.js";
import type { Db } from "./db.js";
import type { User } from "./types.js";

export function extractToken(req: Request): string | null {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("token");
}

export function authenticateUser(token: string | null, db: Db): User | null {
  if (token) {
    const hash = hashToken(token);
    return db.getUserByTokenHash(hash) ?? null;
  }

  // Auto-auth: if no token and exactly one user exists, authenticate as them.
  // This makes single-user local servers work without token-in-URL config.
  const users = db.raw
    .prepare("SELECT * FROM users LIMIT 2")
    .all() as User[];
  if (users.length === 1) {
    return users[0];
  }

  return null;
}
