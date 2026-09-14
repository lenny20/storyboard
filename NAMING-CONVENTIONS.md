# Storyboard identification

Research and product decision for Big Trimpy, 13 September 2026.

## What the sources establish

There is no single syntax demonstrated across these tools; their terminology and
numbering options differ. This is a conclusion from the documentation, rather
than a published universal standard.

- Toon Boom groups several panels within a **scene**. Its hierarchy therefore
  does not map one-to-one to this app's Scene → Shot → Panel labels.
  [Storyboard Pro structure](https://helpcentre.toonboom.com/hc/en-ca/articles/53700084941203-Getting-Started-with-Storyboard-Pro).
- Storyboard Pro supports numeric panel names and several letter sequences,
  leading zeros, and increments that leave room for inserted panels. A/B is an
  available convention, not a requirement for every drawing.
  [Naming preferences](https://helpcentre.toonboom.com/hc/en-ca/articles/41524090002323-How-do-I-change-the-naming-conventions-for-every-project).
- Autodesk recommends including parent identifiers in shot names so that names
  remain unique within a project.
  [Flow Production Tracking naming guidance](https://help.autodesk.com/cloudhelp/ENU/SG-Administrator/files/ar-get-started/SG_Administrator_ar_get_started_ar_episode_entity_html.html).
- In screenplay terminology, Final Draft distinguishes a scene heading's
  location/time from a shot's camera direction.
  [Final Draft script elements](https://kb.finaldraft.com/hc/en-us/articles/27646947570196-What-are-script-elements).

The initial Toon Boom documentation URLs were available in search indexes but
returned errors when opened. On 14 September, the source audit replaced them
with the live, directly retrieved official Help Centre pages above. Autodesk
and Final Draft pages were also directly retrieved.

## Display convention in this app

| Item | Example |
|---|---|
| Scene | Scene 03 — EXT. COVE - MORNING |
| Shot | SC03 · SH04 — One continuous approach |
| A shot with one drawing | SC03 · SH04 |
| A shot with several drawings | SC03 · SH04 · A, SC03 · SH04 · B |

This is our chosen convention, informed by the sources above. The scene prefix
removes ambiguity when shot numbers restart in another scene. A separate panel
letter is easier to distinguish from a production shot insertion suffix than
the fused identifier `04A`. Letters restart per shot and continue A–Z, AA, AB.
Single-drawing shots omit the letter, as Big Trimpy requested.

The selected editor shot/panel shows the full code. Timeline strips can show
compact SH04 or A/B labels because their parent scene/shot is visible; hover
and accessible labels provide the full code. Custom titles are separate.

For the PDF, Big Trimpy requested a more readable hierarchy on 14 September:
`Scene 03, Shot 04` above the artwork, and `S03-04` beneath it, or `S03-04A` /
`S03-04B` when that shot has multiple drawings. Connection endpoints use these
short PDF codes. This is a presentation preference, not a new industry-standard
claim; it retains both parent identifiers and the same underlying draft order.

## Draft positions and production identity

Display numbers currently follow scene, shot and panel order. Reordering or
removing items updates those display numbers. Adding a second drawing changes
the first drawing's display from the bare shot code to its A variant. UUIDs
remain the permanent internal identities, including for saved connections and
image references.

For a later production-lock feature, freeze public codes once a revision is
circulated and assign inserted items their own codes without renumbering
existing work. Keep that distinct from draft ordering and from panel letters.
This feature is not included in the current change.
