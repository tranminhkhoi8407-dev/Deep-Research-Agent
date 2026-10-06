# Evidence-first research v3 — explanatory reports and LaTeX/PDF

Product REST/WebSocket APIs now use agent.deep_research, a LangGraph flow:

Brief → shared document retrieval → question coverage → bounded read/search
follow-ups → targeted explanatory writing → quote/numeric validation →
semantic support + written-report quality review → one budgeted repair →
optional editorial review → structured report → editable LaTeX / compiled PDF.

Markdown remains an internal backward-compatible storage projection, not the
default user download format. Old reports are not silently rewritten.

The original agent.graph interview graph remains available for existing CLI
and LangGraph Studio callers. It is not the product API default.

## Contract and language

- report_language: auto, vi, or en, independent of interface language.
- Explicit prompt language wins in Auto. Conflicting language selections return
  a preflight error, before research spending.
- Read/search language directives are separate from answer language, including
  mixed prompts such as reading English sources and answering in Vietnamese.
  Language preflight is a bounded heuristic, not a universal language parser.
- analysis_mode: research or paper. Paper mode requires paper_input or an
  owner-scoped document_id. Deployment requests get a technical-guide intent.
- topic is optional in paper mode (omitted, empty or whitespace). A blank prompt
  becomes a general discipline-specific analysis of the selected paper: problem,
  contributions, methods/equations, results, limitations and reproducibility.
  Nonempty prompts, including short ones, narrow that focus. Research mode still
  requires at least eight characters. Paper Auto without a prompt uses the saved
  preferred_report_language (Vietnamese by default). An explicit vi/en report
  selection is respected independently of UI language. PDF title language never
  overrides that preference. Blank-prompt language/field are shown before launch.
- Preserve arXiv versions. DOI redirects do not grant full-text access.
  Publisher landing/abstract pages are labeled preliminary.
- If the primary paper cannot be read at all, analysis is unavailable rather
  than mislabeled abstract analysis. Related papers cannot substitute for it.
- Field guidance covers mathematics, physics, chemistry, biology and AI.
  This release is validated for Vietnamese/English, not arbitrary languages.

## Bounds and accounting

| Profile | Search calls | Document attempts | Coverage rounds | Model calls |
| --- | ---: | ---: | ---: | ---: |
| Quick | 2 | 3 | 1 | 4 |
| Standard | 6 | 8 | 2 | 6 |
| Deep | 10 | 12 | 3 | 8 |

Input/output token ceilings: Quick 18,000/8,000; Standard 60,000/24,000;
Deep 100,000/30,000. These are limits, not promises to spend them all or a price
quote. report_detail is independent: concise targets 500–1,000 whitespace word
units, detailed 1,500–2,500, extended 3,000–5,000 in retained analysis prose.
Bibliography/quote appendices never inflate the length metric. Quick is not a
guarantee of extended output. Evidence and available budget take precedence.

Request budget fields override profile limits within schema caps. Counters
include failed attempts; model construction disables retries. Follow-ups
reserve writing/checking room and prefer unread chunks in the same paper before
new search calls. Shared retrieval does not multiply costs by analyst personas.
Cache hits skip download/extraction, not analysis.
Reading-packet intake also adapts to remaining estimated input, reserving space
for coverage, writing and support review rather than spending it all on the
first reading. Retrieval order is preserved; small custom budgets can still
fail explicitly at a hard call/input/output/time boundary.
For non-time-sensitive research, a bounded, owner-scoped lexical lookup seeds
the initial reading from public-URL cache entries before web discovery. Missing
coverage falls back to search. Uploaded private PDFs are never silently reused
for another brief. This is not a cross-language semantic index; that remains a
future retrieval upgrade. Latest/current/price queries still perform discovery.

Input accounting is a conservative UTF-8 proxy, not tokenizer-specific billing.
Output is capped per call; provider usage metadata is recorded when available.
Limits are checked between operations. Network/model operations have timeouts;
this is not a hard real-time process-kill guarantee.

## Evidence and storage

- PDF bounds: 20 MB, 100 pages, 160,000 extracted characters per document.
- Public HTTP(S) only, standard ports, no URL credentials. All DNS answers must
  be global. Connect to the validated IP, retaining Host/TLS SNI. Validate
  redirects. No environment proxy, cookies or paywall bypass.
- Check robots.txt; unknown access policy fails closed.
- Remove HTML navigation/scripts; preserve line breaks and code.
- Owner-scoped SQLite cache and PDF originals under RESEARCH_DATA_DIR
  (default data/research). Latest pages expire after an hour; explicit
  versioned arXiv documents after 30 days.
- Uploaded PDFs are never sent to arXivisual. Selected excerpts are sent to
  the configured LLM provider, as disclosed in the UI.
