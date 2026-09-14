# Storyboard Studio quality loop

Requested by Big Trimpy: pass only above 8.5/10; stop after a pass or four revision rounds. Scope is the agreed personal, local storyboard tool with manual handoff and optional OpenAI image generation.

## Scoring rubric

| Category | Weight |
|---|---:|
| Usability and intuitive workflow | 20% |
| UI and interaction design | 15% |
| Final PDF quality and fidelity | 20% |
| Functional fit to the agreed brief | 20% |
| Robustness and infrastructure | 10% |
| Code quality and simplicity | 10% |
| Efficiency | 5% |

Grades are reviewer judgments supported by concrete evidence, not benchmark facts. No pass with a known data-loss issue or broken primary workflow. Preserve the weights across reviews. Initial review is round 0; each builder pass consumes one of four revision rounds.

## Reliable panel details — 14 September 2026 — 8.9/10, pass

Initial implementation review scored **8.3/10, fail**: the complete menus and atomic Clear worked, but entering Custom from a preset hid the saved value behind an empty draft, and Clear could leave a transient blank custom editor open. One builder correction initializes the visible draft correctly and remounts both choices after an explicit successful Clear. Normal custom-text deletion remains editable, and Undo restores metadata without combining Clear with the next edit.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 9.0 |
| UI and interaction design | 8.9 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 9.2 |
| Robustness and infrastructure | 9.0 |
| Code quality and simplicity | 8.0 |
| Efficiency | 9.4 |

Weighted total: **8.945**, reported as **8.9**, passing after one correction round. All **200 tests**, typecheck, lint, formatting and the production build pass. Root exercised the production controls at 1280×800 and 507px, verified actual folder saves and reload, and reviewed the two-page PDF preview. Clearing optional metadata retains frame identifiers, dialogue, camera/action text, artwork, the full-width preference and every neighbouring-panel field. No browser console errors appeared. The existing large editor/exporter modules and conservative long-copy PDF pagination remain the principal limits behind the score.

## PDF editorial layout and print optimization — 14 September 2026 — 8.9/10, pass

Initial review scored **8.2/10, fail**: compressed artwork looked good, but dividers and repeated cue positions needed stronger separation. Correction one improved portrait hierarchy and spacing; landscape still orphaned short dialogue and cue blocks (**8.3/10, fail**). Correction two solved those splits with an overly broad landscape image cap, reducing large artwork too much (**8.4/10, fail**). Correction three made sizing adaptive but exposed title-only pages in the complete project (**8.2/10, fail**). Correction four uses the actual remaining page space, preserves short frame packages and avoids isolated repeated cue pages. Final validation caught and fixed the case where a full source tail and a long flowing destination could otherwise suppress both cue copies; its new regression failed before the guard and passes afterward.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 9.2 |
| Robustness and infrastructure | 8.9 |
| Code quality and simplicity | 8.0 |
| Efficiency | 9.4 |

Weighted total: **8.9**, passing after four correction rounds. All **197 tests**, typecheck, lint, formatting and the production build pass. Root reviewed the eleven-page portrait export and an independent agent reviewed all sixteen two-column and fifteen three-column landscape pages. Each landscape layout received A−: large frames are clear and aligned, with only minor narrow-gutter wrapping in three-column mode. All 31 frame placements, 49 printed authored fields and six connection notes survive. There are no blank or isolated short-caption/cue pages, text collisions or off-page content in the complete Quokka project.

The portrait raster-capable test export is about **2.6 MB**, down from **67.4 MB** in the user's matching saved PDF, a **96.2% reduction**. Selected image sources are embedded once and sized for print; originals and unused versions stay intact. Both native browser rendering and the QA encoder handle the real artwork. Live production checks at 1280×800 cover all three layouts, page navigation and preview sizing; the 507px preview remains within its viewport. No app console errors appeared, and the review copy was closed through the UI.

Limits behind the score: page packing is conservative around explicit large frames and long direction. When a page is full, a complete labelled incoming cue can replace the outgoing/incoming pair; both endpoints are still identified and no bare arrow remains. Long flowing copy can require continuation pages. JPEG print optimization is lossy, while source artwork remains unchanged. Very fine art may merit a future quality control. The exporter/editor remain large modules, positional draft identifiers remain, and the existing PDF-library bundle warning remains. No paid image generation or usage reset was required.

## Camera movement labels and PDF row flow — 14 September 2026 — 8.9/10, pass

