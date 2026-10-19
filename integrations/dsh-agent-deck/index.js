import {
  candidateLocations,
  detectRunning,
  launchDeck,
  originOf,
  readAsarVersion,
  readWidgetSettings,
  validHarnessUrl,
} from "./deck-app.mjs";

export const name = "dsh-agent-deck";
export const inject = ["tools"];

const TOOL_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value ?? "") }],
};

const EMPTY_PARAMETERS = { type: "object", properties: {}, additionalProperties: false };

function json(value) {
  return JSON.stringify(value, null, 2);
}

/** Origin of the Harness serving this session, or null when it is not served over HTTP. */
export function harnessOrigin(ctx, env = process.env) {
  try {
    const server = typeof ctx.get === "function" ? ctx.get("webServer") : ctx.webServer;
    if (server) {
      const host = typeof server.host === "string" ? server.host : "";
      const port = Number(server.port);
      if (host && Number.isInteger(port) && port > 0) {
        const display = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
        const protocol = server.protocol === "https:" ? "https:" : "http:";
        return `${protocol}//${display.includes(":") ? `[${display}]` : display}:${port}`;
      }
    }
  } catch {}
  return originOf(env.DSH_WIDGET_URL);
}

export function buildStatus({ ctx = null, env = process.env, platform = process.platform, home } = {}) {
  const locations = candidateLocations({ platform, env, home });
  const location = locations[0] ?? null;
  const version = location?.asarPath ? readAsarVersion(location.asarPath) : null;
  const settings = readWidgetSettings({ platform, env, home });
  const current = harnessOrigin(ctx, env);
  return {
    installed: Boolean(location),
    executable: location?.executable ?? null,
    version,
    installSource: location?.source ?? null,
    otherInstallations: locations.slice(1).map((entry) => entry.executable),
    harnessOrigin: current,
    widget: {
      settingsFound: settings.found,
      settingsPath: settings.path,
      configuredHarnessOrigin: settings.harnessOrigin,
      launchedFromUrl: settings.harnessLaunchUrlConfigured,
      pointedAtThisHarness: Boolean(current && settings.harnessOrigin && current === settings.harnessOrigin),
      deviceAccessEnabled: settings.deviceAccessEnabled,
      size: settings.size,
      windowLayer: settings.windowLayer,
    },
  };
}

export function apply(ctx) {
  const definitions = [
    {
      name: "deck_status",
      description:
        "Report the NeoXider Agent Deck desktop widget on this machine: whether it is installed, where, its installed version, "
        + "whether a process is running, which Harness origin its settings point at, and whether that is the Harness serving this session. "
        + "Reads the app's own widget-settings.json; the launch URL token is never returned.",
      parameters: EMPTY_PARAMETERS,
      output: TOOL_OUTPUT,
      async execute() {
        const status = buildStatus({ ctx });
        const probe = await detectRunning();
        return json({ ...status, running: probe.running, runningError: probe.error });
      },
    },
    {
      name: "deck_open",
      description:
        "Open the NeoXider Agent Deck desktop widget, attaching it to a Harness. Defaults to the Harness serving this session. "
        + "Deck allows one instance: when it is already running this only brings its window forward, and the running copy keeps its current Harness.",
      parameters: {
        type: "object",
        properties: {
          harness_url: {
            type: "string",
            description: "Absolute http(s) Harness URL the widget should attach to. Defaults to this session's Harness.",
          },
        },
        additionalProperties: false,
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        const location = candidateLocations()[0] ?? null;
        if (!location) {
          return json({ opened: false, reason: "NeoXider Agent Deck is not installed in a known location. Set NEOXIDER_AGENT_DECK_PATH to its executable." });
        }
        const requested = typeof args?.harness_url === "string" ? validHarnessUrl(args.harness_url) : null;
        if (typeof args?.harness_url === "string" && !requested) {
          return json({ opened: false, reason: "harness_url must be an absolute http(s) URL without credentials." });
        }
        const target = requested ?? harnessOrigin(ctx);
        if (!target) {
          return json({ opened: false, reason: "This Harness is not served over HTTP and no harness_url was given." });
        }
        const probe = await detectRunning();
        try {
          const launched = await launchDeck({ location, harnessUrl: target });
          return json({
            opened: true,
            executable: launched.command,
            harnessUrl: target,
            alreadyRunning: probe.running === true,
            note: probe.running === true
              ? "Deck was already running, so this focuses the existing window; that copy keeps the Harness it started with."
              : "Deck was started with DSH_WIDGET_URL set to the target Harness.",
          });
        } catch (error) {
          return json({ opened: false, reason: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  ];

  for (const definition of definitions) {
    try {
      ctx.effect(() => ctx.tools.register(definition), `dsh-agent-deck: tool ${definition.name}`);
    } catch (error) {
      console.error(`[dsh-agent-deck] tool not registered: ${definition.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log("[dsh-agent-deck] loaded: deck_status, deck_open");
}
