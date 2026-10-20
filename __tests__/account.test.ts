import { describe, expect, it, vi } from 'vitest';
import { AccountApiError, createTheIndieClient, handleProblem } from '../shared/theindieAccounts';
import { createFakeTheIndie } from '../shared/theindieFake';
import { claimLocalPages } from '../utils/accountActions';

const client = () => {
  const fake = createFakeTheIndie();
  return { fake, api: createTheIndieClient('https://accounts.test', fake.fetch) };
};

describe('handle validation', () => {
  it.each([
    ['ab', 'At least 3 characters'],
    ['a'.repeat(31), 'At most 30 characters'],
    ['1abc', 'Must start with a letter'],
    ['Ann', 'Must start with a letter'],
    ['ann.lee', 'Use lowercase letters, numbers, - and _ only'],
  ])('%s → %s', (handle, message) => expect(handleProblem(handle)).toBe(message));

  it('accepts a-z0-9_- starting with a letter', () => {
    expect(handleProblem('ann_lee-2')).toBeNull();
  });
});

describe('theindie client', () => {
  it('signs in with a Google id token and sends app=sheetcanvas', async () => {
    const { api } = client();
    const result = await api.signInWithGoogle({ idToken: 'google:123:Ann', nonce: 'n' });
    expect(result.isNewAccount).toBe(true);
    expect(result.user).toMatchObject({ id: 'u_123', handle: null, displayName: 'Ann' });
    expect(await api.getMe(result.token)).toMatchObject({ id: 'u_123' });
  });

  it('maps handle errors to kinds with server messages', async () => {
    const { api, fake } = client();
    fake.seedUser({ id: 'u_bob', handle: 'taken' });
    const token = fake.seedUser({ id: 'u_ann' });
    await expect(api.setHandle(token, 'admin')).rejects.toMatchObject({ kind: 'invalid', status: 422 });
    await expect(api.setHandle(token, 'taken')).rejects.toMatchObject({ kind: 'taken', status: 409, message: 'Handle is taken' });
    await expect(api.getMe('bad')).rejects.toBeInstanceOf(AccountApiError);
    expect((await api.setHandle(token, 'ann')).handle).toBe('ann');
    expect(await api.getByHandle('ann')).toMatchObject({ id: 'u_ann', handle: 'ann' });
  });

  it('reports network failure as unavailable', async () => {
    const api = createTheIndieClient('https://accounts.test', () => Promise.reject(new Error('offline')));
    await expect(api.getMe('t')).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('claimLocalPages', () => {
  it('sends every stored edit key with the session token', async () => {
    const claim = vi.fn().mockResolvedValue({ userId: 'u', claimed: ['p1'], skipped: [] });
    const result = await claimLocalPages('tok', { listKeys: async () => [{ id: 'p1', editKey: 'k1' }], claim });
    expect(claim).toHaveBeenCalledWith('tok', [{ id: 'p1', editKey: 'k1' }]);
    expect(result?.claimed).toEqual(['p1']);
  });

  it('skips the request when this browser published nothing', async () => {
    const claim = vi.fn();
    expect(await claimLocalPages('tok', { listKeys: async () => [], claim })).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });
});