Initial review scored **7.9/10, fail**: the movement labels and Aerial option worked, but the PDF wrap marks floated away from the artwork and short gutter descriptions were still left-aligned. Correction one centered all description paths and anchored arrows to final frame placements. Its margin clamping left tiny arrowheads inside uncapped frame borders, so review remained **8.2/10, fail**. Correction two uses clear paper space outside the source and destination images, with regressions that compare PDF line coordinates against actual frame bounds.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.1 |
| Functional fit | 9.2 |
| Robustness and infrastructure | 9.0 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.7 |

Weighted total: **8.905**, reported as **8.9**, passing after two correction rounds. All **182 tests**, typecheck, lint and the production build pass. Root inspected 26 pages across portrait and both landscape layouts, including a read-only snapshot of the actual Quokka opening scene. Every authored field and cue description survives at its exact expected occurrence count, with no off-page text. The review covers short and long descriptions, row/page breaks, shot boundaries, capped landscape frames and explicit full-width images.

At 1280×800, the rebuilt app saves Aerial on both panel and shot connections and retains exact description casing after reload. All three live previews and page navigation work. Both connection editors and the preview fit a 507px viewport with no horizontal overflow; no app console errors appeared. The fixture was closed through the app, Teaser restored and temporary review material removed.

Limits behind the score: page packing remains conservative, especially around explicit large frames and long cue text. The dotted pair communicates reading flow rather than a continuous physical camera path. Position-based draft identifiers, large editor/exporter modules and the existing PDF-library bundle warning remain. No paid image generation or usage reset was required.

## Scene-qualified labels and deliberate PDF sizing — 13 September 2026 — 8.9/10, pass

Initial review scored **8.3/10, fail** because selected large frames could orphan their short captions. Correction one fixed caption placement and standardized outgoing movement cues. A reproduced incoming-cue/target measurement mismatch required correction two, which shared the target-block calculation and bounded the start of very long captions. The live editor review remained **8.5/10, fail** because SH01 crowded the singleton panel title. Correction three gave the code its actual width plus a 10px gap.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.1 |
| Functional fit | 9.2 |
| Robustness and infrastructure | 8.9 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.7 |

Weighted total: **8.895**, reported as **8.9**, passing after three correction rounds. Root reviewed the actual Quokka scene and the mixed-size study across all three layouts (24 pages), verified source-copy retention and footers, and exercised the production app at 1280×800 and 507px. All 179 tests pass; the final spacing-only correction passed focused checks, and the production build passes. The per-panel choice survives save/reload and undo without changing its neighbour.

Limits behind the score: public codes are positional draft labels, not locked production identifiers. Page packing remains conservative, and long direction may continue onto another page. Layout regression cases and the visual studies are representative rather than an exhaustive proof for arbitrary copy and ratios. The exporter/editor remain large modules; the existing PDF-library bundle warning remains. No paid generation or usage reset was required.

## PDF visual design polish — 12 September 2026 — 8.9/10, pass

The first rendered review scored **8.2/10, fail**: shot separation improved, but portrait running-header rules still crossed shot numbers, the masthead repeated labels, and short camera notes remained detached from their arrows. Three correction passes refined hierarchy and clearance, repaired inline/fallback cue duplication and collisions, and aligned paired single-shot captions to the actual capped artwork width. A separate read-only review caught a compact-title font-metric mismatch.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.2 |
| Functional fit | 9.1 |
| Robustness and infrastructure | 8.8 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.6 |

Weighted total: **8.88**, reported as **8.9**. This passes within the requested revision limit. The visual judgment uses Big Trimpy's actual Quokka Scene 4 artwork and copy, rather than only empty-panel fixtures.

Evidence: all **161 tests**, typecheck, lint and the production build pass. Root inspected all 11 pages across the three layouts. The 13 panels and all 16 authored description/action/dialogue fields are retained; the short dolly note appears once, and no text crosses a full-width rule or the page boundary. Portrait uses three pages, landscape two-column five, and landscape three-column three. The final landscape alignment render was reviewed; ten unaffected pages matched the previously inspected PNGs exactly. Live preview checks at 1280×800 cover all layouts, page navigation and the six-frame landscape page, with no console errors. The 507px dialog remains within the viewport.

Limits behind the score: page packing remains conservative; an isolated shot can still receive a roomy frame, and longer copy needs continuation pages. Courier Prime supplies portable PDF dialogue while the editor uses installed Courier New. The exporter/editor remain large modules, and the PDF-library bundle warning remains. No paid generation or usage reset was required.

