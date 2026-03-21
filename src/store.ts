import type { FenceStore } from './types';

/**
 * In-memory implementation of FenceStore.
 * Uses Maps for cumulative counters and sliding window buckets.
 * All methods are synchronous. Data resets on process restart.
 */
export class InMemoryStore implements FenceStore {
  private counters = new Map<string, number>();
  private windows = new Map<string, number[]>();

  get(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  set(key: string, value: number): void {
    this.counters.set(key, value);
  }

  increment(key: string, delta: number): number {
    const current = this.counters.get(key) ?? 0;
    const newValue = current + delta;
    this.counters.set(key, newValue);
    return newValue;
  }

  delete(key: string): void {
    this.counters.delete(key);
    this.windows.delete(key);
  }

  getWindow(key: string, bucketCount: number): number[] {
    const existing = this.windows.get(key);
    if (existing && existing.length === bucketCount) return [...existing];
    const buckets = new Array<number>(bucketCount).fill(0);
    this.windows.set(key, buckets);
    return [...buckets];
  }

  recordBucket(key: string, bucketIndex: number, delta: number): void {
    const buckets = this.windows.get(key);
    if (!buckets) return;
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex] += delta;
    }
  }

  resetBuckets(key: string, bucketIndices: number[]): void {
    const buckets = this.windows.get(key);
    if (!buckets) return;
    for (const idx of bucketIndices) {
      if (idx >= 0 && idx < buckets.length) {
        buckets[idx] = 0;
      }
    }
  }
}
