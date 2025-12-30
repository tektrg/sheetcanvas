import { HttpError } from "./errors";
import type { Env } from "./env";

export function requireBearerToken(req: Request, env: Env) {
  const expected = env.API_BEARER_TOKEN?.trim();
  if (!expected) return;

  const header = req.headers.get("Authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new HttpError(401, "unauthorized", "Missing Authorization Bearer token");
  if (m[1] !== expected) throw new HttpError(403, "forbidden", "Invalid token");
}

