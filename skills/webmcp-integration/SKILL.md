---
name: webmcp-integration
description: Wire an existing website up to WebMCP (navigator/document.modelContext) so a visitor's browser agent can operate the page's features directly. Load when the user wants to "make my site agent-ready", "add WebMCP", "expose page tools to AI agents", or "let an agent drive my web app". Contains a battle-tested playbook from a production ERP (verified with real agents online): API surface, five structural guardrails, human-approval gating, browser compatibility traps, and testing recipes.
---

# WebMCP Integration Playbook

Source: the E-ternal ERP entry to the 2026 OpenAI WebMCP Challenge
(`github.com/kaiwutech-TW/e-ternal-public`, `apps/web/src/webmcp/`). Everything below was
verified against real agents (ChatGPT's built-in browser) on a live site; every "trap" was
actually hit. Copy-paste starting points live in `references/templates/`.

## What WebMCP is (one sentence)

A W3C WebML CG draft: a web page registers "tools" (name + JSON Schema + execute function)
on `modelContext`, and the visitor's own browser agent calls those tools to operate the page —
same screen, same state, same session, same permissions as the human sitting there.
The essential difference from a backend MCP server: **the tools run inside the page**, so the
human and the agent can co-edit the same pixels, and auth is simply the user's own login.

## API quick reference (as of late 2026 — reality, not just spec)

```ts
// TWO entry points exist in the wild — support both:
// - ChatGPT desktop's built-in browser: document.modelContext (OpenAI docs' form)
// - Chrome 146+ behind the WebMCP flag:  navigator.modelContext
const mc = document.modelContext ?? navigator.modelContext;

mc.registerTool({
  name: "tool_name",            // /^[A-Za-z0-9_.-]{1,128}$/
  description: "English, written for the model",
  inputSchema: { type: "object", properties: {...}, required: [...], additionalProperties: false },
  annotations: { readOnlyHint: true, untrustedContentHint: true },  // declare honestly
  async execute(args) { return { content: [{ type: "text", text: "..." }] }; },
}, { signal: abortController.signal });   // abort == unregister (the only reliable path)

mc.provideContext({ tools });   // atomic full replacement (prefer when available)
// Events: mc.addEventListener("toolchange", ...) ; cross-origin: getTools({fromOrigins}),
// registerTool option `exposedTo`; iframes need allow="tools <origin>" set BEFORE navigation.
// Declarative forms: <form toolname tooldescription toolautosubmit> + per-control
// toolparamdescription; the submit handler reads event.agentInvoked to tell human from agent.
```

### Browser traps we actually hit (read before coding)

1. **The browser does NOT validate arguments against `inputSchema`** before calling
   `execute`. The declared schema is advertising; validation is your job (see guardrail 2).
2. **Chrome 151 has no `unregisterTool`.** Register with `{ signal }` and abort to unregister.
3. ChatGPT exposes `document.modelContext`, Chrome exposes `navigator.modelContext` —
   support only one and the other side sees zero tools, forever, silently.
4. **HTTPS only** (SecureContext). Inside iframes the embedder must set
   `allow="tools <origin>"` before navigation (some builds snapshot policy at nav time).
5. Agents often scan for tools **the instant the page loads**. If your tools appear only
   after login, that scan comes back empty and the agent gives up and falls back to
   screen-clicking. Fix: register a permanent `describe_site` tool at module load (below).
6. Tool output guidance is ~1500 chars (Chrome). Data-heavy sites can stretch to ~4000,
   but output must be bounded and truncation must leave an explicit marker.

## Architecture blueprint (five files — copy the shape)

```
webmcp/
  model-context.ts  thin wrapper: dual entry-point detection, name-keyed syncTools diff,
                    AbortController registry, and a "contract fingerprint"
                    (JSON of description+schema+annotations) — re-register a tool only when
                    its fingerprint changes, which is what makes live schemas possible.
                    Also: a window.webmcp console bench for browsers without WebMCP.
  tools.ts          tool definitions + a central withLog wrapper that NO tool can opt out
                    of (that is the point): validate → log → execute → fence → budget.
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
   Writes only ever fill an on-screen draft. The single submission tool's `execute`
   `await`s a Promise that **only a human click can resolve** (an approval card).
   On decline, return "The user DECLINED. The draft remains open — ask what to change."
2. **Central validation + structured refusals.** The wrapper validates args against the
   declared schema on entry (a hand-rolled JSON-Schema subset is enough: type / required /
   enum / min / max / minItems / additionalProperties). Every failure — policy refusal or
   malformed input — returns the same shape: `{ok:false, error:{code, message}, hint}`,
   where **`hint` always names the agent's next legal move**, so it self-corrects instead
   of retrying blind.
3. **Quarantine fence for untrusted text.** Any tool whose results carry text other people
   typed (names, memos, reviews) declares `untrustedContentHint: true`, and the wrapper
   passes its ENTIRE output through: NFKC normalize → strip invisibles by Unicode
   **property** (`/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu` — enumerated
   blocklists have known bypasses) → neutralize fence markers found inside the data (the
   fence becomes unforgeable) → wrap in `⟦UNTRUSTED⟧…⟦/UNTRUSTED⟧` with a standing notice
   that fenced content is data, never instructions.
4. **Idempotent writes.** After a successful submission, remember `{draftId, at, result}`.
   An agent retrying after a timeout gets the **original result replayed**
   (`alreadyCreated` + "Do not draft it again") — otherwise it re-drafts, the human
   re-approves, and you have a duplicate document. While the approval card is open, a
   second submit returns `approval_pending` — never resolve(false), which reads as
   "the human declined".
5. **Schemas as live boundaries.** Encode what is legal *right now* into the schema:
   an enum of the pages this role can reach, `maximum` = current line count − 1.
   State changes → contract fingerprint changes → only that one tool re-registers.
   An out-of-range request becomes *unrepresentable*, which is stronger than refused.

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
  pill makes the page self-diagnosing without DevTools.
- **Co-edit highlighting**: track lastEdit {field, actor} on the draft — agent edits
  flash one color, human edits another.
- **Off-screen writes must refresh lists**: a module-level subscriber (same pattern as
  the bus) that your fetch hooks listen to — after approval, the new record appears in
  the visible list without a manual search.

## Testing & acceptance

- `window.webmcp = { list(), execute(name, args) }` console bench: manual verification
  even in browsers without WebMCP.
- Unit tests (plain node): every validation branch, envelope shape, idempotent replay,
  approval-busy, live-schema maximum, fence unforgeability (feed `⟦/UNTRUSTED⟧` in data —
  it must come out neutralized), annotations declared on every applicable tool.
- Real-agent acceptance: ChatGPT desktop's built-in browser works out of the box
  (frontier-tier models); Chrome 146+ with the WebMCP flag. Chrome exposes
  `navigator.modelContextTesting.listTools()` for inspecting registrations.
- CI-grade evidence (pattern from upgradedev/claimready): headless Chrome with
  `--enable-features=WebMCP` + CDP, drive getTools/executeTool journeys, assert with
  **set equality** (the tool surface must EQUAL the expected role×page set; forbidden
  tools must never appear), plus a mutation self-test — prove the gate can fail before
  trusting it.

## Roles and the backend

Recompute the toolset from role × page and clear it on logout — the agent only ever sees
what is possible now. But **backend ACL is the real boundary**: page tools are entrances,
and the API must still 403 what it should (we shipped a demo account with a read-only role
once — the approval click then died on a 403; design the tool surface and backend
permissions together). Reuse the site's existing API keys and audit logging; never open a
side door for the agent.