- Page locators/web text offsets accompany chunk IDs. Text extraction does
  NOT guarantee table/formula/figure accuracy; OCR is not implemented.

Quotes must match an actual selected chunk. Reported numerals must appear in
the same cited original chunk (a short navigation quote can omit an adjacent
table value). A separate model checks identity, assertion and conditions;
unsupported/partial/omitted verdicts are removed. Model checking is not
independent scientific verification. If unavailable, quote-matched claims are
marked provisional, not successfully audited.

Six deterministic sections are emitted; insufficient evidence leaves sections
empty. Counts distinguish discovered URLs, sources with excerpts read, and
sources used in retained claims. Search snippets never substitute for full text.
Failed/unused sources stay in the ledger, not the bibliography. Reports save a
  .research.json sidecar so interactive provenance survives reload; older Markdown
reports remain readable.

## Provider compatibility and truthful outcomes (v2.1)

- Gemini receives a compact native JSON schema: shape, required properties,
  references and enum values are retained; verbose metadata and nested bounds
  are enforced locally by the original Pydantic contracts. Large constrained
  schemas can be rejected by the provider before generation.
- A malformed independent claim/quote/verdict is dropped without discarding
  other valid entries. No quote is fabricated/shortened and no failed verdict
  is changed to supported. Root-shape failures remain explicit errors.
- Reading packets for native Gemini/OpenAI/Groq outputs annotate contiguous
  original spans once, without sending a second copy as a quote catalog. The
  model selects quote IDs; the application resolves them to original text and
  chunk locators, then validates the unchanged Proof contract. The native schema
  enumerates the available IDs and caps proof count. Unknown IDs are
  dropped, never guessed. Token estimates include annotation overhead. This
  prevents free-written/paraphrased quotations, but does not establish semantic
  support: the separate claim audit remains mandatory for completed reports.
- Complete HTML entities in model prose can be decoded before strict validation;
  chunk identifiers are unchanged. Quotes still must match selected source text.

### Explanatory writing (v3)

Native Gemini/OpenAI/Groq writers use fluent Unicode prose inside a small
section/claim envelope rather than constraining every long paragraph inside a
deep JSON decoder. Each claim names 1–16 EXISTING short quote-span IDs (prefer
the smallest sufficient set). A local parser
resolves the exact original spans and applies the same Pydantic, substring,
numeric, URL and semantic-audit contracts. Unknown IDs are rejected, not guessed.
Brackets around an exact ID are harmless formatting; missing/altered IDs are not.
Non-native test adapters retain structured output. Usage is counted even when
the envelope is malformed. One bad independent part does not erase later parts.

Detailed writing is split into 2–4 targeted parts as remaining model calls allow:
overview/scope, methods, results, criticism/reproduction. Parts share the reading
store. Actual section headings and overview captions outrank repeated generic
words; topic categories protect training, inference, equations, setup and
ablation. This remains heuristic PDF TEXT reading, not verified visual parsing
of every figure/table/formula.

Six quality checks judge the written explanation, methods, results, criticism,
reproduction plan and visuals. A pass for a substantive section must point to
retained report claim indices and an exact report-prose excerpt. It cannot be
earned just by praising the source paper. After support auditing, question
coverage is reconciled against retained written claims; dropped assertions do
not leave answered badges. Source gaps, processing_error and unverified
reconciliation are distinct in storage and UI.

One targeted repair plus re-audit runs only if BOTH fit the remaining call,
input, output and time limits. No unbounded rewrite loop or fabricated padding.
Completion requires populated core sections, supported written answers, all
quality criteria passing/not-applicable and the selected minimum word target.
Detailed AI paper analysis additionally requires a sourced visual. A shorter or
unverified output is partial, even when some useful conclusions are supported.

Claim kinds distinguish source-reported facts, grounded inference, conditional
recommendations, explicitly self-created teaching illustrations (not executed)
and program-computed derivations. Calculations accept only matched cited inputs
and bounded difference/mean/ratio operations; no eval/model-trusted arithmetic.
Flows require real node/edge relations; tables require a rectangular shape;
bar charts require cited numeric values, units and shared conditions. The
semantic audit still checks comparability. Visuals are agent reconstructions,
not extracted original figures or independently replicated measurements.
- Numeric formatting differences (85 vs 85.0 vs 85,0) no longer erase equivalent
  results. Different or uncited reported numbers are still rejected.
- HTTP(S) URLs in every claim kind must occur in its cited reading/context or
  source URL. A model's supported verdict cannot authorize an invented link;
  ungrounded URLs are rejected, not silently corrected.
- Auditing sends full cited chunks plus flagged conflicts, not the entire
  reading packet again. This reduces repeated input; it does not independently
  discover contradictions outside the retrieved material.
