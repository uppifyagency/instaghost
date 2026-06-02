/**
 * LRU Cache implementation for efficient deduplication
 * Automatically evicts least recently used items when capacity is reached
 */
class LRUCache {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Get value from cache and mark as recently used
   * @param {string} key - Cache key
   * @returns {*} Value or null if not found
   */
  get(key) {
    if (!this.cache.has(key)) return null;
    
    const value = this.cache.get(key);
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    
    return value;
  }

  /**
   * Set value in cache, evicting LRU item if at capacity
   * @param {string} key - Cache key
   * @param {*} value - Value to store
   */
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item in Map)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key was deleted
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all items from cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get current cache size
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get all keys in cache (oldest to newest)
   * @returns {IterableIterator<string>}
   */
  keys() {
    return this.cache.keys();
  }

  /**
   * Get all values in cache
   * @returns {IterableIterator<*>}
   */
  values() {
    return this.cache.values();
  }

  /**
   * Get all entries as array
   * @returns {Array<[string, *]>}
   */
  entries() {
    return Array.from(this.cache.entries());
  }
}

// Make available globally for content scripts
if (typeof window !== 'undefined') {
  window.LRUCache = LRUCache;
}
