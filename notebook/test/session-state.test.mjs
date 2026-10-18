import test from 'node:test';
import assert from 'node:assert/strict';
import {sameOrNext, signedInState} from '../ui/src/contexts/session-state.mjs';

const read = () => ({user: {id: 'owner', email: null, name: 'Fictional Owner'}, profile: {display_name: 'Fictional Owner', timezone: 'Europe/Berlin'}});

test('reading the same session again keeps the state, so pages keyed on the user do not reload', () => {
  // The timeline reloaded its whole list every 30 seconds because each read made a new user object.
  const first = read();
  const signedIn = signedInState({loading: true, user: null, session: null, profile: null, role: 'premium', roleLoading: false, authError: '', expired: false}, first.user, first.profile);
  assert.equal(signedIn.user, first.user);
  assert.equal(signedIn.session.user, first.user);
  const again = read();
  assert.notEqual(again.user, first.user, 'the server hands a fresh copy each time');
  assert.equal(signedInState(signedIn, again.user, again.profile), signedIn, 'nothing changed, so the very same state comes back');
});

test('a changed user or profile still reaches the page', () => {
  const first = read();
  const signedIn = signedInState(null, first.user, first.profile);
  const renamed = {...first.user, name: 'Fictional Owner Renamed'};
  const next = signedInState(signedIn, renamed, first.profile);
  assert.notEqual(next, signedIn);
  assert.equal(next.user, renamed);
  assert.equal(next.session.user, renamed);
  assert.equal(next.profile, signedIn.profile, 'the unchanged profile keeps its identity');
  const moved = signedInState(next, {...renamed}, {...first.profile, timezone: 'Asia/Tokyo'});
  assert.equal(moved.user, next.user);
  assert.equal(moved.profile.timezone, 'Asia/Tokyo');
});

test('coming back from an error or an expired session gives a fresh signed-in state', () => {
  const first = read();
  const signedIn = signedInState(null, first.user, first.profile);
  const failed = {...signedIn, authError: 'Your server is unavailable. Try again shortly.'};
  const recovered = signedInState(failed, read().user, read().profile);
  assert.notEqual(recovered, failed);
  assert.equal(recovered.authError, '');
  assert.equal(recovered.user, signedIn.user);
  const signedOut = {...signedIn, user: null, session: null, profile: null, expired: true};
  const back = signedInState(signedOut, first.user, first.profile);
  assert.equal(back.expired, false);
  assert.equal(back.user, first.user);
});

test('sameOrNext compares by content', () => {
  const a = {id: 1, tags: ['x']};
  assert.equal(sameOrNext(a, {id: 1, tags: ['x']}), a);
  const b = {id: 2};
  assert.equal(sameOrNext(a, b), b);
  assert.equal(sameOrNext(null, b), b);
  assert.equal(sameOrNext(a, null), null);
});