- Reports and final WebSocket events carry completed / partial / failed. Empty
  analyses are failed; missing question coverage, missing substantive sections,
  or unavailable semantic auditing are partial. REST polling/download and saved
  provenance preserve these terminal records. Old v2.0 records remain readable;
  empty structured records are flagged as failures in the reader too.
- Safe diagnostics distinguish invalid request/schema, malformed output,
  truncation, rate limits, timeouts and the specific budget boundary. Provider
  error bodies, private prompts and credentials are never stored in diagnostics.

## Reading quality

PDF extraction v2 orders blocks within columns and partitions at spanning
headings/captions, including PDF blocks containing separate left/right lines.
Page, column and block bounding boxes are retained. Line-break hyphenation is
normalized heuristically. This improves two-column prose but is NOT a guarantee
of correct equations, table topology, figure interpretation or reading order for
every layout. Existing owner-scoped PDF originals are re-extracted on access
without changing content identity or resetting cache age; saved old reports stay
unchanged. Public PDF downloads now retain their bounded originals too.

HTML reading prefers main/article text when present and removes blank padding
without flattening code lines. Technical-guide reads prioritize specific
installation/deployment/Docker documentation over home/blog indexes. This is a
relevance heuristic, not a source-trust score. Retrieval also uses source-language
search terms so Vietnamese report questions do not remove English technical
matches. Hosting briefs focus on prerequisites, deployment, API checks, security
and troubleshooting; background architecture is supporting material.

Regression verification uses deterministic mocks by default. The opt-in
scripts/evaluate_explanation.py --live probe uses already retrieved sources or an
explicit local PDF, with bounded model calls and no web rediscovery; its outputs
are real model outputs, not a manually polished reference report. A partial probe
must not be presented as a completed full research run or scientific replication.

## Product interaction

- Independent report language, paper mode, discipline, private PDF intake and
  bounded search/document settings in the Research form.
- Fields: Analyze a paper opens the correctly scoped paper brief.
- Library analysis uses a real paper input, not a concatenated search prompt.
- Report layers: Understand / Evidence / Review. Method cards use retained
  claims only for legacy reports. New reports add Visuals/arXivisual and real
  relational SVG/table/bar visuals, with claim/visual → exact quote →
  surrounding context → original page.
- With auto-approval off, the editorial review shows that same source-linked
  draft before export. Revisions use only the remaining budget and are audited
  again; exhausted revision budgets are disclosed instead of ignored silently.
- KaTeX formulas. No fabricated charts, original-figure extraction, or
  automatic scientific videos are claimed.
- arXivisual is optional external navigation for public arXiv papers; its
  video content/version/language is not verified or controlled by Nexora.

## LaTeX/PDF exports

Authenticated owner-scoped GET /api/reports/{id}/export?format=pdf|tex|zip
exports the same retained structured report. The default product download and
legacy session download route now return PDF; copy returns complete LaTeX.
Source ZIP contains standalone report.tex and build instructions, never the
original uploaded paper. Source is available even without a compiler.

The trusted template escapes prose, restricts URLs/math commands/environments,
revalidates TikZ identifiers/table/chart shapes and never fetches model image
URLs. Vietnamese fonts, equations, tables and sourced diagrams are embedded in
the standalone TeX. Only used sources enter its bibliography.

Server compiler: Tectonic or XeLaTeX, selected via NEXORA_LATEX_BIN or PATH.
Windows development also discovers .tools/tectonic/tectonic.exe; that portable
official binary is ignored by Git. Docker includes XeLaTeX and TeX fonts.
Compilation disables shell escape, uses a temporary directory, strips provider
credentials from child-process environment, limits concurrency and has timeouts.
Tectonic's first run may download its TeX/font bundle; warm the cache before
deployment and optionally set NEXORA_TEX_OFFLINE=true afterwards. No private
paper/report is uploaded to a cloud PDF service.

Cache identity includes the entire TeX and template version. A revised report
invalidates its PDF before compilation; failures NEVER return a stale or fake
PDF. Missing engine/busy/compiler failures are explicit and source is preserved.
This is defense in depth, not a substitute for process/container isolation in
public production. Manual visual QA covers Vietnamese, math, tables, flow and
bars; model support judgments are not independent scientific certification.

arXivisual currently exposes no verified supported bulk API/embed contract for
this integration. Its public pages restrict embedding. We provide a validated
version-preserving public-paper link in a separate tab, not an iframe, automated
video import, copied application or private-PDF upload. Deeper integration needs
a supported API and permission from that service.

## Before public production deployment

Add queue/concurrency/rate limits; cumulative account storage quotas and
deletion/retention controls; process-isolated PDF parsing/OCR; distributed job
and checkpoint persistence; tokenizer-specific billing/cost caps; multilingual
semantic evaluation datasets; visual table/formula verification. Do not expose
the development login in production.
