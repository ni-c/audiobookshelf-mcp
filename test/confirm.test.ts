import { describe, expect, it } from 'vitest';

import { ConfirmationStore, setResourceKey } from '../src/confirm.js';

describe('ConfirmationStore', () => {
  it('rejects a call without a token and accepts the issued one once', () => {
    const store = new ConfirmationStore();
    const resource = setResourceKey('delete_item', ['a']);

    expect(store.consume(resource, undefined)).toBe(false);
    const token = store.issue(resource);
    expect(store.consume(resource, token)).toBe(true);
    // Single use: a replay must not work.
    expect(store.consume(resource, token)).toBe(false);
  });

  it('does not accept a token issued for a different target', () => {
    const store = new ConfirmationStore();
    const token = store.issue(setResourceKey('delete_item', ['a']));
    expect(store.consume(setResourceKey('delete_item', ['b']), token)).toBe(
      false
    );
  });

  it('does not accept a token issued for a smaller set of targets', () => {
    // The regression this guards: confirming ["a"] must not execute
    // ["a", "secrets"] — the model picks the second list.
    const store = new ConfirmationStore();
    const token = store.issue(setResourceKey('delete_files', ['a']));
    expect(
      store.consume(setResourceKey('delete_files', ['a', 'secrets']), token)
    ).toBe(false);
  });

  it('treats the target set as unordered', () => {
    const store = new ConfirmationStore();
    const token = store.issue(setResourceKey('delete_files', ['a', 'b']));
    expect(
      store.consume(setResourceKey('delete_files', ['b', 'a']), token)
    ).toBe(true);
  });

  it('expires tokens', async () => {
    const store = new ConfirmationStore(1);
    const resource = setResourceKey('delete_item', ['a']);
    const token = store.issue(resource);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.consume(resource, token)).toBe(false);
  });
});

describe('ConfirmationStore bounds', () => {
  it('evicts the oldest pending token instead of growing without limit', () => {
    const store = new ConfirmationStore();
    // MAX_PENDING is 100: issuing 101 tokens must drop the first one, so a
    // loop of refused calls cannot be used to grow the map indefinitely.
    const first = setResourceKey('delete_item', ['0']);
    const firstToken = store.issue(first);
    for (let i = 1; i <= 100; i++) {
      store.issue(setResourceKey('delete_item', [String(i)]));
    }

    expect(store.consume(first, firstToken)).toBe(false);
    // The most recent one is still there.
    const last = setResourceKey('delete_item', ['100']);
    const lastToken = store.issue(last);
    expect(store.consume(last, lastToken)).toBe(true);
  });

  it('reports its TTL in whole minutes for the prompt text', () => {
    expect(new ConfirmationStore().ttlMinutes).toBe(5);
    expect(new ConfirmationStore(90_000).ttlMinutes).toBe(2);
  });
});
