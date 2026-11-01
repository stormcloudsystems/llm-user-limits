// In-memory counter store (one process). update() is synchronous, so in Node's single-threaded event loop no other
// request can interleave between read and write: that is what makes reserve() atomic. Restarting the process
// forgets all counters (documented limitation).
export function memoryStore() {
  const m = new Map();
  return {
    get: (key) => m.get(key),
    update(key, fn) {
      const next = fn(m.get(key));
      m.set(key, next);
      return next;
    },
  };
}
