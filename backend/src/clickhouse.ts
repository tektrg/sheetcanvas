import { HttpError } from "./errors";

export type ClickHouseMeta = { name: string; type: string };
export type ClickHouseResult = { columns: ClickHouseMeta[]; rows: unknown[][]; rowCount: number };

function stripTrailingSemicolon(sql: string) {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
}

function assertReadOnlySql(sql: string) {
  const compact = sql.trim().replace(/\s+/g, " ").toLowerCase();
  if (!compact.startsWith("select ") && !compact.startsWith("with ")) {
    throw new HttpError(400, "sql_not_allowed", "Only SELECT/WITH queries are allowed");
  }
  if (compact.includes(" insert ") || compact.includes(" update ") || compact.includes(" delete ") || compact.includes(" drop ")) {
    throw new HttpError(400, "sql_not_allowed", "Only read-only queries are allowed");
  }
  if (sql.includes(";")) {
    throw new HttpError(400, "sql_not_allowed", "Multiple statements are not allowed");
  }
}

function ensureLimit(sql: string, maxRows: number) {
  if (/\blimit\b/i.test(sql)) return sql;
  return `${sql}\nLIMIT ${maxRows}`;
}

function withDefaultFormat(urlStr: string) {
  const url = new URL(urlStr);
  if (!url.searchParams.has("default_format")) url.searchParams.set("default_format", "JSONCompact");
  return url.toString();
}

function basicAuthHeader(username: string, password: string) {
  const token = btoa(`${username}:${password}`);
  return `Basic ${token}`;
}

export async function executeClickhouseQuery(args: {
  url: string;
  username: string;
  password: string;
  sql: string;
  maxRows: number;
  timeoutMs: number;
}): Promise<ClickHouseResult> {
  const cleaned = stripTrailingSemicolon(args.sql);
  assertReadOnlySql(cleaned);

  const sqlWithLimit = ensureLimit(cleaned, args.maxRows);
  const endpoint = withDefaultFormat(args.url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain; charset=utf-8",
        Authorization: basicAuthHeader(args.username, args.password)
      },
      body: sqlWithLimit,
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(502, "clickhouse_error", `ClickHouse responded ${res.status}: ${text || res.statusText}`);
    }

    const json = (await res.json()) as { meta?: ClickHouseMeta[]; data?: unknown[][]; rows?: number };
    const columns = json.meta ?? [];
    const rows = json.data ?? [];
    const rowCount = typeof json.rows === "number" ? json.rows : rows.length;
    return { columns, rows, rowCount };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new HttpError(504, "timeout", "Query timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

