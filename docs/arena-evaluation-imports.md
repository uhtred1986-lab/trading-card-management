# Arena run evidence imports

The SL-only `/arena/testing` portal accepts the versioned, allowlisted JSON manifests emitted by Arena scenario and evaluator tools. It stores the runner commit, dirty-source digest when present, protocol and fixture pins, policy versions and hashes, seeds and seats, result assertions, evidence digests, and reported cost when known. It does not upload replay bundles, game states, prompts, private snapshots, action traces, source files, or local paths.

For the generic scenario runner, write the manifest alongside a local output file:

```sh
npm run arena:scenario -- setup --manifest-out /tmp/arena-setup-manifest.json
```

To include the browser comparison, use `--browser`; to export more than one named case, pass their IDs or `all`. The `--manifest-out` option creates the small upload file with restrictive local permissions. The regular scenario stdout report and any replay bundle are separate artifacts and should stay local.

Open `/arena/testing`, choose **Allowlisted run manifest JSON**, and import the generated manifest. The import limit is 512 KiB. Reimporting the same file adds no duplicates; reusing its request ID for changed contents is rejected. Failed validation leaves the selected file and other entered form values available for correction or retry.

Use the run history link to inspect every result in pages of 25, filter by fixture or outcome, and review the pinned fixture and policy hashes. The history shows per-fixture result counts and keeps policy-game outcomes from the candidate policy's perspective. It does not combine different fixtures into a single win-rate claim. A reported cost of zero means explicitly free; `null` remains unknown.

An imported passing case is evidence for that exact run and mapping. It does not automatically mark a catalog recipe or scenario as passed. Only an explicit catalog ID in the manifest is counted as mapped; `null` mappings stay visible but do not satisfy a checklist row. Unpinned runtime revisions remain labeled as unavailable. Progress remains a separate, version-checked manual decision so partial case coverage cannot silently qualify a whole deck recipe or strategy family.
