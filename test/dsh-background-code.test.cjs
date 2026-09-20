// Keep the integration's execution/cancellation regressions in the main suite.
require('node:test')('DSH background code regressions', async () => {
  await import('../integrations/dsh-background-code/background-run.test.mjs');
});
