import test from 'node:test';
import { allowlistControls } from '../../scripts/check/secrets.ts';
// Missing scanner is a failure, not a skipped or simulated positive control.
test('real Gitleaks: nine public matches pass, planted secrets and other paths fail, restored files pass', () => {
  allowlistControls();
});
