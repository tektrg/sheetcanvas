import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogOut, UserRound, AtSign } from 'lucide-react';
import { useAccountSession } from '../../utils/accountSession';
import { googleClientId, loadGoogleIdentity, newNonce, restoreSession, signInWithGoogleIdToken, signOut } from '../../utils/accountActions';
import { publicHref } from '../../utils/publish';
import { HandlePickerDialog } from './HandlePickerDialog';

// Account entry in the top-left pill (next to Canvas / Library): Google sign-in
// via theindie-api, then profile link, handle picker and sign out.

const GoogleButton: React.FC<{ onSignedIn: (needsHandle: boolean, claimedCount: number) => void }> = ({ onSignedIn }) => {
  const slotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = googleClientId();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const nonce = newNonce();
    loadGoogleIdentity()
      .then(google => {
        if (cancelled || !slotRef.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          ux_mode: 'popup',
          callback: ({ credential }) => {
            setError(null);
            signInWithGoogleIdToken(credential, nonce)
              .then(result => onSignedIn(!result.user.handle, result.claimedCount))
              .catch(err => setError(err instanceof Error ? err.message : 'Sign-in failed'));
          },
        });
        google.accounts.id.renderButton(slotRef.current, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 240 });
      })
      .catch(err => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [clientId, onSignedIn]);

  if (!clientId) {
    return (
      <div>
        <button type="button" disabled className="w-full rounded-full border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm text-neutral-400 cursor-not-allowed">
          Sign in with Google
        </button>
        <p className="mt-2 text-xs text-neutral-500">Sign-in is not configured (set VITE_GOOGLE_CLIENT_ID).</p>
      </div>
    );
  }
  return (
    <div>
      <div ref={slotRef} className="min-h-[44px]" />
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
};

export const AccountMenu: React.FC = () => {
  const session = useAccountSession();
  const [open, setOpen] = useState(false);
  const [pickingHandle, setPickingHandle] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void restoreSession(); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const [notice, setNotice] = useState<string | null>(null);
  const onSignedIn = React.useCallback((needsHandle: boolean, claimedCount: number) => {
    setNotice(claimedCount ? `${claimedCount} published ${claimedCount === 1 ? 'page' : 'pages'} from this browser linked to your account.` : null);
    // Keep the menu open to show the claim notice unless the handle picker takes over.
    setOpen(!needsHandle && claimedCount > 0);
    if (needsHandle) setPickingHandle(true);
  }, []);

  const user = session?.user;
  const label = user ? (user.handle ? `@${user.handle}` : user.displayName || 'Account') : 'Sign in';
  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left hover:bg-neutral-100 dark:hover:bg-neutral-800';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        <UserRound size={14} strokeWidth={1.5} />
        <span className="max-w-[120px] truncate">{label}</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl p-3 text-neutral-900 dark:text-neutral-100">
          {!user ? (
            <>
              <p className="text-sm font-medium mb-1">Sign in to SheetCanvas</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">Your published pages get a public profile. Pages you published from this browser are added to it.</p>
              <GoogleButton onSignedIn={onSignedIn} />
            </>
          ) : (
            <>
              {notice && <p role="status" className="mb-2 rounded-md bg-teal-50 dark:bg-teal-900/30 px-2 py-1.5 text-xs text-teal-800 dark:text-teal-200">{notice}</p>}
              <div className="px-2 pb-2 mb-1 border-b border-neutral-100 dark:border-neutral-800">
                <p className="text-sm font-medium truncate">{user.displayName || (user.handle ? `@${user.handle}` : 'Signed in')}</p>
                <p className="text-xs text-neutral-500 truncate">{user.handle ? `@${user.handle}` : 'No handle yet'}</p>
              </div>
              {user.handle && (
                <a role="menuitem" className={item} href={publicHref(`/@${user.handle}`)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> View public profile
                </a>
              )}
              <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); setPickingHandle(true); }}>
                <AtSign size={14} /> {user.handle ? 'Change handle' : 'Choose handle'}
              </button>
              <button role="menuitem" type="button" className={item} onClick={() => { setOpen(false); setNotice(null); void signOut(); }}>
                <LogOut size={14} /> Sign out
              </button>
            </>
          )}
        </div>
      )}
      {pickingHandle && user && <HandlePickerDialog initial={user.handle} onClose={() => setPickingHandle(false)} />}
    </div>
  );
};
