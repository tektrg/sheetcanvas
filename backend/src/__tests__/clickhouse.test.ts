import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeClickhouseQuery } from '../clickhouse';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

function mockClickhouseJson(json: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify(json),
  })) as unknown as typeof fetch;
}

function mockClickhouseText(text: string) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    text: async () => text,
  })) as unknown as typeof fetch;
}

const queryArgs = {
  url: 'https://clickhouse.example.com/',
  username: 'user',
  password: 'password',
  sql: 'SELECT 1',
  maxRows: 5000,
  timeoutMs: 1000,
};

describe('executeClickhouseQuery', () => {
  it('surfaces ClickHouse JSON exceptions instead of returning an empty result', async () => {
    mockClickhouseJson({
      meta: [],
      data: [],
      rows: 0,
      exception: 'Code: 497. DB::Exception: Not enough privileges. (ACCESS_DENIED)',
    });

    await expect(executeClickhouseQuery(queryArgs)).rejects.toMatchObject({
      status: 502,
      code: 'clickhouse_error',
      message: expect.stringContaining('ACCESS_DENIED'),
    });
  });

  it('rejects partial rows when ClickHouse includes an exception in an HTTP 200 response', async () => {
    mockClickhouseJson({
      meta: [{ name: 'probe', type: 'UInt8' }],
      data: [[1]],
      rows: 1,
      exception: 'Code: 395. DB::Exception: Query was cancelled.',
    });

    await expect(executeClickhouseQuery(queryArgs)).rejects.toMatchObject({
      status: 502,
      code: 'clickhouse_error',
      message: expect.stringContaining('Query was cancelled'),
    });
  });

  it('surfaces raw streamed ClickHouse exceptions when the HTTP 200 body is not valid JSON', async () => {
    mockClickhouseText(
      '{"meta":[{"name":"probe","type":"UInt8"}],"data":[[1]],"rows":1}\n' +
        '__exception__ Code: 497. DB::Exception: Not enough privileges. (ACCESS_DENIED)',
    );

    await expect(executeClickhouseQuery(queryArgs)).rejects.toMatchObject({
      status: 502,
      code: 'clickhouse_error',
      message: expect.stringContaining('ACCESS_DENIED'),
    });
  });
});
