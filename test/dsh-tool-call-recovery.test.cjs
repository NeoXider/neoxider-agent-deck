// Keep the integration's recovery regressions in the main suite.
require('node:test')('DSH tool call recovery regressions', async () => {
  await import('../integrations/dsh-tool-call-recovery/recovery.test.mjs');
});
