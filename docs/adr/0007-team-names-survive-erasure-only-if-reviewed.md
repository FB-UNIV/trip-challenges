# Team names survive Erasure only if a Teacher reviewed them

Results (Challenge title, placement, Team name, points) are the one Trip record kept after Erasure, unencrypted, as a public keepsake. Team names are free text chosen by Students and may identify them ("Léa & Tom 4B"), so ADR-0004 required them to be reviewed before being retained — but nothing enforced it: the raw name was copied into the results at reveal (#92). We now record at reveal whether each Team's name was **reviewed** by a Teacher (marking it, or renaming it) together with a neutral label ("Team N", in Team creation order). At Erasure, before the Trip key is destroyed, every unreviewed name in the results is replaced by its label. Reviewed names survive as chosen.

The reveal is deliberately **not** blocked on review: the projected ceremony shows the real names the room knows, and an unreviewed name is neutralised later rather than a forgotten review holding up the night.

## Considered Options

- **Block the reveal until every name is reviewed** — strongest guarantee, but a forgotten review stops the ceremony in front of the class; rejected by the product owner.
- **Reminder only, no tracking** — relies on the Teacher remembering; a miss leaves identifying text after Erasure. Fails the erasure guarantee.
- **Always replace names with labels at Erasure** — simplest and safest, but loses the keepsake value of names the Teacher has explicitly approved.
- **Accept free-text names as kept** (amend ADR-0004) — rejected: the school is the controller, and nothing a Student types should outlive the Trip unchecked.

## Consequences

- The default is safe: a Trip whose Teacher never reviews anything keeps only "Team 1…N" after Erasure.
- Results computed before this change carry no label; Erasure numbers them by name instead. Trips already erased when this shipped had their kept names neutralised by migration `0003` (we cannot know which were reviewed).
- Teachers need a way to review and rename Team names before the reveal (#94, #95); until then every name is unreviewed and is neutralised at Erasure.
