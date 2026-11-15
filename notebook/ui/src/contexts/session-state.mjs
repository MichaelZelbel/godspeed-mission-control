// The signed-in state AuthContext keeps, kept apart so it can be tested with
// node --test (notebook/test/session-state.test.mjs).
//
// The session is read again every 30 seconds and whenever the window gets
// focus. Each read used to put a fresh copy of the same user into the state,
// and every screen that reloads when the user changes (the timeline, the
// activity feed, the notifications) took that as a new sign-in: the timeline
// swapped its whole list for a spinner and back every 30 seconds. An unchanged
// user, profile and session now keep their identity, as Menerio's own sign-in
// does (its sameUser), and when nothing changed at all the previous state is
// returned, so React does not render again.

/** The previous value when the next one carries the same data, otherwise the next one. */
export function sameOrNext(previous, next) {
  if (previous === next) return previous;
  if (previous == null || next == null) return next;
  try { return JSON.stringify(previous) === JSON.stringify(next) ? previous : next; } catch { return next; }
}

/** The state after a successful session read. */
export function signedInState(previous, user, profile) {
  const keptUser = sameOrNext(previous?.user ?? null, user);
  const session = previous?.session && previous.session.user === keptUser ? previous.session : { user: keptUser, access_token: 'local-session' };
  const next = { loading: false, user: keptUser, session, profile: sameOrNext(previous?.profile ?? null, profile), role: 'premium', roleLoading: false, authError: '', expired: false };
  if (previous && Object.keys(next).every((key) => previous[key] === next[key]) && Object.keys(previous).length === Object.keys(next).length) return previous;
  return next;
}
