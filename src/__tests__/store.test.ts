import { describe, it, expect } from 'vitest';
import { InMemoryStore } from '../store';

describe('InMemoryStore', () => {
  // ── get ──────────────────────────────────────────────────────────────

  it('get returns 0 for unknown key', () => {
    const store = new InMemoryStore();
    expect(store.get('nonexistent')).toBe(0);
  });

  // ── set / get roundtrip ──────────────────────────────────────────────

  it('set and get roundtrip', () => {
    const store = new InMemoryStore();
    store.set('user:alice', 42);
    expect(store.get('user:alice')).toBe(42);
  });

  it('set overwrites previous value', () => {
    const store = new InMemoryStore();
    store.set('key', 10);
    store.set('key', 99);
    expect(store.get('key')).toBe(99);
  });

  // ── increment ────────────────────────────────────────────────────────

  it('increment adds delta and returns new value', () => {
    const store = new InMemoryStore();
    store.set('counter', 100);
    const result = store.increment('counter', 25);
    expect(result).toBe(125);
    expect(store.get('counter')).toBe(125);
  });

  it('increment on unknown key starts from 0', () => {
    const store = new InMemoryStore();
    const result = store.increment('fresh', 7);
    expect(result).toBe(7);
    expect(store.get('fresh')).toBe(7);
  });

  // ── delete ───────────────────────────────────────────────────────────

  it('delete removes key (get returns 0 after)', () => {
    const store = new InMemoryStore();
    store.set('ephemeral', 500);
    store.delete('ephemeral');
    expect(store.get('ephemeral')).toBe(0);
  });

  it('delete removes window data too', () => {
    const store = new InMemoryStore();
    // Initialize a window, then delete the key
    store.getWindow('win-key', 5);
    store.recordBucket('win-key', 0, 10);
    store.delete('win-key');
    // After delete, getWindow should return a fresh zero-filled array
    const buckets = store.getWindow('win-key', 5);
    expect(buckets).toEqual([0, 0, 0, 0, 0]);
  });

  // ── getWindow ────────────────────────────────────────────────────────

  it('getWindow returns zero-filled array for unknown key', () => {
    const store = new InMemoryStore();
    const buckets = store.getWindow('unknown', 4);
    expect(buckets).toEqual([0, 0, 0, 0]);
  });

  it('getWindow returns correct length', () => {
    const store = new InMemoryStore();
    expect(store.getWindow('a', 3)).toHaveLength(3);
    expect(store.getWindow('b', 60)).toHaveLength(60);
    expect(store.getWindow('c', 1)).toHaveLength(1);
  });

  it('getWindow returns defensive copy (mutating does not affect store)', () => {
    const store = new InMemoryStore();
    const copy = store.getWindow('def', 3);
    copy[0] = 999;
    const fresh = store.getWindow('def', 3);
    expect(fresh[0]).toBe(0);
  });

  // ── recordBucket ─────────────────────────────────────────────────────

  it('recordBucket increments specific bucket', () => {
    const store = new InMemoryStore();
    store.getWindow('rec', 5); // initialize
    store.recordBucket('rec', 2, 10);
    store.recordBucket('rec', 2, 5);
    const buckets = store.getWindow('rec', 5);
    expect(buckets).toEqual([0, 0, 15, 0, 0]);
  });

  it('recordBucket out of bounds is safe (no-op)', () => {
    const store = new InMemoryStore();
    store.getWindow('bounds', 3);
    // These should not throw
    store.recordBucket('bounds', -1, 10);
    store.recordBucket('bounds', 3, 10);
    store.recordBucket('bounds', 100, 10);
    const buckets = store.getWindow('bounds', 3);
    expect(buckets).toEqual([0, 0, 0]);
  });

  // ── resetBuckets ─────────────────────────────────────────────────────

  it('resetBuckets zeroes specified indices', () => {
    const store = new InMemoryStore();
    store.getWindow('reset', 4);
    store.recordBucket('reset', 0, 10);
    store.recordBucket('reset', 1, 20);
    store.recordBucket('reset', 2, 30);
    store.recordBucket('reset', 3, 40);
    store.resetBuckets('reset', [1, 3]);
    const buckets = store.getWindow('reset', 4);
    expect(buckets).toEqual([10, 0, 30, 0]);
  });

  it('resetBuckets leaves other buckets untouched', () => {
    const store = new InMemoryStore();
    store.getWindow('partial', 5);
    store.recordBucket('partial', 0, 5);
    store.recordBucket('partial', 1, 10);
    store.recordBucket('partial', 2, 15);
    store.recordBucket('partial', 3, 20);
    store.recordBucket('partial', 4, 25);
    store.resetBuckets('partial', [0, 4]);
    const buckets = store.getWindow('partial', 5);
    expect(buckets).toEqual([0, 10, 15, 20, 0]);
  });

  // ── Multiple keys independent ────────────────────────────────────────

  it('multiple keys are independent', () => {
    const store = new InMemoryStore();
    store.set('a', 100);
    store.set('b', 200);
    store.increment('a', 1);
    store.increment('b', 2);
    expect(store.get('a')).toBe(101);
    expect(store.get('b')).toBe(202);

    store.getWindow('win-a', 3);
    store.getWindow('win-b', 3);
    store.recordBucket('win-a', 0, 50);
    store.recordBucket('win-b', 1, 75);
    expect(store.getWindow('win-a', 3)).toEqual([50, 0, 0]);
    expect(store.getWindow('win-b', 3)).toEqual([0, 75, 0]);

    store.delete('a');
    expect(store.get('a')).toBe(0);
    expect(store.get('b')).toBe(202);
  });
});
