# Reviewed run files for the Arena testing portal

These allowlisted files preserve the actual source, fixture/policy hashes, outcomes
and explicit mappings. They exclude raw game states, prompts and hidden traces.

| File | Results | Meaning |
|---|---|---|
| [scenario-manifest.json](scenario-manifest.json) | 3 pass | Generic setup, battle and pending-choice cases; Node/browser agreement. Unmapped to whole mechanic families. |
| [strategy-manifest.json](strategy-manifest.json) | 12 pass, 3 fail | Five declared tactical subcases × three policies. All three failures belong to the heuristic; these are partial AI-01/02/05 cases. |
| [holdout-30m-manifest.json](../826/holdout-30m-manifest.json) | 142 wins, 178 losses | Search v2 versus the heuristic, 320 complete games. Negative strength result; no promotion. |

Use Arena → Testing & stats → Test run history → Import test results. Repeat
imports retain the same request ID and add no duplicate records. Importing a case
does not mark an entire recipe or scenario passed. These local runs used no paid
API calls. Production import is separate from merely committing these files.
