/**
 * Shared TTL cache for data sources — Phase 4, task 4.5.
 *
 * In-memory only for Phase 4. Phase 5+ can add on-disk persistence if needed.
 * Each entry stores the value and the timestamp it was inserted.
 */

interface CacheEntry<T> {
  value: T;
  insertedAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, insertedAt: Date.now() });
  }

  /** Remove all expired entries. Call periodically to prevent unbounded growth. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.insertedAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}

/** Shared caches used by data sources. */
export const priceHistoryCache = new TtlCache<unknown>(5 * 60 * 1000);   // 5 min
export const fundamentalsCache = new TtlCache<unknown>(60 * 60 * 1000);  // 1 hour
export const macroCache = new TtlCache<unknown>(60 * 60 * 1000);         // 1 hour
export const sentimentCache = new TtlCache<unknown>(30 * 60 * 1000);     // 30 min
