import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  status: ContentfulStatusCode;
  code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function toJsonError(err: unknown) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }

  if (err instanceof Error) {
    return { status: 500 as const, body: { error: { code: "internal_error", message: err.message } } };
  }

  return { status: 500 as const, body: { error: { code: "internal_error", message: "Unknown error" } } };
}
