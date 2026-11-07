// Keep the memory integration's regressions in the main suite.
require('node:test')('DSH memory regressions', async () => {
  await import('../integrations/dsh-memory/memory.test.mjs');
});
