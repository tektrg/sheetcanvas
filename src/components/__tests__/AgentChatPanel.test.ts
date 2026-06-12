import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { getToolErrorMessages } from '../agentChatErrors';

describe('getToolErrorMessages', () => {
  it('extracts failed tool output errors for visible chat alerts', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I will run the query.' },
        {
          type: 'tool-createQuerySheet',
          toolName: 'createQuerySheet',
          state: 'output-available',
          output: {
            ok: false,
            error:
              'ClickHouse error: Code: 497. DB::Exception: trungluong lacks SELECT(payload, created_at) ON hq_report.sale_bill. (ACCESS_DENIED)',
          },
        },
      ],
    } as UIMessage;

    expect(getToolErrorMessages(message)).toEqual([
      'ClickHouse error: Code: 497. DB::Exception: trungluong lacks SELECT(payload, created_at) ON hq_report.sale_bill. (ACCESS_DENIED)',
    ]);
  });

  it('ignores successful tool outputs', () => {
    const message = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [
        {
          type: 'tool-createQuerySheet',
          toolName: 'createQuerySheet',
          state: 'output-available',
          output: { ok: true, sheetId: 'sheet-1' },
        },
      ],
    } as UIMessage;

    expect(getToolErrorMessages(message)).toEqual([]);
  });
});
