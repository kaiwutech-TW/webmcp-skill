/**
 * Central tool wrapper — every tool goes through this and cannot opt out (that is
 * the point). Validate on entry, structured refusal envelope with a next-step hint,
 * quarantine fence for untrusted output, bounded output with an explicit trim marker.
 * Wire your own activity log where marked. MIT.
 */
import type { WebMcpTool, WebMcpToolResult } from "./model-context.ts";
import { textResult } from "./model-context.ts";
import { fenceUntrusted } from "./quarantine.ts";
import { validateArgs } from "./validate.ts";

/** Policy refusals and malformed input share one shape the agent can act on. */
export class ToolRefusal extends Error {
  constructor(public code: string, message: string, public hint: string) { super(message); }
}
export const refuse = (code: string, message: string, hint: string): never => {
  throw new ToolRefusal(code, message, hint);
};

/** Chrome guidance is ~1500 chars; data-heavy sites can stretch, but stay bounded. */
const OUTPUT_BUDGET = 4000;

export function withGuardrails(tool: WebMcpTool): WebMcpTool {
  // additionalProperties:false unless the tool already decided
  const inputSchema =
    tool.inputSchema && tool.inputSchema["type"] === "object" && !("additionalProperties" in tool.inputSchema)
      ? { ...tool.inputSchema, additionalProperties: false }
      : tool.inputSchema;

  return {
    ...tool,
    ...(inputSchema ? { inputSchema } : {}),
    async execute(args): Promise<WebMcpToolResult> {
      // → hook your activity log here (tool.name, args summary, status pending)
      const fail = (code: string, message: string, hint: string): WebMcpToolResult =>
        textResult({ ok: false, error: { code, message }, hint });

      const problems = validateArgs(inputSchema, args);
      if (problems.length)
        return fail(
          "invalid_input",
          problems.map((p) => `${p.path} ${p.message}`).join("; "),
          "Correct the arguments to match the declared inputSchema and call the tool again.",
        );
      try {
        const out = await tool.execute(args);
        let text = out.content.map((c) => c.text).join("\n");
        if (text.length > OUTPUT_BUDGET)
          text = `${text.slice(0, OUTPUT_BUDGET)}\n[trimmed ${text.length - OUTPUT_BUDGET} chars to fit the tool-output budget — ask a narrower question]`;
        if (tool.annotations?.untrustedContentHint) text = fenceUntrusted(text);
        return { content: [{ type: "text", text }] };
      } catch (e) {
        if (e instanceof ToolRefusal) return fail(e.code, e.message, e.hint);
        const msg = (e as Error).message || String(e);
        return fail("tool_failed", msg,
          "The message above states what was wrong — fix that and retry once; if it persists, tell the user.");
      }
    },
  };
}

/**
 * Human-approval gate for the single submission tool: execute awaits a Promise that
 * only a human click resolves. Keep exactly one pending approval; a concurrent submit
 * must refuse with `approval_pending` — never resolve(false), which reads as a decline.
 *
 * Idempotency: after success, record {draftId, at, result}. A retry after timeout gets
 * the original result replayed ("alreadyCreated … Do not draft it again"), not a
 * second document.
 */
export interface ApprovalRequest {
  title: string;
  facts: Array<[string, string]>;
  resolve: (approved: boolean) => void;
}
let approval: ApprovalRequest | null = null;
const listeners = new Set<() => void>();
export const getApproval = (): ApprovalRequest | null => approval;
export const subscribeApproval = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
export function requestApproval(title: string, facts: Array<[string, string]>): Promise<boolean> {
  if (approval) return Promise.resolve(false); // callers must check getApproval() first and refuse
  return new Promise<boolean>((res) => {
    approval = {
      title, facts,
      resolve: (ok) => { approval = null; listeners.forEach((f) => f()); res(ok); },
    };
    listeners.forEach((f) => f());
  });
}
