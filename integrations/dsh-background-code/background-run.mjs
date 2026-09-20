const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function takeHead(value, limit) {
  let output = "";
  let used = 0;
  for (const character of value) {
    const bytes = byteLength(character);
    if (used + bytes > limit) break;
    output += character;
    used += bytes;
  }
  return output;
}

function takeTail(value, limit) {
  let used = 0;
  let selectedStart = value.length;
  for (let end = value.length; end > 0;) {
    let start = end - 1;
    const trailing = value.charCodeAt(start);
    if (trailing >= 0xdc00 && trailing <= 0xdfff && start > 0) {
      const leading = value.charCodeAt(start - 1);
      if (leading >= 0xd800 && leading <= 0xdbff) start -= 1;
    }
    const character = value.slice(start, end);
    const bytes = byteLength(character);
    if (used + bytes > limit) break;
    used += bytes;
    selectedStart = start;
    end = start;
  }
  return value.slice(selectedStart);
}

function retainHeadAndTail(value, limit) {
  if (byteLength(value) <= limit) return value;
  const marker = "\n...[output truncated]...\n";
  if (byteLength(marker) >= limit) return takeHead(marker, limit);
  const available = limit - byteLength(marker);
  const headBudget = Math.ceil(available / 2);
  const head = takeHead(value, headBudget);
  const tail = takeTail(value.slice(head.length), available - byteLength(head));
  return `${head}${marker}${tail}`;
}

function describeError(reason) {
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === "string") return reason;
  try {
    const json = JSON.stringify(reason);
    if (json && json !== "{}") return json;
  } catch {}
  return String(reason ?? "background execution failed");
}

function normalizedError(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(describeError(reason));
  error.cause = reason;
  return error;
}

function serializeOutput(value) {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch (error) {
    return `Unable to serialize run_code output: ${describeError(error)}`;
  }
}

/**
 * Run a native code-tool invocation in the foreground briefly, then hand it to
 * DSH's background-job registry without executing it a second time.
 */
export async function runBackgroundCode({
  args,
  exec,
  execute,
  jobs,
  yieldMs = 1500,
  timeoutMs = 600000,
  outputLimitBytes = 32000,
}) {
  const owner = exec.agent;
  const controller = new AbortController();
  const deferredContexts = [];
  let handedOff = false;
  let killRequested = false;
  let conclusion;
  let settled;

  const relayAbort = () => controller.abort(normalizedError(exec.signal?.reason));
  if (exec.signal?.aborted) relayAbort();
  else exec.signal?.addEventListener("abort", relayAbort, { once: true });

  const executionArgs = args.timeoutMs === undefined
    ? { ...args, timeoutMs }
    : args;
  const execution = Promise.resolve().then(() => execute(executionArgs, {
    ...exec,
    signal: controller.signal,
    deferContext(context) {
      if (handedOff) owner.inject(context);
      else deferredContexts.push(context);
    },
    concludeTurn(...callArgs) {
      if (!handedOff) conclusion = callArgs;
    },
  }));

  // Convert all execution failures into data immediately, so detaching never
  // leaves a rejected promise without a handler.
  const done = execution.then(
    (value) => {
      settled = { status: "completed", value };
      return {
        status: "completed",
        output: retainHeadAndTail(serializeOutput(value), outputLimitBytes),
      };
    },
    (reason) => {
      const error = normalizedError(reason);
      const status = killRequested || controller.signal.aborted ? "killed" : "failed";
      settled = { status, error };
      return {
        status,
        detail: describeError(error),
        output: retainHeadAndTail(describeError(error), outputLimitBytes),
      };
    },
  );

  let timer;
  const yielded = Symbol("yielded");
  const foreground = await Promise.race([
    done,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(yielded), yieldMs);
    }),
  ]);
  clearTimeout(timer);

  // Promise callbacks and timers can become runnable in the same event-loop
  // turn. Prefer the completed foreground value in that boundary race.
  if (foreground !== yielded || settled !== undefined || exec.signal?.aborted) {
    await done;
    exec.signal?.removeEventListener("abort", relayAbort);
    for (const context of deferredContexts) exec.deferContext(context);
    if (conclusion) exec.concludeTurn(...conclusion);
    if (settled.status === "completed") return settled.value;
    throw settled.error;
  }

  let id;
  try {
    id = jobs.start({
      kind: "code",
      label: "run_code",
      owner,
      outputLimitBytes,
      run() {
        return {
          cancel(reason) {
            killRequested = true;
            if (!controller.signal.aborted) controller.abort(normalizedError(reason));
          },
          // The extra microtask keeps registry registration ahead of a
          // synchronously fulfilled native implementation.
          done: Promise.resolve().then(() => done),
        };
      },
    });
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    await done;
    exec.signal?.removeEventListener("abort", relayAbort);
    const failure = new Error(`Unable to continue run_code in the background: ${describeError(error)}`);
    failure.cause = error;
    throw failure;
  }

  handedOff = true;
  exec.signal?.removeEventListener("abort", relayAbort);
  for (const context of deferredContexts.splice(0)) owner.inject(context);

  return {
    logs: [],
    result: {
      job_id: id,
      status: "running",
      message: "run_code is continuing in the background. Continue other work; completion will resume this session and the result can be collected with job_output.",
    },
  };
}