## Courier dialogue and adaptive single-shot sizing — 12 September 2026 — 8.8/10, pass

Initial review: **8.3/10, fail**. Courier Prime rendered correctly in compact and continued dialogue, but three-column shot connections used different widths for fitting and drawing, a static camera note could disappear, square or tall frames could accept more text than their actual width allowed, and an odd final single-frame shot could still waste a page. Root also observed a shot number touching the running header rule on a landscape continuation page.

The initial weighted score was 8.265: usability 8.8, UI 8.8, PDF 7.6, functional fit 8.5, robustness 7.3, code quality 8.1, efficiency 8.5. The missing authored camera note independently prevented a pass.

After correction round one, review was **8.5/10**, still below the required pass threshold. The primary layouts and all 150 tests passed, but a custom wide-ratio lookahead could conflict with the renderer's fixed page guard, and several new branches lacked focused regression coverage. Correction round two aligned that guard and added checks for three-shot static notes, long combined gutter notes, titles on narrow frames and wide-ratio pagination.

| Category | Final score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 9.1 |
| Robustness and infrastructure | 8.8 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.6 |

Weighted total: **8.84**, reported as **8.8**, passing after two correction rounds. All 154 tests, typecheck, lint and the production build pass. Root inspected rendered PDFs and actual production previews at 1280×800, with a secondary 507px overflow check and no console errors. The three-shot artwork example fits one page in portrait or landscape three-column mode; the old live landscape export used four. The previous six-panel action/dialogue/movement example still fits one landscape page. Text extraction independently verified all 65 continued dialogue lines, exact punctuation and the different body/heading font families.

Limits behind the score: packing remains conservative rather than globally optimal; longer copy and roomy isolated frames can still require continuation pages. The export font is Courier Prime, while the editor continues using installed Courier New. Existing large editor/renderer modules and the PDF-library chunk-size warning remain. No paid generation or usage reset was needed.

## Print layout review — 12 September 2026 — 8.8/10, pass

This review covers Courier New in the dialogue editor, denser PDF rows, landscape choices and movement cues across row/page breaks, using the established rubric.

| Category | Score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.8 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 9.1 |
| Robustness and infrastructure | 8.7 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.4 |

Weighted total: **8.82**, reported as **8.8**. The first visual review scored 7.9 because landscape pages broke too early and captions were misaligned. Four builder revision passes resolved density, header collisions, long-title pagination, lost source labels on long movement rails and duplicated legacy camera text. The final pass used the actual six-panel review project's short action, dialogue and movement notes, rather than relying on empty-panel packing tests.

Evidence: 139 tests, typecheck, lint and production build pass. Root inspected rendered portrait/two-column and landscape/two-/three-column PDFs, including continuation pages, and the complete six-panel dialogue example. The live rebuilt application shows all six panels on one landscape page. Courier New availability, layout changes, production-note toggling and page navigation were verified at 1280×800, with a 507px overflow check and no console errors. A separate read-only agent reviewed pagination and data fidelity.

Limits behind the score: dense three-column pages use slightly smaller artwork, while longer dialogue or movement descriptions still need more room. Six frames are a capacity, not a fixed page count. Portrait first pages retain their larger project/scene hierarchy. The editor and renderer remain substantial modules, and the build retains its existing PDF-library chunk-size warning. No paid image calls or usage resets were needed.

## Feature review — 12 September 2026 — 8.8/10, pass

This review covers the integrated image-framing and folder-project additions, using the same weights and personal-use scope.

| Category | Score |
|---|---:|
| Usability and intuitive workflow | 8.9 |
| UI and interaction design | 8.7 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 9.1 |
| Robustness and infrastructure | 8.6 |
| Code quality and simplicity | 8.1 |
| Efficiency | 8.3 |

Weighted total: **8.79**, reported as **8.8**. Builders implemented framing, disk persistence and PDF parity; root reviewed and integrated the work, including framed generation inputs. Review corrections addressed unsaved changes on close, failed save-queue recovery, stale deletion guards after same-window reopening, thumbnail aspect ratios and controls crowding the MacBook layout.

Evidence: 128 tests, typecheck, lint and production build pass. Actual production UI review covered folder creation by path, PNG/WebP imports, independent image-version framing, dragging, reset/undo, Command-S, reload, closing/reopening, edits after same-window reopening, and persistence through server restart. The folder's two image files match the originals byte-for-byte; the project metadata contains only image tokens. Root visually checked the rendered PDF framing study and the live export. At 1280×800 the collapsed framing bar keeps dialogue close to the artwork; controls remain available at 507px with no horizontal overflow or app console errors.

