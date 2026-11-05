# R477 native declaration and trigger boundaries — no catalog admission

The fixture loads the complete saved DB1-066 and BT10-153 rows from `standing-negation-observation-5.json`, retaining trigger, price, usage and validity metadata. Gotenks's current hand-only cost-reduction erratum is applied to its printed text. Only the two exact whole-negation Permanent rows receive a fixture-only override of the loader's existing runtime-static gap; card-level support remains blocked. Other cards and numeric attributes are labeled structural mechanism fixtures, not new printed-card admissions.

Source basis: manual 9-6-9-1-2 uses original Battle-area information for departure Autos; 9-6-9-2 prevents an Auto negated in its old area from triggering. The official Gotenks FAQ assigns its removal Auto to the original Battle controller when control changes, distinguishes Counter Window 1 Deflect from Window 2 suppression, and preserves cleanup from an already-resolved Over Realm. R422's existing 9-6-11 arrival witness and R475's ordinary-pending versus already-activated distinction are preserved. This proof does not implement control transfer itself.

The native fixture exposed an old-controller defect: the script's movement loop captured `movedMaster` before moving, but checked `h.masterOf` afterward to decide whether an opponent caused removal. A borrowed card returning to its physical owner's area could lose its Auto entirely. Named departure pends also rediscovered the destination owner. The narrow fix carries the captured old master through those Battle-departure pends and watcher families, while native self-departure triggers use the moment's existing `fromHolder`. The pending Auto's ordinary serialized `master` then survives ordering and reload. Other named pends keep their previous behavior.

`standing-negation-trigger-boundaries-5.ts` passes 26 grouped cases across both seats using saved `RULES.apply` actions, with additional direct native movement-event controls:

- Suppressed and unnegated Gotenks departures, each owned or already borrowed. Original suppression is tested before cleanup; only an active Ultimate redirects the departure to Removed. The Auto targets the former controller's opponent and fires once.
- Own-skill removal of a borrowed Gotenks creates no opponent-removal Auto. Native movement events use the same former-controller snapshot without the interpreter's named pends.
- Borrowed-card watchers: the former controller's by-opponent and by-skill Autos each fire once; the opposing watcher fires once, with no duplicate.
- An ordinary queued end-turn Auto is cancelled when an earlier pending effect plays King. An already activated body still completes its draw after its own play makes King suppress the source.
- A witnessed arrival Auto survives a later Counter that plays King, through serialized response windows. Pre-entry suppression remains a separate trigger-creation boundary covered by the earlier native suite.
- A synthetic pre-entry Counter replacement cannot affect printed Deflect; a post-entry Counter power change can affect that same card after standing suppression removes Deflect.
- Actual Over Realm activation enters under standing suppression, then its already-resolved delayed cleanup still sends the card to Warp at turn end.

Adjacent validation passes: trigger audits 1/2/3, played-or-removed940, R475native50, Over Realm119, Counter arrival58, standing native28 and standalone VM. Targeted TypeScript and lint pass. No additional runtime refusal site, database write, catalog admission or control/stack/Hidden/token/conditional/protection expansion is included.

An independent Energy integration prerequisite (`energy-entry-stack-guard-5.ts`, four cases) preflights every stack material before any placement. A stamped later Energy material refuses without state or event mutation; unstamped stacks keep working. It depends on Energy's occurrence-lifetime helper and is integrated separately with that worker's native patch.
