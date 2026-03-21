import type { FenceStore } from './types';
import { InMemoryStore } from './store';

/**
 * Bucketed sliding window for tracking token usage over a time period.
 * Divides the window into fixed-size buckets and lazily evicts stale
 * buckets on each access. Supports pluggable storage via FenceStore.
 */
export class SlidingWindow {
  private readonly bucketDuration: number;
  private lastAccessTime: number;
  private lastBucketIndex: number;
  private readonly store: FenceStore;
  private readonly storeKey: string;

  constructor(
    private readonly windowDuration: number,
    private readonly bucketCount: number = 60,
    store?: FenceStore,
    storeKey: string = 'default',
  ) {
    this.bucketDuration = windowDuration / bucketCount;
    this.store = store ?? new InMemoryStore();
    this.storeKey = `window:${storeKey}`;
    // Initialize window in store
    this.store.getWindow(this.storeKey, this.bucketCount);
    // Restore last access time from store if available, otherwise use current time
    const storedAccessTime = this.store.get(`${this.storeKey}:lastAccess`) as number;
    this.lastAccessTime = storedAccessTime > 0 ? storedAccessTime : Date.now();
    this.lastBucketIndex = this.getBucketIndex(this.lastAccessTime);
  }

  private getBucketIndex(timestamp: number): number {
    return Math.floor(timestamp / this.bucketDuration) % this.bucketCount;
  }

  private evictStaleBuckets(now: number): void {
    const elapsed = now - this.lastAccessTime;
    if (elapsed <= 0) return;

    const bucketsElapsed = Math.floor(elapsed / this.bucketDuration);

    if (bucketsElapsed >= this.bucketCount) {
      // Entire window has passed — reset all buckets
      const allIndices = Array.from({ length: this.bucketCount }, (_, i) => i);
      this.store.resetBuckets(this.storeKey, allIndices);
    } else if (bucketsElapsed > 0) {
      // Reset stale buckets between last and current
      const indices: number[] = [];
      for (let i = 1; i <= bucketsElapsed; i++) {
        indices.push((this.lastBucketIndex + i) % this.bucketCount);
      }
      this.store.resetBuckets(this.storeKey, indices);
    }
  }

  /**
   * Record token usage at a given timestamp (defaults to now).
   */
  record(tokens: number, timestamp: number = Date.now()): void {
    this.evictStaleBuckets(timestamp);
    const idx = this.getBucketIndex(timestamp);
    this.store.recordBucket(this.storeKey, idx, tokens);
    this.lastAccessTime = timestamp;
    this.lastBucketIndex = idx;
    this.store.set(`${this.storeKey}:lastAccess`, timestamp);
  }

  /**
   * Get the total token usage across the entire window at a given timestamp.
   */
  getTotal(timestamp: number = Date.now()): number {
    this.evictStaleBuckets(timestamp);
    this.lastAccessTime = timestamp;
    this.lastBucketIndex = this.getBucketIndex(timestamp);
    this.store.set(`${this.storeKey}:lastAccess`, timestamp);
    const buckets = this.store.getWindow(this.storeKey, this.bucketCount);
    return (buckets as number[]).reduce((sum, v) => sum + v, 0);
  }
}
