# webmcp-skill

**An agent skill that teaches your coding agent how to make a website agent-ready with
[WebMCP](https://github.com/webmachinelearning/webmcp)** (`document.modelContext`) — distilled from a production ERP that real agents
(ChatGPT's built-in browser) drive on a live site.

[繁體中文說明 →](./README.zh-TW.md)

## What you get

- **[`skills/webmcp-integration/SKILL.md`](./skills/webmcp-integration/SKILL.md)** — the playbook:
  - API quick reference tracking the WebMCP CG draft of 2026-11-02 (async `registerTool`,
    AbortSignal-only unregistration, the spec's annotation set incl. `consequentialHint`,
    cross-origin two-sided opt-in) and what was removed from the spec
  - **Eight browser traps** — e.g. the browser does *not* validate arguments against your
    `inputSchema`; `registerTool` can reject asynchronously; there is no `unregisterTool`;
    `execute` gets a cancellation signal you must honor
  - **Five structural guardrails**: the write red-line in the registry (dangerous tools simply
    don't exist), central validation + `{ok:false, error:{code}, hint}` refusals, a quarantine
    fence for prompt injection in third-party text, idempotent submission with replay,
    and live schemas as boundaries (out-of-range requests become unrepresentable)
  - Human-approval gating, agent-flow details (orientation tool, next-step hints,
    ambiguity candidates), and testing recipes down to CI-grade evidence
- **[`references/templates/`](./skills/webmcp-integration/references/templates/)** — four
  framework-free TypeScript starting points (MIT): `model-context.ts` (entry-point detection +
  async contract-fingerprint sync), `tool-wrapper.ts` (central guardrail layer + approval gate),
  `validate.ts` (in-handler schema validation), `quarantine.ts` (untrusted-text fence).
  Smoke tests: `node --test test/` (Node ≥ 23.6).

## Install

**Claude Code** — copy the skill into your user skills directory:

```bash
git clone https://github.com/kaiwutech-TW/webmcp-skill
cp -r webmcp-skill/skills/webmcp-integration ~/.claude/skills/
```

Then in any project: *"make this site agent-ready with WebMCP"* — the skill loads and the
agent follows the playbook. Works with any agent runner that reads `SKILL.md` frontmatter
(the [Agent Skills](https://code.claude.com/docs/en/skills) format).

## Where this comes from

Built for the 2026 OpenAI WebMCP Challenge on top of
[E-ternal](https://github.com/kaiwutech-TW/e-ternal-public), an open-source ERP for
Taiwanese SMEs. Live demo: <https://et-demo.kaiwu.com.tw> (sign in `judge` / `webmcp-judge`) ·
[2-minute video](https://youtu.be/iiRdpZtWoyk). Every guardrail in the playbook is backed by
tests in that repo (`apps/web/test/webmcp-hardening.test.ts`), and the patterns were verified
end-to-end with a real agent: report queries → co-edited draft → human approval → document
posted with server-computed tax.

## License

MIT © 2026 [Kaiwu Tech](https://kaiwu.com.tw). The template files were written for this
repository by the same authors as the (LGPL-licensed) E-ternal implementation and are
released here under MIT.
