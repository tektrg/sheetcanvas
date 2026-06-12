import { HttpError } from "./errors";

export type ClickHouseMeta = { name: string; type: string };
export type ClickHouseResult = { columns: ClickHouseMeta[]; rows: unknown[][]; rowCount: number };
type ClickHouseJsonResponse = {
  meta?: ClickHouseMeta[];
  data?: unknown[][];
  rows?: number;
  exception?: string;
};

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

function assertNoClickhouseException(json: ClickHouseJsonResponse) {
  if (typeof json.exception === 'string' && json.exception.trim()) {
    throw new HttpError(502, 'clickhouse_error', `ClickHouse error: ${json.exception.trim()}`);
  }
}

function extractClickhouseExceptionText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.includes('DB::Exception') || trimmed.includes('__exception__')) return trimmed;
  return '';
}

async function parseClickhouseJsonResponse(res: Response): Promise<ClickHouseJsonResponse> {
  const text = await res.text();
  let json: ClickHouseJsonResponse;
  try {
    json = JSON.parse(text) as ClickHouseJsonResponse;
  } catch (err) {
    const exceptionText = extractClickhouseExceptionText(text);
    if (exceptionText) {
      throw new HttpError(502, 'clickhouse_error', `ClickHouse error: ${exceptionText}`);
    }
    throw err;
  }
  assertNoClickhouseException(json);
  return json;
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

    const json = await parseClickhouseJsonResponse(res);
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

export async function getClickhouseSchema(args: {
  url: string;
  username: string;
  password: string;
  database?: string;
  timeoutMs: number;
}): Promise<{ tables: Array<{ name: string }> }> {
  const sql = args.database
    ? 'SHOW TABLES FROM ' + args.database
    : [
        "SELECT concat(database, '.', name) AS name",
        'FROM system.tables',
        "WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')",
        'ORDER BY database, name',
        'LIMIT 200',
      ].join('\n');
  const endpoint = withDefaultFormat(args.url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'text/plain; charset=utf-8',
        Authorization: basicAuthHeader(args.username, args.password),
      },
      body: sql,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, 'clickhouse_error', 'ClickHouse responded ' + res.status + ': ' + (text || res.statusText));
    }
    const json = await parseClickhouseJsonResponse(res);
    const rows = (json.data ?? []) as Array<[string, ...unknown[]]>;
    return { tables: rows.map((r) => ({ name: String(r[0]) })) };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new HttpError(504, 'timeout', 'Query timed out');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const IDENT_RE = /^[A-Za-z0-9_.]+$/;

export async function describeClickhouseTable(args: {
  url: string;
  username: string;
  password: string;
  table: string;
  timeoutMs: number;
}): Promise<{ columns: Array<{ name: string; type: string }> }> {
  if (!IDENT_RE.test(args.table)) {
    throw new HttpError(400, 'invalid_table', 'Table name contains invalid characters');
  }
  const sql = 'DESCRIBE TABLE ' + args.table;
  const endpoint = withDefaultFormat(args.url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'text/plain; charset=utf-8',
        Authorization: basicAuthHeader(args.username, args.password),
      },
      body: sql,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, 'clickhouse_error', 'ClickHouse responded ' + res.status + ': ' + (text || res.statusText));
    }
    const json = await parseClickhouseJsonResponse(res);
    const rows = (json.data ?? []) as Array<[string, string, ...unknown[]]>;
    return { columns: rows.map((r) => ({ name: String(r[0]), type: String(r[1]) })) };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new HttpError(504, 'timeout', 'Query timed out');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
