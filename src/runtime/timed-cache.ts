export interface TimedCacheEntry {
  at: number
}

export function pruneTimedCache<T extends TimedCacheEntry>(
  cache: Map<string, T>,
  now: number,
  maxAgeMs: number,
  maxEntries: number,
): void {
  for (const [key, entry] of cache) {
    if (now - entry.at > maxAgeMs) {
      cache.delete(key)
    }
  }
  if (cache.size <= maxEntries) {
    return
  }
  const oldest = [...cache.entries()]
    .sort((left, right) => left[1].at - right[1].at)
    .slice(0, cache.size - maxEntries)
  for (const [key] of oldest) {
    cache.delete(key)
  }
}

export function setTimedCache<T extends TimedCacheEntry>(
  cache: Map<string, T>,
  key: string,
  entry: T,
  maxAgeMs: number,
  maxEntries: number,
): void {
  cache.set(key, entry)
  pruneTimedCache(cache, entry.at, maxAgeMs, maxEntries)
}
