import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../components/OnboardingGuide.css'), 'utf8');
const tsx = readFileSync(resolve(__dirname, '../components/OnboardingGuide.tsx'), 'utf8');

const ruleBody = (selector: string) => {
  const match = css.match(new RegExp(`${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
};

describe('welcome sheet close button', () => {
  it('keeps the iframe clip off the sheet so the close button is not inside the clipped iframe layer', () => {
    expect(ruleBody('.bottom-sheet-welcome__sheet')).not.toMatch(/overflow:\s*hidden/);
    expect(ruleBody('.bottom-sheet-welcome__clip')).toMatch(/overflow:\s*hidden/);
  });

  it('renders the close button outside the clip wrapper, after it', () => {
    const clipEnd = tsx.indexOf('</div>', tsx.indexOf('bottom-sheet-welcome__clip'));
    const close = tsx.indexOf('bottom-sheet-welcome__close');
    expect(clipEnd).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(clipEnd);
  });
});
