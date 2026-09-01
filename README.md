# webmcp-skill

**An agent skill that teaches your coding agent how to make a website agent-ready with
[WebMCP](https://github.com/webmachinelearning/webmcp)** (`navigator.modelContext` /
`document.modelContext`) — distilled from a production ERP that real agents
(ChatGPT's built-in browser) drive on a live site.

[繁體中文說明 →](./README.zh-TW.md)

## What you get

- **[`skills/webmcp-integration/SKILL.md`](./skills/webmcp-integration/SKILL.md)** — the playbook:
  - API quick reference *as it actually behaves* in late 2026 (both entry points, AbortSignal
    unregistration, declarative forms, cross-origin)
  - **Six browser traps we hit for real** — e.g. the browser does *not* validate arguments
    against your `inputSchema`; Chrome 151 has no `unregisterTool`; ChatGPT and Chrome expose
    *different* entry points
  - **Five structural guardrails**: the write red-line in the registry (dangerous tools simply
    don't exist), central validation + `{ok:false, error:{code}, hint}` refusals, a quarantine
    fence for prompt injection in third-party text, idempotent submission with replay,
    and live schemas as boundaries (out-of-range requests become unrepresentable)
  - Human-approval gating, agent-flow details (orientation tool, next-step hints,
    ambiguity candidates), and testing recipes down to CI-grade evidence
- **[`references/templates/`](./skills/webmcp-integration/references/templates/)** — four
  framework-free TypeScript starting points (MIT): `model-context.ts` (dual entry point +
  contract-fingerprint sync), `tool-wrapper.ts` (central guardrail layer + approval gate),
  `validate.ts` (in-handler schema validation), `quarantine.ts` (untrusted-text fence).

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
