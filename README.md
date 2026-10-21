# <img src="shared/logo.svg" alt="B9" height="34"> &nbsp;B9 — AI red-teaming toolkit

B9 is an **offline, build-free** collection of helper tools for authorized AI red-teaming
on Gray Swan Arena. Everything runs locally in the browser from `file://` — no backend,
no network of any kind, no auto-submission. The tools help you craft and bookkeep
*variations of text you write*; you paste each one into Arena manually, by design.

> Scope & safety: B9 never contacts any website, never auto-submits, and never guesses
> model identities (Arena Rules 3 & 4). It is content-neutral — it transforms text the
> user supplies and cannot manufacture harmful substance.

## Tools

| # | Tool | Scheme | What it does |
|---|------|--------|--------------|
| 01 | **Salvo** | `SALVO://variant-lab` | Best-of-N variant generator + attempt tracker. Fires many small, seeded perturbations of a base payload (11 strategies) and tracks the per-variant hit rate. |
| 02 | **Facet** | `FACET://lab` | Technique-level reframing. Re-expresses your own benign payload along 4 neutral linguistic axes (verb/term, register, mood, abstraction) to map which wording a model reacts to. |
| — | **Recon** | `RECON://scope` | Target-fingerprint worksheet (identity, system prompt, guardrail topology, capabilities, obfuscation channels) with a live decision-tree "opening move" and a refusal taxonomy. |
| — | **Codec** | `CODEC://bench` | Reversible encode/decode workbench (Base64, hex, binary, URL, ROT13, Caesar, Atbash, reverse, Morse, NATO, leet) with a round-trip self-test, plus a defensive hidden-Unicode inspector (detect/strip zero-width, bidi, Tags-block, homoglyph carriers). |
| — | **Sieve** | `SIEVE://oracle` | Client-side oracle tracker for authorized extraction of a benign lab secret: log closed-ended answers, reconstruct the value in a position table, stop on validate. |
| — | **Dossier** | `DOSSIER://report` | Disclosure report builder (OWASP LLM07 / MITRE ATLAS): steps, impact, negative results, valid-finding gates. Imports a Salvo/Facet JSON export as evidence. |

**Pipeline:** Facet (find the axis/wording that works) → copy the winning framing
into Salvo as a new base → Best-of-N to raise the hit rate. Both keep submission manual.

## Structure

```
B9/
  index.html              # platform hub / launcher
  shared/
    theme.css             # shared "Carbon" design system (single source of truth)
    core.js               # tracker engine: 3-pane shell, variant queue, stats, export/import,
                          #   seeded PRNG, word-level diff, clipboard, keyboard loop, storage
    kit.js                # lightweight plumbing for the standalone workbench tools
  tools/
    salvo/index.html      # Tool 01 — strategies + generate()        (core.js)
    facet/index.html      # Tool 02 — axes + neutral lexicon + transform()  (core.js)
    recon/index.html      # Workbench — target-fingerprint worksheet + decision tree  (kit.js)
    codec/index.html      # Workbench — reversible codecs + hidden-Unicode inspector  (kit.js)
    sieve/index.html      # Workbench — client-side oracle tracker     (kit.js)
    dossier/index.html    # Workbench — OWASP LLM07 disclosure builder  (kit.js)
  theme-lab.html          # dev-only: live preview of candidate themes (not part of a tool)
```

Each tool is a thin page that provides only its unique setup pane and generation logic;
it calls `B9.mountTool(spec)` from `shared/core.js`, which builds the identical shell and
owns all shared behavior. Result vocabulary (`success / partial / refused / flagged / fail`)
and the per-strategy / per-axis aggregation are shared so reports from both tools compare.

## Usage

Open `index.html` in any modern browser (works straight from `file://`, offline).
Pick a tool, write a base payload, generate variants, then run the keyboard loop:

- `c` copy current variant · `1`–`4` / `0` log result · `j` / `k` move · `?` help

All data is stored in `localStorage` (per-tool key, wrapped in try/catch — private-window
safe). Export a Markdown field report or a full JSON backup from the top bar.

## Hard invariants (every tool)

- No `fetch` / `XMLHttpRequest` / `WebSocket` / CDN / external anything.
- No auto-submission, no browser automation, no model-identity guessing.
- `localStorage`-only persistence, try/catch-wrapped; in-memory fallback + banner on failure.
- Deterministic generation: same `(base + options + seed)` → identical batch; variant #1
  is always the untouched base (control).

## Dev notes

- No build step. Edit the files and reload.
- `theme.css` is the single source of truth for the look; changing it restyles every tool.
- `theme-lab.html` is a local-only theme picker; it is not loaded by any tool.
