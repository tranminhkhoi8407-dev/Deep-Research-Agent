# Research visual explorer

## What is implemented

Reports keep one checked structured record for the web, LaTeX source and PDF.
Schema 3.1 adds optional component-level details; 2.0/2.1/3.0 remain readable.

- Left report navigation: explanation, visual explorer, original paper, evidence,
  review/budget; six content anchors; export controls in the rail.
  Completed/partial structured reports use the full Research workspace; the
  "New topic" button restores the input form. Saved reports use the same reader.
- Flow explorer: actual directed edges, selectable nodes, previous/next reading
  step, inputs/outputs, explanation and component evidence. Reading order is not
  presented as execution order. Explicit relations remain accessible as text.
- Bar/table explorer: select a row, inspect its interpretation and sources,
  switch chart/table and sort without modifying data or losing row identity.
  Dataset, metric, unit and shared evaluation conditions stay visible.
- Equation explorer: sourced LaTeX and selectable, sourced symbol definitions.
  No generated JavaScript, expression evaluation, arbitrary simulation or AI call.
- Original PDF: opt-in owner-scoped page raster, zoom, navigation, exact quote
  search and highlight. A missing match is explicit; no approximate box is drawn.
  Original figures and tables appear in their actual page context.
- PDF/LaTeX include every saved component explanation and location, not just
  the web's selected state. Original private PDFs are not included in exports.

## Scientific boundaries

Quotes must match selected evidence. Rich node/row explanations and symbols
need their own valid proofs. Supplied edge proofs must also match. The writer
requests bindings for each component; aggregate-only parts are visibly labeled
as such (especially legacy diagrams), not given fake granular citations.
Numeric details cannot borrow values from
another component's proof. One model audit inspects the full structured visual,
including topology and source bindings, within the existing run budget. A visual
with unsupported components is omitted rather than decorated with invented facts.
Exact matching and a model audit are not independent scientific verification.
The audit must check identity, comparability, causation and explanations too.

## Visual generation and failure reporting

Narrative writing no longer asks the model to embed nested visual JSON in long
prose. `generate_visuals` uses a separate `VisualDraft` wire schema, compact Q
locators and original readings. It creates up to two figures; every new node,
edge, row and symbol must have its own evidence. It allows at most one format/
source-check repair, regenerating from readings and sanitized defects (not
inventing missing quote IDs). The final semantic audit still checks every figure.
No unaudited figure is retained when that audit fails.

Writing and follow-up reading reserve calls for creation/repair and final audit
inside the existing user ceilings. Generation additionally reserves input/output
for the growing audit packet; insufficient room stops the visual step rather
than raising budgets. Concise output only asks for figures when the brief asks.

A focused mechanism uses the best task-matched documentation family, instead
of silently merging legacy APIs and third-party wrappers into one pipeline.
Explicit cross-source comparisons may read multiple families. This is a bounded
retrieval heuristic, not a source-quality guarantee. Other readings remain in
the full ledger; the audit gets the task objective and original source identity.
The caption must distinguish reconstruction from an original figure.

Saved `visual_status` distinguishes no generation, malformed structure, failed
source checks, failed/missing semantic verdict, unavailable audit, unavailable
budget and successful figures. Diagnostics keep field paths + error types, not
model inputs, raw rejected figures, provider messages or secrets. Old reports
with `invalid_items: visuals.0` now show a format failure, not a claim that the
source lacks evidence. They are not regenerated or overwritten on viewing.

Charts only accept finite nonnegative values, two columns, a unit and shared
conditions. They never substitute missing values with zero. Incomparable settings
should be separate figures or a conditions table; there is no automatic ranking
claim, confidence interval, relative gain or experiment simulation. Math uses the
same bounded command allowlist for generation and export; KaTeX is untrusted.

Legacy reports have no new explanations magically added. Their existing figures
remain selectable, with explicit aggregate-only evidence fallback. Viewing them
does not regenerate reports, call paid services or re-download public sources.

arXivisual remains an optional external link for a public arXiv ID/version.
No API/iframe embed contract has been verified; no uploaded PDF/account data is
sent. Original-page viewing is not an AI figure-reading/annotation system.

## Privacy and operational limits

Document routes re-check account ownership for every image/quote request, return
private/no-store responses and do not accept remote URLs. Only stored PDFs are
rendered. Preview has two render slots, bounded page count and bounded dimensions.
The frontend fetches only when a user opens a preview; it aborts on close/change,
revokes image object URLs, handles failures and never embeds PDF active content.
No cross-account/public cache is used. If the original is gone, text evidence is
still readable and the preview says it is unavailable. PDF export still requires
the deployment's configured local LaTeX compiler; no placeholder PDF is returned.

Interactions themselves add no LLM calls. Generating richer explanations can use
more of the existing token budget; no cost/quality guarantee is implied. Budget
limits, partial outcomes and stopping reasons remain authoritative.

## Checks

- Backend: `python -m pytest -q` (includes source, parser, export, ownership,
  quote highlight and concurrency regressions).
- Frontend: `npm run test:research`, `npm run build`.
- Browser: dedicated Vite test server and `npm run test:research:browser`, with
  optional NEXORA_TEST_URL, NEXORA_PLAYWRIGHT_DIR and NEXORA_BROWSER_EXECUTABLE.
  Uses synthetic reports and intercepted document responses, no real accounts.
  Completion is tested with an intercepted research WebSocket, never a paid run.
- Native-provider regression: `tests/test_visual_generation.py` covers narrative
  -> visual wire schema -> format repair -> own-component proofs -> full audit,
  within unchanged Deep ceilings. It also checks legacy/third-party scope.
- Optional bounded live check: `python scripts/check_research_visual_generation.py
  --report <saved.research.json> --live`. Uses stored excerpts only, at most three
  calls / 60,000 estimated input / 12,000 output / 180 seconds; no searching.
  Writes a SEPARATE visual-only QA artifact, not a rewritten original report.
  Browser QA can inspect it with `NEXORA_VISUAL_QA_REPORT=<absolute QA JSON>`;
  loading that artifact in the test browser does not call a provider.
- PDF layout: `python scripts/check_research_visual_export.py`, then render the
  PDF under `tmp/pdfs/research-visuals/` for visual review. Clearly labeled fixture,
  not an actual paper analysis. Do not treat mock model_checked flags as evidence.

Both backend and frontend must be restarted/deployed together for schema 3.1 and
original-page endpoints. No account data migration or report rewriting is needed.
