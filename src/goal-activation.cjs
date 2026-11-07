// Whether a session's goal may continue on its own. DSH keeps this process-local, outside the
// goal projection the session list carries: every agent starts disarmed, so after a Harness
// restart or a session load an active goal waits for /goal resume while its projection still
// says "active". goals/get reads the live view, which does carry it.
const ACTIVATIONS = new Set(["armed", "disarmed"]);

async function goalActivation(api, sessionId) {
  const remote = await api.ensureRemote();
  if (!remote) return null;
  const view = await remote.call("goals/get", { agentId: sessionId }, 8000);
  return ACTIVATIONS.has(view?.activation) ? view.activation : null;
}

module.exports = { goalActivation };
