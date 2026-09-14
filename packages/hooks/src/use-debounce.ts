// Debounce hook.
//
// Phase 1: stub. Phase 2 implements with `useEffect` + cleanup.

import { useEffect, useState } from 'react';

/**
 * Returns a debounced version of `value` that updates after `delay` ms of stability.
 *
 * Phase 1: synchronous passthrough; full implementation in phase 2.
 */
export function useDebounce<T>(value: T, delay: number = 200): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}