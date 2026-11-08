/**
 * WebMCP thin wrapper — entry-point detection, name-keyed sync, AbortController registry,
 * contract-fingerprint re-registration, console test bench.
 * Tracks the WebMCP CG draft of 2026-11-02 (registerTool returns a Promise, unregistration
 * is AbortSignal-only, no provideContext/unregisterTool). Framework-free; MIT.
 */

export interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
}

/** Spec ToolAnnotations (all default false). Declare honestly — agents gate on these. */
export interface WebMcpAnnotations {
  readOnlyHint?: boolean;
  /** Output carries text typed by third parties (see quarantine.ts). */
  untrustedContentHint?: boolean;
  /** Executing has real-world consequences — agents should confirm with the user first. */
  consequentialHint?: boolean;
  /** Tool exists for development only (Chrome 156+). */
  debugging?: boolean;
}

/** Spec ToolExecuteCallbackOptions: the browser aborts `signal` when the call is cancelled. */
export interface WebMcpExecuteOptions {
  signal?: AbortSignal;
}

export interface WebMcpTool {
  name: string;
  /** Human-readable label (optional). */
  title?: string;
  /** Written for the model — keep it in English. */
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: WebMcpAnnotations;
  execute(args: Record<string, unknown>, options?: WebMcpExecuteOptions): Promise<WebMcpToolResult>;
}

interface ModelContextLike {
  /** Spec: returns Promise<undefined>; rejects e.g. NotAllowedError when Permissions-Policy `tools` is off. */
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<unknown> | unknown;
}

declare global {
  interface Navigator { modelContext?: ModelContextLike }
  interface Document { modelContext?: ModelContextLike }
}

/**
 * Spec + Chrome docs + ChatGPT docs all use document.modelContext. navigator.modelContext is
 * only a fallback for older Chromium builds from before the getter moved.
 */
export function getModelContext(): ModelContextLike | undefined {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return undefined;
}

export const hasWebMcp = (): boolean => !!getModelContext();

/** Desired toolset (also what the console bench runs, even without WebMCP). */
let registered = new Map<string, WebMcpTool>();
/** One controller per tool the browser holds or is registering. abort == unregister. */
const controllers = new Map<string, AbortController>();
/** Tools whose registerTool() promise actually resolved. */
const live = new Set<string>();
/** Contract fingerprint: if model-facing parts change, re-register. */
const contracts = new Map<string, string>();
const contractOf = (t: WebMcpTool): string =>
  JSON.stringify([t.title ?? null, t.description, t.inputSchema ?? null, t.outputSchema ?? null, t.annotations ?? null]);

export interface SyncReport {
  /** Tools the browser refused (bad name, Permissions-Policy off, detached document...). */
  failed: Array<{ name: string; error: unknown }>;
}

function unregister(name: string): void {
  controllers.get(name)?.abort();
  controllers.delete(name);
  contracts.delete(name);
  live.delete(name);
}

/**
 * Sync the full desired toolset. Call whenever role/page/state changes.
 * Diffs by name + contract: abort what disappeared or changed, register what is new.
 * registerTool() is async per spec — a rejection is caught here and the tool is NOT
 * recorded as live. Callers may ignore the returned promise; it never rejects.
 */
export async function syncTools(tools: WebMcpTool[]): Promise<SyncReport> {
  const mc = getModelContext();
  const next = new Map(tools.map((t) => [t.name, t]));
  registered = next;
  if (!mc) return { failed: [] };                       // progressive enhancement

  for (const name of [...controllers.keys()]) {
    const incoming = next.get(name);
    if (!incoming || contracts.get(name) !== contractOf(incoming)) unregister(name);
  }

  const pending: Array<Promise<{ name: string; error: unknown } | null>> = [];
  for (const [name, tool] of next) {
    if (controllers.has(name)) continue;
    const ac = new AbortController();
    controllers.set(name, ac);                           // reserve the name synchronously
    contracts.set(name, contractOf(tool));
    let attempt: Promise<unknown>;
    try {
      attempt = Promise.resolve(mc.registerTool(tool, { signal: ac.signal }));
    } catch (error) {
      attempt = Promise.reject(error);                   // some builds throw synchronously
    }
    pending.push(attempt.then(
      () => {
        if (controllers.get(name) === ac && !ac.signal.aborted) live.add(name);
        return null;
      },
      (error: unknown) => {
        // Only roll back if a later sync hasn't already replaced this registration.
        if (controllers.get(name) === ac) { controllers.delete(name); contracts.delete(name); }
        return { name, error };
      },
    ));
  }
  const failed = (await Promise.all(pending)).filter((f): f is { name: string; error: unknown } => f !== null);
  return { failed };
}

export const clearTools = (): Promise<SyncReport> => syncTools([]);
/** Tools the browser confirmed — use this for the "WebMCP ready · N tools" pill. */
export const registeredCount = (): number => live.size;

export function textResult(value: unknown): WebMcpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text", text }] };
}

/** Console bench — works even without WebMCP support: webmcp.list() / webmcp.execute(...) */
declare global {
  interface Window {
    webmcp?: {
      list(): Array<{ name: string; description: string; readOnly: boolean; live: boolean }>;
      execute(name: string, args?: Record<string, unknown>): Promise<string>;
    };
  }
}
if (typeof window !== "undefined") {
  window.webmcp = {
    list: () => [...registered.values()].map((t) => ({
      name: t.name, description: t.description,
      readOnly: t.annotations?.readOnlyHint === true, live: live.has(t.name),
    })),
    execute: async (name, args = {}) => {
      const tool = registered.get(name);
      if (!tool) throw new Error(`No tool "${name}" — registered: ${[...registered.keys()].join(", ")}`);
      const out = await tool.execute(args, { signal: new AbortController().signal });
      return out.content.map((c) => c.text).join("\n");
    },
  };
}
