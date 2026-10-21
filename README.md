# <img src="shared/logo.svg" alt="B9" height="70" align="middle"> &nbsp;B9 — AI red-teaming Swiss knife

> Six offline tools to **map, break, and report** how an LLM fails — without a single network request.

![offline](https://img.shields.io/badge/offline-file%3A%2F%2F-2b7a4b?style=flat-square)
![dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)
![stack](https://img.shields.io/badge/stack-vanilla_JS-b23a3a?style=flat-square)
![tests](https://img.shields.io/badge/tests-49_passing-2b7a4b?style=flat-square)
![tools](https://img.shields.io/badge/tools-7-7a4a8c?style=flat-square)

![B9 workflow](docs/overview.svg)

**B9** is a browser-based Swiss knife for **authorized** AI red-teaming (Gray Swan Arena, HTB labs, in-scope bounties). It runs entirely from `file://` — no backend, no build step, no dependencies — and **nothing ever leaves your machine**. You write the payloads; B9 makes the manual loop fast, reproducible, and reportable: it generates variations, tracks what lands, maps the model's defenses, and drafts the disclosure. Submission stays manual, by design.

In one line: **the bookkeeping-and-methodology layer around manual red-teaming.** The attack text is yours — B9 gives it reach, memory, and a paper trail.

---

## The tools

| Step | Tool | Scheme | What it does |
|:---:|------|--------|--------------|
| ① | **Recon** | `RECON://scope` | Fingerprint the target's defense stack — identity, system prompt, guardrail topology, capabilities, obfuscation channels — and get a **live decision-tree opening move**. The recon worksheet, turned into a plan. |
| ② | **Facet** | `FACET://lab` | Re-express your own benign payload along four neutral linguistic axes (verb/term · register · mood · abstraction) to **map which wording a model reacts to**. Transform-only; a neutral lexicon is the safety boundary. |
| ③ | **Salvo** | `SALVO://variant-lab` | **Best-of-N.** Fire many small, *seeded* perturbations of a base payload (11 strategies) and track the per-variant hit rate to catch the low-probability success. |
| ④ | **Dossier** | `DOSSIER://report` | Turn logged attempts into a **submission-ready disclosure** (OWASP LLM07 / MITRE ATLAS): steps, impact, negative results, and the valid-finding gates checklist. Imports a Salvo/Facet export as evidence. |
| ◇ | **Codec** | `CODEC://bench` | Reversible encode/decode bench (Base64, hex, binary, URL, ROT13, Caesar, Atbash, reverse, Morse, NATO, leet) with a round-trip self-test — plus a **defensive hidden-Unicode inspector** that detects & strips zero-width / bidi / Tags-block / homoglyph carriers from untrusted text. |
| ◇ | **Sieve** | `SIEVE://oracle` | Client-side **oracle tracker** for authorized extraction of a benign lab secret: log closed-ended answers (boolean / range / code-point), reconstruct the value in a position table, and **stop the moment it validates**. |
| ◇ | **Ledger** | `LEDGER://campaign` | **Cross-tool campaign dashboard.** Import Salvo/Facet exports and aggregate ASR by **MLCommons family** and class across targets — with a 95% lower bound, a best-of-N estimate, and a "3 refusals → rotate the class" signal. |

**The loop:** `Recon` maps the defenses → `Facet` finds the framing that works → `Salvo` perturbs it Best-of-N to raise the hit rate → `Dossier` writes it up. `Codec` and `Sieve` are the workbench you reach for mid-hunt.

---

## Why it's built this way

- **100% offline.** No `fetch`, `XMLHttpRequest`, `WebSocket`, CDN, font, or analytics — anywhere. Open `index.html` with the network cable unplugged and everything works. (CI even fails the build if a network reference sneaks in.)
- **Zero dependencies, zero build.** Plain HTML + vanilla JS + one CSS file. Edit a file, reload. Nothing to install.
- **Deterministic.** Generation is seeded: the same `(base + options + seed)` always produces the identical batch, and variant #1 is always the untouched control.
- **One system.** Every tool shares the **Carbon** theme; the trackers share one engine (`core.js`), the workbench tools share one helper lib (`kit.js`). Flip between tools and it's the same keyboard loop, the same stats, the same exports.
- **Private by construction.** All state is `localStorage` only (try/catch-wrapped, private-window safe). Reports export as Markdown or JSON from the top bar.

---

## Quick start

```bash
git clone https://github.com/k074m4n/B9.git
cd B9
# open the hub in a browser — no server needed:
xdg-open index.html     # Linux   (or: open index.html on macOS)
```

Pick a tool, write a base payload, hit **Generate**, then run the keyboard loop (trackers):

| key | action | | key | action |
|:---:|--------|---|:---:|--------|
| `c` | copy current variant | | `j` / `k` | next / previous |
| `1`–`4`, `0` | log result | | `u` | undo last log |
| | | | `?` | shortcuts help |

Copy → paste into the Arena chat yourself → log the result → repeat. Pane C updates live with the success rate, the per-strategy / per-family (MLCommons) breakdown, and a best-of-N estimate.

---

## Testing

A dependency-free Node suite drives the real tools through a hand-rolled DOM — mount, generate, log, undo, persist, reload, export, import, keyboard loop, theme sync, and every workbench tool's pure logic:

```bash
npm test     # → 49 checks, 0 deps
```

---

## Project layout

```
B9/
├─ index.html              # platform hub / launcher
├─ shared/
│  ├─ theme.css            # "Carbon" design system — single source of truth
│  ├─ core.js              # tracker engine: 3-pane shell · variant queue · stats ·
│  │                       #   export/import · seeded PRNG · word diff · keyboard loop
│  ├─ kit.js               # lightweight plumbing for the workbench tools
│  ├─ icons.js             # inline SVG glyphs + the interlocking B9 logo
│  └─ logo.svg             # standalone brand mark
├─ tools/
│  ├─ salvo/   facet/      # trackers  (core.js) — Best-of-N · reframing
│  ├─ recon/   dossier/    # workbench (kit.js)  — target worksheet · report builder
│  ├─ codec/   sieve/      # workbench (kit.js)  — codecs/inspector · oracle tracker
│  └─ ledger/              # workbench (kit.js)  — cross-tool campaign ASR dashboard
├─ test/                   # minidom.js + run.js — the 49-check suite
└─ .github/workflows/      # CI: npm test + the no-network assertion
```

Each tool is a thin page: the trackers hand a small spec to `B9.mountTool()` and the engine builds the identical shell; the workbench tools wire their own UI over `kit.js`. The shared result vocabulary (`success / partial / refused / flagged / fail`) and taxonomy rollups mean reports from different tools line up.

---

## Scope & safety

> B9 is for **authorized testing only** — sanctioned engagements, CTF/lab targets, your own systems.

- It **never contacts any website**, never auto-submits, and never tries to de-anonymize a model (Arena Rules 3 & 4). The tool's job ends at *"here is text to copy."*
- Findings are framed for **responsible disclosure** (OWASP LLM07 / MITRE ATLAS), negative results included.

---

<sub>Built as a portfolio project. Design system: **Carbon** (ink & paper, matte). Status: active — more tools and polish landing on `main`.</sub>
