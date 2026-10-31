/** Public capabilities deliberately separate workspace lifetime from MCP transport lifetime. */
export const PUBLIC_CANVAS_HANDLE_PATTERN = /^c_[a-f0-9]{64}$/;
export const PUBLIC_CANVAS_TTL_MS = 2 * 60 * 60 * 1_000;
export interface PublicCanvasPointer { session: string; expiresAtMs: number }

export function mintPublicCapability(prefix: 'p' | 'c'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function publicCanvasInputSchema(schema: Record<string, any>) {
  return {
    ...schema,
    properties: {
      ...schema.properties,
      canvasHandle: { type: 'string', pattern: PUBLIC_CANVAS_HANDLE_PATTERN.source,
        description: 'Temporary canvas handle returned by openSheetCanvas. Pass the same handle for every operation on that workspace. Never invent a handle.' },
    },
    required: [...(schema.required ?? []), 'canvasHandle'],
  };
}
