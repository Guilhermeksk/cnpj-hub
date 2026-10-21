import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { MemoryCache } from '../src/cache.js';

describe('MemoryCache', () => {
  beforeEach(() => mock.timers.enable({ apis: ['Date'], now: 0 }));
  afterEach(() => mock.timers.reset());

  it('returns stored values until they expire', () => {
    const cache = new MemoryCache<number>();
    cache.set('a', 1, 1000);
    assert.equal(cache.get('a'), 1);
    mock.timers.tick(999);
    assert.equal(cache.get('a'), 1);
    mock.timers.tick(1);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new MemoryCache<number>({ maxEntries: 2 });
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.get('a'); // "a" is now the most recently used
    cache.set('c', 3, 1000);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
  });

  it('overwrites existing keys and supports delete/clear', () => {
    const cache = new MemoryCache<number>();
    cache.set('a', 1, 1000);
    cache.set('a', 2, 1000);
    assert.equal(cache.get('a'), 2);
    assert.equal(cache.size, 1);
    cache.delete('a');
    assert.equal(cache.get('a'), undefined);
    cache.set('b', 1, 1000);
    cache.clear();
    assert.equal(cache.size, 0);
  });
});
