import type { UIMessage } from 'ai';

export function getToolErrorMessages(msg: UIMessage): string[] {
  return (msg.parts ?? [])
    .filter((part: any) => typeof part.type === 'string' && part.type.startsWith('tool-'))
    .map((part: any) => part.output)
    .filter((output: any) => output && typeof output === 'object' && output.ok === false)
    .map((output: any) => String(output.error || 'Tool failed'))
    .filter(Boolean);
}
