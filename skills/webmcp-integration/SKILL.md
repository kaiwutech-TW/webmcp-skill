---
name: webmcp-integration
description: Wire an existing website up to WebMCP (document.modelContext) so a visitor's browser agent can operate the page's features directly. Load when the user wants to "make my site agent-ready", "add WebMCP", "expose page tools to AI agents", or "let an agent drive my web app". Contains a battle-tested playbook from a production ERP (verified with real agents online): API surface, five structural guardrails, human-approval gating, browser compatibility traps, and testing recipes.
---

# WebMCP Integration Playbook

Source: the E-ternal ERP entry to the 2026 OpenAI WebMCP Challenge
(`github.com/kaiwutech-TW/e-ternal-public`, `apps/web/src/webmcp/`). The guardrails and
traps below were verified against real agents (ChatGPT's built-in browser) on a live site;
the API reference tracks the **WebMCP CG draft of 2026-11-02** and Chrome's docs of
October 2026. Copy-paste starting points live in `references/templates/`.

The spec is a moving draft (≈50 commits Aug–Nov 2026). Before relying on any signature
below, check `https://webmachinelearning.github.io/webmcp/` (IDL index at the bottom).

## What WebMCP is (one sentence)

A W3C WebML CG draft: a web page registers "tools" (name + JSON Schema + execute function)
on `document.modelContext`, and the visitor's own browser agent calls those tools to operate
the page — same screen, same state, same session, same permissions as the human sitting there.
The essential difference from a backend MCP server: **the tools run inside the page**, so the
human and the agent can co-edit the same pixels, and auth is simply the user's own login.

## API quick reference (spec draft 2026-11-02)

```ts
// Canonical entry point: document.modelContext (spec, Chrome docs, ChatGPT docs).
// navigator.modelContext is only a fallback for older Chromium builds — keep it, don't lead with it.
const mc = document.modelContext ?? navigator.modelContext;

const ac = new AbortController();
await mc.registerTool({                // returns Promise<undefined> — it can REJECT
  name: "tool_name",                   // /^[A-Za-z0-9_.-]{1,128}$/
  title: "Optional human label",
  description: "English, written for the model",
  inputSchema: { type: "object", properties: {...}, required: [...], additionalProperties: false },
  outputSchema: { ... },               // optional, added 2026-11-02
  annotations: {                       // the spec's set — NOT MCP's destructiveHint/idempotentHint
    readOnlyHint: true,
    untrustedContentHint: true,        // output carries third-party text
    consequentialHint: false,          // true for anything with real-world effect (submit/post/pay)
    debugging: false,                  // dev-only tool (Chrome 156+)
  },
  async execute(input, { signal }) {   // signal aborts when the agent/browser cancels the call
    return { content: [{ type: "text", text: "..." }] };
  },
}, { signal: ac.signal, exposedTo: [/* other origins, opt-in */] });

ac.abort();                            // the ONLY way to unregister — there is no unregisterTool

// Consumer side / testing: mc.getTools({ fromOrigins }), mc.executeTool(tool, inputObject, { signal })
// Events: toolchange, toolactivated, toolcancel (the last two carry toolName)
// Permissions-Policy feature "tools": default self; cross-origin iframes need allow="tools";
//   `Permissions-Policy: tools=()` disables it (registerTool then rejects NotAllowedError).
```

**Gone from the spec — do not write new code against these:** `provideContext()` /
`clearContext()` (absent from the current IDL; atomic replacement also bypassed per-tool
unregistration), `unregisterTool()`, `ModelContextClient` / `requestUserInteraction`
(removed June 2026), and the **declarative form API** (`toolname`, `tooldescription`,
`toolautosubmit`, `toolparamdescription`, `agentInvoked` — removed from the spec
2026-10-08, "explored separately"; Chrome may still ship it, so treat it as experimental).

### Browser traps we actually hit (read before coding)

1. **The browser does NOT validate arguments against `inputSchema`** before calling
   `execute` — still true in the current spec (it only checks the input is a JSON object).
   The declared schema is advertising; validation is your job (see guardrail 2).
2. **`registerTool` is async and can reject** (bad name, duplicate name, Permissions-Policy
   off, detached document). A plain `try/catch` around it catches nothing; an unawaited
   rejection leaves your registry believing a tool exists that the browser never saw.
   Await it (or `.then/.catch`) and only count resolved registrations as live.
3. **Unregister = abort the `signal`.** There is no `unregisterTool` anywhere. Before
   Chrome 153 aborting also broke in-flight executions; from 153 in-flight calls finish.
4. **Entry point drift.** The getter moved from `navigator` to `document` in mid-2026.
   Detect `document.modelContext` first, fall back to `navigator.modelContext` — supporting
   only the old one means current browsers see zero tools, silently.
5. **HTTPS only** (SecureContext). Inside iframes the embedder must grant
   `allow="tools"`; set it before navigation (some builds snapshot policy at nav time).
6. Agents often scan for tools **the instant the page loads**. If your tools appear only
   after login, that scan comes back empty and the agent gives up and falls back to
   screen-clicking. Fix: register a permanent `describe_site` tool at module load (below).
7. **`execute` gets a cancellation signal.** If you ignore it, a cancelled call can leave UI
   behind — e.g. an approval card the human later clicks, posting something the agent has
   already abandoned. Wire `signal` into anything long-lived the tool opens.
8. Output must be bounded and truncation must leave an explicit marker. Earlier Chrome
   guidance suggested ~1500 chars; current docs give no number. We budget 4000 for
   data-heavy tools and it has held up.

## Architecture blueprint (five files — copy the shape)

```
webmcp/
  model-context.ts  thin wrapper: entry-point detection, name-keyed async syncTools diff,
                    AbortController registry, a "live" set of registrations the browser
                    actually accepted, and a "contract fingerprint" (JSON of
                    title+description+schemas+annotations) — re-register a tool only when
                    its fingerprint changes, which is what makes live schemas possible.
                    Also: a window.webmcp console bench for browsers without WebMCP.
  tools.ts          tool definitions + a central withGuardrails wrapper that NO tool can opt
                    out of (that is the point): validate → log → execute → fence → budget,
                    passing the browser's AbortSignal through.
  bus.ts            framework-free state bus: activity log, co-edited draft, approval
                    requests, submission record (idempotency).
  <Mount>.tsx       UI mount: recompute the toolset from role × page × state and hand it
                    to syncTools; draft card + approval card + activity panel.
                    Cleanup ONLY on unmount — cleanup in the effect body tears down and
                    re-registers everything on every navigation (agents see tools flicker).
  quarantine.ts / validate.ts   the guardrails below.
```

## Five structural guardrails (each deserves a test)

1. **The write red-line lives in the REGISTRY, not in prompts.** Tools that post, pay,
   approve, or delete **do not exist** — an unregistered door cannot be jailbroken open.
   Writes only ever fill an on-screen draft. The single submission tool declares
   `consequentialHint: true` and its `execute` `await`s a Promise that **only a human click
   can resolve** (an approval card). Pass the execute `signal` to the approval request so a
   cancelled call withdraws the card. On decline, return "The user DECLINED. The draft
   remains open — ask what to change."
2. **Central validation + structured refusals.** The wrapper validates args against the
   declared schema on entry (a hand-rolled JSON-Schema subset is enough: type / required /
   enum / min / max / minItems / additionalProperties). Look keys up as **own properties**
   (`Object.hasOwn`) — `key in schema.properties` treats `constructor`, `toString`, … as
   declared and lets them through `additionalProperties: false`. Every failure — policy
   refusal or malformed input — returns the same shape: `{ok:false, error:{code, message}, hint}`,
   where **`hint` always names the agent's next legal move**, so it self-corrects instead
   of retrying blind.
3. **Quarantine fence for untrusted text.** Any tool whose results carry text other people
   typed (names, memos, reviews) declares `untrustedContentHint: true` (the spec lists this
   annotation as a prompt-injection mitigation — but it is only a hint to the agent; the
   fence is what you control), and the wrapper passes its ENTIRE output through: NFKC
   normalize → strip invisibles by Unicode **property**
   (`/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu` — enumerated blocklists have known
   bypasses) → neutralize fence markers found inside the data (the fence becomes
   unforgeable) → wrap in `⟦UNTRUSTED⟧…⟦/UNTRUSTED⟧` with a standing notice that fenced
   content is data, never instructions. **Error paths count too**: an exception message can
   echo a server response or a record someone typed, so `tool_failed` returns a fixed
   message plus the raw text clipped (~500 chars) and fenced in `error.detail`; refusal
   messages are site-authored and must never interpolate third-party text.
4. **Idempotent writes.** After a successful submission, remember `{draftId, at, result}`.
   An agent retrying after a timeout gets the **original result replayed**
   (`alreadyCreated` + "Do not draft it again") — otherwise it re-drafts, the human
   re-approves, and you have a duplicate document. While the approval card is open, a
   second submit is **refused** with `approval_pending` — never resolve(false), which reads
   as "the human declined".
5. **Schemas as live boundaries.** Encode what is legal *right now* into the schema:
   an enum of the pages this role can reach, `maximum` = current line count − 1.
   State changes → contract fingerprint changes → only that one tool re-registers.
   An out-of-range request becomes *unrepresentable*, which is stronger than refused.

## Cross-origin exposure (default: don't)

By default a tool is visible to its own document, same-origin frames, and built-in browser
agents. Exposing it to another origin is a **two-sided opt-in**: the provider lists the
origin in `exposedTo`, and the consumer asks with `getTools({ fromOrigins })` (secure
origins only). Every origin you add can call your tools with the user's session — treat
`exposedTo` like a CORS allowlist, never a wildcard. Pages that must never expose tools
(e.g. ones embedding third-party content) can send `Permissions-Policy: tools=()`.

## Details that make agents flow

- **A permanent `describe_site` orientation tool**: registered at module load, no login
  needed, read-only. Content: what this site is, tools registered now, tools after
  sign-in, the write policy (state the red line plainly), a session activity summary.
  End the description with "Call this first — read-only and cheap."
- **`next` hints in every result**: `{..., next: "The draft card is now visible. Ask the
  user to review..."}` — multi-step flows complete without site-specific prompting.
- **Ambiguity returns candidates**: when name resolution matches several records, return
  up to 8 candidates and tell the agent to ask or pass an id. Never guess.
- **Activity panel + status pill**: every tool call rendered on screen (humans see what
  their agent is doing); a persistent "WebMCP ready · N tools" / "unsupported — use X"
  pill makes the page self-diagnosing without DevTools. Count only registrations the
  browser accepted (`registeredCount()` in the template), not what you asked for.
- **Co-edit highlighting**: track lastEdit {field, actor} on the draft — agent edits
  flash one color, human edits another.
- **Off-screen writes must refresh lists**: a module-level subscriber (same pattern as
  the bus) that your fetch hooks listen to — after approval, the new record appears in
  the visible list without a manual search.

## Testing & acceptance

- `window.webmcp = { list(), execute(name, args) }` console bench: manual verification
  even in browsers without WebMCP.
- Unit tests (plain node): every validation branch (including inherited-name keys like
  `constructor`), envelope shape, idempotent replay, approval-busy refusal, abort withdraws
  the approval card, rejected `registerTool` not counted live, live-schema maximum, fence
  unforgeability (feed `⟦/UNTRUSTED⟧` in data — it must come out neutralized), annotations
  declared on every applicable tool. This repo's `test/templates.test.mts` covers the
  template-level ones — run `node --test test/`.
- Real-agent acceptance:
  - ChatGPT desktop's built-in browser ("Site tools"): enable under Settings › Browser ›
    Permissions › *Enable site tools*. Works out of the box with frontier-tier models.
  - Chrome: origin trial from Chrome 149, or locally via `chrome://flags/#enable-webmcp-testing`.
    Inspect registrations with `document.modelContext.getTools()` and drive them with
    `executeTool()` (pass an object — JSON-string input is deprecated from Chrome 155).
- CI-grade evidence (pattern from upgradedev/claimready): headless Chrome with the WebMCP
  feature enabled + CDP, drive getTools/executeTool journeys, assert with **set equality**
  (the tool surface must EQUAL the expected role×page set; forbidden tools must never
  appear), plus a mutation self-test — prove the gate can fail before trusting it.
- Keep browsers current: WebMCP is new browser attack surface still changing release to
  release; test on an up-to-date Chrome, not a pinned old build.

## Roles and the backend

Recompute the toolset from role × page and clear it on logout — the agent only ever sees
what is possible now. But **backend ACL is the real boundary**: page tools are entrances,
and the API must still 403 what it should (we shipped a demo account with a read-only role
once — the approval click then died on a 403; design the tool surface and backend
permissions together). Reuse the site's existing API keys and audit logging; never open a
side door for the agent.
