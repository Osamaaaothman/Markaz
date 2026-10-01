import { useEffect, useState } from "react";

// Waits until the value has stopped changing for `delayMs` — used so a search box sends one
// request when the user pauses, not one per keystroke.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
