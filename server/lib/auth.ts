import type { Request } from "express";
import { hashToken } from "./crypto.js";
import type { Db } from "./db.js";
import type { User } from "./types.js";

export function extractToken(req: Request): string | null {
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get("token");
}

export function authenticateUser(token: string | null, db: Db): User | null {
  if (!token) return null;
  const hash = hashToken(token);
  return db.getUserByTokenHash(hash) ?? null;
}