Remaining limits behind the score: native folder selection could not be fully operated through the available desktop automation, although the path-entry flow passed end to end; artwork is still loaded into memory; unused original files are retained; archives remain bounded at 2 GiB; and the large editor component could be split further. The generated-image folder write was verified with mocked provider responses, avoiding paid test requests. The separate review project was closed, its folder retained under `/private/tmp`, and Teaser restored.

## Review 0 — 7.1/10, fail

| Category | Score |
|---|---:|
| Usability and intuitive workflow | 6.5 |
| UI and interaction design | 7.0 |
| Final PDF quality and fidelity | 7.7 |
| Functional fit | 7.5 |
| Robustness and infrastructure | 6.5 |
| Code quality and simplicity | 7.0 |
| Efficiency | 7.2 |

Weighted total: 7.10. Independent reviewers gave 7.0 for UI/code, 7.5 for domain reliability, and 8.0 for the PDF itself. Root lowered export workflow confidence after finding the actual preview blank.

Observed blockers:

1. At the user's actual 507px in-app viewport, CSS hides Add scene, Settings, Download backup, and Undo. Navigation consumes most of the first screen.
2. PDF generation completes, but the embedded PDF preview is a blank iframe in the actual browser.
3. Cross-tab writes lack a compare-and-swap base revision; a stale document can overwrite newer work or be falsely marked saved. Deleted documents can be resurrected by another tab.
4. Unlimited accepted artwork can exceed the only backup format's capacity, leaving no safe backup path.
5. Custom ratio selection is inert; load failures can show Saved; reload loses selection and revision drafts.
6. PDF annotations overlap/truncate, full project titles are visually truncated, and some page breaks detach shot setup from its first frame.
7. Launcher accepts any HTTP200 as this app and does not check build freshness/readiness.

## Revision round 1 — completed

Three builder agents own UI/state integration, domain/storage, and PDF/preview. Root owns launcher infrastructure, browser journey review, integration, and the next independent grade. Scope remains the accepted product; no paid generation or cloud deployment.


Primary viewport clarified by Big Trimpy: MacBook-sized window, reviewed at 1280×800. Narrow 507px in-app layout remains a secondary robustness check.

## Review 1 — 8.3/10, fail

| Category | Score |
|---|---:|
| Usability and intuitive workflow | 8.4 |
| UI and interaction design | 8.2 |
| Final PDF quality and fidelity | 8.1 |
| Functional fit | 8.6 |
| Robustness and infrastructure | 8.6 |
| Code quality and simplicity | 8.0 |
| Efficiency | 8.0 |

Weighted total: 8.31. The core blockers are fixed, but final presentation and delivery are below the requested bar.

Root verified in the actual browser:

- 1280×800: artwork and dialogue visible together; established desktop layout preserved.
- 507px: Workspace actions exposes Add scene, Settings, Backup, and Undo.
- Custom ratio1.85 commits and is reflected in frame and prompt.
- PNG artwork imports, WebP replacement creates a second version, either image can be restored, and exact multiline dialogue/director description remain unchanged.
- Uploaded references are selected for the shot and named correctly in its generated prompt.
- PDF.js displays the generated PDF, including a WebP image, in the actual embedded browser.
- Optional WebMCP prompt tool registers and returns the same selected-panel prompt.
- Full test runner now includes new TypeScript persistence cases: 28 tests pass (the initial builder command had omitted that glob; root corrected it).
- Revised launcher builds stale output, validates app identity, waits for readiness, and starts the production server successfully.

Remaining reasons for another revision:

1. First printed page repeats the project title at two prominent sizes; the hierarchy wastes space and lacks the requested restraint.
2. PDF preview fits width by default, hiding most of the page in an800px window. Previous/Next controls have uneven widths.
3. Backup click produced no observable browser download event or expected file during review. This may involve embedded-browser/tool behaviour, but delivery needs durable blob URLs, an explicit fallback link, and honest feedback. No backup delivery pass is claimed yet.
4. Form labels should be explicit; a native ratio control worked through accessibility but not an exact labelled locator.
5. Whole-project storage needs a realistic-size cost check rather than relying only on tiny fixtures and a mocked budget boundary.

## Revision round 2 — completed

