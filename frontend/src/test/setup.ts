// Run every frontend test in a non-Vietnam timezone so VN-time bugs surface.
process.env.TZ = 'America/New_York';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount and clear the jsdom document after each test so component tests
// in the same file don't see elements left over from a previous render().
afterEach(() => cleanup());
