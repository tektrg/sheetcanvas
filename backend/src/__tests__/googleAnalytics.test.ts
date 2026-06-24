import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ANALYTICS_READONLY_SCOPE,
  hasGoogleAnalyticsReadonlyScope,
} from '../googleAnalytics';

describe('Google Analytics OAuth scopes', () => {
  it('accepts tokens that include the Analytics read-only scope', () => {
    expect(
      hasGoogleAnalyticsReadonlyScope(
        `openid email profile ${GOOGLE_ANALYTICS_READONLY_SCOPE}`
      )
    ).toBe(true);
  });

  it('rejects Google identity or Sheets-only tokens for Analytics connectors', () => {
    expect(
      hasGoogleAnalyticsReadonlyScope(
        'https://www.googleapis.com/auth/spreadsheets.readonly openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
      )
    ).toBe(false);
  });
});
