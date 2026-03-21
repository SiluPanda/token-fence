import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlidingWindow } from '../window';
import { InMemoryStore } from '../store';

describe('SlidingWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── getTotal on fresh window ────────────────────────────────────────

  it('getTotal returns 0 for fresh window', () => {
    const win = new SlidingWindow(60_000, 60);
    expect(win.getTotal()).toBe(0);
  });

  // ── record then getTotal ────────────────────────────────────────────

  it('record then getTotal returns recorded amount', () => {
    const win = new SlidingWindow(60_000, 60);
    win.record(100);
    expect(win.getTotal()).toBe(100);
  });

  // ── record increments correct bucket ────────────────────────────────

  it('record increments correct bucket via store', () => {
    const store = new InMemoryStore();
    const win = new SlidingWindow(60_000, 60, store, 'test');
    win.record(50);
    const buckets = store.getWindow('window:test', 60);
    const total = buckets.reduce((s, v) => s + v, 0);
    expect(total).toBe(50);
  });

  // ── getTotal sums all buckets ───────────────────────────────────────

  it('getTotal sums all buckets', () => {
    const store = new InMemoryStore();
    const win = new SlidingWindow(60_000, 6, store, 'sum');

    // Record at different times to land in different buckets
    const now = Date.now();
    win.record(10, now);
    // Advance 10s (one bucket = 60_000/6 = 10_000ms)
    vi.advanceTimersByTime(10_000);
    win.record(20, Date.now());
    vi.advanceTimersByTime(10_000);
    win.record(30, Date.now());

    expect(win.getTotal(Date.now())).toBe(60);
  });

  // ── Multiple records in same bucket accumulate ──────────────────────

  it('multiple records in same bucket accumulate', () => {
    const win = new SlidingWindow(60_000, 60);
    win.record(10);
    win.record(20);
    win.record(30);
    expect(win.getTotal()).toBe(60);
  });

  // ── Expired buckets evicted on access ───────────────────────────────

  it('expired buckets are evicted on access (advance by 1 bucket)', () => {
    // 6 buckets, 10s each = 60s window
    const win = new SlidingWindow(60_000, 6);

    win.record(100);
    expect(win.getTotal()).toBe(100);

    // Advance by 1 bucket duration (10s)
    vi.advanceTimersByTime(10_000);
    // Record in a new bucket
    win.record(50, Date.now());

    expect(win.getTotal(Date.now())).toBe(150);

    // Advance by 5 more bucket durations (50s) — now 60s total have passed
    // The first bucket (with 100) should be stale and evicted
    vi.advanceTimersByTime(50_000);
    expect(win.getTotal(Date.now())).toBe(50);
  });

  // ── Full window rollover resets all buckets ─────────────────────────

  it('full window rollover resets all buckets', () => {
    const win = new SlidingWindow(60_000, 60);
    win.record(500);
    expect(win.getTotal()).toBe(500);

    // Advance by the full window duration
    vi.advanceTimersByTime(60_000);
    expect(win.getTotal(Date.now())).toBe(0);
  });

  it('full window rollover resets all buckets (advance > window)', () => {
    const win = new SlidingWindow(60_000, 60);
    win.record(999);

    // Advance well past the window
    vi.advanceTimersByTime(120_000);
    expect(win.getTotal(Date.now())).toBe(0);
  });

  // ── Partial window eviction ─────────────────────────────────────────

  it('partial window eviction clears only stale buckets', () => {
    // 4 buckets, 15s each = 60s window
    const win = new SlidingWindow(60_000, 4);

    const t0 = Date.now();
    win.record(10, t0);

    // Advance by 1 bucket (15s) and record
    vi.advanceTimersByTime(15_000);
    win.record(20, Date.now());

    // Advance by 1 more bucket (15s) and record
    vi.advanceTimersByTime(15_000);
    win.record(30, Date.now());

    // All 3 records should be present
    expect(win.getTotal(Date.now())).toBe(60);

    // Advance by 2 more buckets (30s)
    // The record at t0 (10 tokens) is now 60s old — its bucket is evicted
    // The record at t0+15s (20 tokens) is 45s old — still within 60s window, kept
    vi.advanceTimersByTime(30_000);
    const total = win.getTotal(Date.now());
    expect(total).toBe(50);
  });

  // ── Different durations ─────────────────────────────────────────────

  it('works with 1-minute window', () => {
    const win = new SlidingWindow(60_000, 60);
    win.record(42);
    expect(win.getTotal()).toBe(42);

    vi.advanceTimersByTime(60_000);
    expect(win.getTotal(Date.now())).toBe(0);
  });

  it('works with 1-hour window', () => {
    const win = new SlidingWindow(3_600_000, 60);
    win.record(1000);
    expect(win.getTotal()).toBe(1000);

    // Advance 30 minutes — still within window
    vi.advanceTimersByTime(1_800_000);
    expect(win.getTotal(Date.now())).toBe(1000);

    // Advance another 30 minutes — full hour passed
    vi.advanceTimersByTime(1_800_000);
    expect(win.getTotal(Date.now())).toBe(0);
  });

  // ── Bucket precision ────────────────────────────────────────────────

  it('bucket precision: records at specific times land in correct bucket', () => {
    const store = new InMemoryStore();
    // 4 buckets, 1000ms each = 4000ms window
    const win = new SlidingWindow(4000, 4, store, 'precision');

    const t0 = Date.now();

    // Record at t0 — lands in bucket for t0
    win.record(10, t0);

    // Advance 1000ms — should land in next bucket
    vi.advanceTimersByTime(1000);
    win.record(20, Date.now());

    // Advance another 1000ms — next bucket
    vi.advanceTimersByTime(1000);
    win.record(30, Date.now());

    // Advance another 1000ms — next bucket
    vi.advanceTimersByTime(1000);
    win.record(40, Date.now());

    // All within the 4s window
    expect(win.getTotal(Date.now())).toBe(100);
  });

  // ── Store-backed window ─────────────────────────────────────────────

  it('store-backed window: custom InMemoryStore receives operations', () => {
    const store = new InMemoryStore();
    const win = new SlidingWindow(60_000, 6, store, 'custom');

    // After construction, the store should have an initialized window
    const initial = store.getWindow('window:custom', 6);
    expect(initial).toEqual([0, 0, 0, 0, 0, 0]);

    // Record tokens
    win.record(100);
    const after = store.getWindow('window:custom', 6);
    const total = after.reduce((s, v) => s + v, 0);
    expect(total).toBe(100);

    // getTotal reads from the store
    expect(win.getTotal()).toBe(100);
  });

  it('store-backed window: resetBuckets is called on eviction', () => {
    const store = new InMemoryStore();
    // 4 buckets, 250ms each = 1000ms window
    const win = new SlidingWindow(1000, 4, store, 'evict');

    win.record(50);
    expect(win.getTotal()).toBe(50);

    // Advance full window — should reset all buckets
    vi.advanceTimersByTime(1000);
    expect(win.getTotal(Date.now())).toBe(0);

    // Verify the store's window is zeroed
    const buckets = store.getWindow('window:evict', 4);
    expect(buckets).toEqual([0, 0, 0, 0]);
  });

  // ── Multiple independent windows ───────────────────────────────────

  it('multiple windows with different store keys are independent', () => {
    const store = new InMemoryStore();
    const win1 = new SlidingWindow(60_000, 60, store, 'user:alice');
    const win2 = new SlidingWindow(60_000, 60, store, 'user:bob');

    win1.record(100);
    win2.record(200);

    expect(win1.getTotal()).toBe(100);
    expect(win2.getTotal()).toBe(200);
  });

  // ── Edge: record with explicit timestamp ────────────────────────────

  it('record and getTotal with explicit timestamps', () => {
    const store = new InMemoryStore();
    const win = new SlidingWindow(10_000, 10, store, 'explicit');

    const base = Date.now();
    win.record(10, base);
    win.record(20, base + 1000);
    win.record(30, base + 2000);

    expect(win.getTotal(base + 2000)).toBe(60);

    // At base+10_000, the first record (base, 10s old) is expired and evicted.
    // The second (base+1000, 9s old) and third (base+2000, 8s old) remain.
    expect(win.getTotal(base + 10_000)).toBe(50);
  });
});
