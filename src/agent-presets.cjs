// The agent presets DSH composes sessions from: their roster, for the widget's preset picker.
// A preset is chosen when a session is created (session/create's agentPreset); the legacy
// generation has no roster, so it answers with none instead of failing.
async function listAgentPresets(api) {
  const remote = await api.ensureRemote();
  if (!remote) return [];
  const value = await remote.call("agentPresets/list", {}, 15000);
  return (Array.isArray(value?.presets) ? value.presets : [])
    .filter((preset) => typeof preset?.id === "string" && preset.id)
    .map((preset) => ({
      id: preset.id,
      name: typeof preset.name === "string" && preset.name.trim() ? preset.name.trim() : null,
      description: typeof preset.description === "string" ? preset.description.trim() : "",
      isDefault: preset.isDefault === true,
      ...(typeof preset.broken === "string" && preset.broken ? { broken: preset.broken } : {}),
    }));
}

// What a new session starts with: only a preset id the roster could name passes through.
function sessionCreateOptions(options = {}) {
  const preset = typeof options.agentPreset === "string" ? options.agentPreset.trim() : "";
  const { agentPreset: _unused, ...rest } = options || {};
  return preset ? { ...rest, agentPreset: preset } : rest;
}

module.exports = { listAgentPresets, sessionCreateOptions };
