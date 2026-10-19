"""Compare exact game/program expectations; disclose implementation/provenance revisions."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[5]
baseline = root / 'docs/arena-backlog/evidence/907/fusion-checkpoint-2026-10-19/starter-compiler-pack.json'
actual = Path(sys.argv[1])
a, b = json.loads(baseline.read_text()), json.loads(actual.read_text())
for field in ('inputs', 'protocol', 'decks', 'games', 'programs', 'summary', 'measures'):
    assert a[field] == b[field], f'Frozen {field} changed; investigate, do not rebaseline'
for field in ('policy', 'ruleset', 'errata'):
    assert a['versions'][field] == b['versions'][field], f'{field} changed'
changes = {key: {'before': value, 'after': b['versions'][key]}
           for key, value in a['versions'].items() if value != b['versions'][key]}
assert set(changes) <= {'engine', 'sourceHead', 'engineSourceHash', 'loader', 'runner'}, changes
receipt = {
    'baseline': str(baseline.relative_to(root)),
    'baselineSHA256': hashlib.sha256(baseline.read_bytes()).hexdigest(),
    'actualSHA256': hashlib.sha256(actual.read_bytes()).hexdigest(),
    'baselineVersions': a['versions'], 'actualVersions': b['versions'],
    'equal': ['catalog/source/defs', 'decks/admission records', 'seeds/move limits/protocol',
              'all 16 complete game records and trace hashes', 'all 75 executable programs and manifest',
              'summary/measures', 'policy/ruleset/errata'],
    'versionChanges': changes,
    'versionChangeReasons': {
        'engine/sourceHead/engineSourceHash': 'Reviewed Fusion material implementation and two restored material behaviors.',
        'loader': 'Typed native/granted material loading and explicit obsolete-record refusal.',
        'runner': 'Hash includes arena-corpus-provenance.mts: Fusion material authority separated from residual native identity/timing; cost.fusion is retained by loader. The game runner itself is unchanged.',
    },
    'outcomes': b['summary'], 'expectationChanges': [],
    'note': 'Compiler controls, not production stored-program qualification. Original comparison stopped on the expected provenance-source hash change after every game/program/input equality assertion passed; no gameplay expectation was changed.',
}
Path(sys.argv[2]).write_text(json.dumps(receipt, indent=2) + '\n')
print('All 16 full game records and 75 programs exactly preserved; implementation/provenance source changes disclosed.')
