import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's built-in auto-cleanup only registers itself against a *global* afterEach,
// which requires vitest's `test.globals: true`. This config intentionally keeps
// globals off (tests import describe/it/expect explicitly), and vitest's jsdom
// `document` persists across `it()` blocks within one file, so without this the
// skeleton/error DOM from an earlier test in the same file leaks into the next
// one. Registering cleanup explicitly here restores per-test isolation.
afterEach(() => {
  cleanup();
});
