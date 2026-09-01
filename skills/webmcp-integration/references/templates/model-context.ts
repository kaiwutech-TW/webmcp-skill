/**
 * WebMCP thin wrapper — dual entry point, name-keyed sync, AbortController registry,
 * contract-fingerprint re-registration, console test bench.
 * Framework-free; MIT. Adapt names/types to your app.
 */

export interface WebMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface WebMcpTool {
  name: string;
  /** Written for the model — keep it in English. */
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  execute(args: Record<string, unknown>): Promise<WebMcpToolResult>;
}

interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): void;
  provideContext?(ctx: { tools: WebMcpTool[] }): void;
}

declare global {
  interface Navigator { modelContext?: ModelContextLike }
  interface Document { modelContext?: ModelContextLike }
}

/** ChatGPT's browser exposes document.modelContext; Chrome exposes navigator.modelContext. */
export function getModelContext(): ModelContextLike | undefined {
  if (typeof document !== "undefined" && document.modelContext) return document.modelContext;
  if (typeof navigator !== "undefined" && navigator.modelContext) return navigator.modelContext;
  return undefined;
}

export const hasWebMcp = (): boolean => !!getModelContext();

let registered = new Map<string, WebMcpTool>();
const controllers = new Map<string, AbortController>();
/** Contract fingerprint: if description/schema/annotations change, re-register. */
const contracts = new Map<string, string>();
const contractOf = (t: WebMcpTool): string =>
  JSON.stringify([t.description, t.inputSchema ?? null, t.annotations ?? null]);

/**
 * Sync the full desired toolset. Call whenever role/page/state changes.
 * Uses provideContext (atomic) when available; otherwise diffs by name+contract:
 * abort what disappeared or changed, register what is new.
 */
export function syncTools(tools: WebMcpTool[]): void {
  const mc = getModelContext();
  const next = new Map(tools.map((t) => [t.name, t]));
  if (!mc) { registered = next; return; }              // progressive enhancement

  if (typeof mc.provideContext === "function") {
    mc.provideContext({ tools });
    registered = next;
    return;
  }

  for (const name of registered.keys()) {
    const incoming = next.get(name);
    if (!incoming || contracts.get(name) !== contractOf(incoming)) {
      const ac = controllers.get(name);
      if (ac) { ac.abort(); controllers.delete(name); }
      else { try { mc.unregisterTool?.(name); } catch { /* absent on Chrome 151 */ } }
      contracts.delete(name);
    }
  }
  for (const [name, tool] of next) {
    if (!controllers.has(name)) {
      const ac = new AbortController();
      try {
        mc.registerTool(tool, { signal: ac.signal });
        controllers.set(name, ac);
        contracts.set(name, contractOf(tool));
      } catch { /* never let registration break the site */ }
    }
  }
  registered = next;
}

export const clearTools = (): void => syncTools([]);
export const registeredCount = (): number => registered.size;

export function textResult(value: unknown): WebMcpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text", text }] };
}

/** Console bench — works even without WebMCP support: webmcp.list() / webmcp.execute(...) */
declare global {
  interface Window {
    webmcp?: {
      list(): Array<{ name: string; description: string; readOnly: boolean }>;
      execute(name: string, args?: Record<string, unknown>): Promise<string>;
    };
  }
}
if (typeof window !== "undefined") {
  window.webmcp = {
    list: () => [...registered.values()].map((t) => ({
      name: t.name, description: t.description, readOnly: t.annotations?.readOnlyHint === true,
    })),
    execute: async (name, args = {}) => {
      const tool = registered.get(name);
      if (!tool) throw new Error(`No tool "${name}" — registered: ${[...registered.keys()].join(", ")}`);
      const out = await tool.execute(args);
      return out.content.map((c) => c.text).join("\n");
    },
  };
}