Builders are refining print hierarchy/fit-page preview, backup delivery and explicit labels, and performing a realistic persistence benchmark. No paid generation or hosting introduced.


## Review 2 — 8.8/10, pass

| Category | Score |
|---|---:|
| Usability and intuitive workflow | 8.8 |
| UI and interaction design | 8.7 |
| Final PDF quality and fidelity | 9.0 |
| Functional fit | 8.8 |
| Robustness and infrastructure | 8.8 |
| Code quality and simplicity | 8.2 |
| Efficiency | 8.6 |

Weighted total: 8.765, reported as 8.8. Pass exceeds 8.5 after two builder revision rounds. This is a reviewer judgment for the agreed personal-use scope.

Root verified the integrated production app at 1280×800: full-page PDF visible by default, working Fit width, balanced controls, single printed project title, and exact Frame ratio label. Chrome displayed page 2 of a two-page export. Backup and PDF reached native macOS Save dialogs; after Save, root validated the actual JSON against the canonical schema (one scene, two shots, three panels) and extracted the actual two-page PDF with both shot titles intact. Initial download-event timeouts were therefore not evidence of failed Chrome delivery. Embedded-browser disk delivery remains unverified; its preview and retained links work.

Builder evidence: 36 tests, typecheck, lint and production build pass. Rendered fixtures include a normal two-page sheet and seven-page stress export. All 80 dialogue IDs and 36 caption IDs extract exactly once, punctuation survives, and no text crosses page or body margins. Root independently rendered and reviewed the normal first page.

Reliability refinements include durable download URLs, independent imported-copy revision drafts, explicit labels, honest browser-local save status, compact backups and lazy thumbnail decoding. A real 60 MiB serialized fixture reduced local Node/fake-IndexedDB save time from approximately 280 ms to 60 ms by avoiding extra full-image serialization for budget checks. This is environment-specific, not a browser performance promise.

Remaining limits behind the score: manual generation handoff; actual character consistency and image quality need a scene trial with Big Trimpy's art; browser/profile-local storage and 96 MiB working capacity; a sizeable editor component and PDF/font bundle leave room for simplification. No known primary-flow or data-loss blocker remains in the verified Chrome workflow. Temporary viewport overrides were reset, Teaser restored, and the separately named Review sandbox retained. No weekly reset used.

Build coordination note: an agent's final build briefly replaced assets under the running review server. Root restarted against the completed build and verified Chrome hydration and exports afterward. Future builds should stop the production server first.

## Reference library follow-up

The requested project-wide character library and manual generation packs were added after the bounded review loop. Root reviewed the new 1280×800 library, checked actual image upload and prompt persistence, and independently verified ZIP image bytes. That update had 44 passing tests; typecheck, lint and production build also passed. Existing project artwork and shot selections remain backward-compatible. OpenAI generation was subsequently added in the follow-up below.

## OpenAI generation follow-up — 10 September 2026

The optional API path adds explicit single-frame generation and revision, automatic selected-reference transport, original-panel image insertion, a persistent local usage ledger, and retained-result recovery. The director can still use manual generation packs. The API key stays in local server memory unless the director explicitly configures a local environment file.

Root and an independent agent reviewed charge duplication, image recovery, token pricing, credential boundaries, and the 1280×800 Generate interface. Review changes reduced the pricing section's height, made new charges explicit after uncertain outcomes, preserved historical cost estimates, decoupled image recovery from a damaged ledger, and validated provider image payloads. Reference prompts identify attached images in their actual input order, reserving the first image for the revision base.

The app retains the **8.8/10 software-workflow assessment**. This is not a grade for generated-image quality or actual API economics: those remain unverified until a paid scene trial with Big Trimpy's key and artwork. No API key was configured and no paid request was made during this implementation review. See `BUILD-VERIFICATION.md` for final checks. The original bounded review loop was already complete; this section records review of the subsequently requested feature.

## First-use refinements — 10 September 2026

Big Trimpy generated two successful Low-quality images, then requested better quality options, independent new-panel direction, and more visual production PDFs. Root delegated the frame/model and PDF work, reviewed the actual generated island artwork and motion-study PDF, and tested the integrated app at 1280×800 plus the narrow PDF controls. The first-use fixes preserve existing authored data, make Medium the default, expose High, separate primary frame direction from shared shot context, and add explicit editorial transitions and camera/action connectors. Production notes are optional in export. All 76 tests, typecheck, lint, and the production build pass. No additional paid generation was performed; higher-quality output costs still require measurement.
