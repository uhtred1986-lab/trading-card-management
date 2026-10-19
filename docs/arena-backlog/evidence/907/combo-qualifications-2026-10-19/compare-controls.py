"""Keep exact frozen gameplay; permit only the enumerated combo-record migration."""
import copy
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[5]
baseline = root / 'docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/starter-compiler-pack.json'
actual = Path(sys.argv[1])
a, b = json.loads(baseline.read_text()), json.loads(actual.read_text())
for field in ('inputs', 'catalog', 'protocol', 'decks', 'games', 'pairs', 'interruptions', 'summary', 'measures', 'storedRules'):
    assert a[field] == b[field], f'Frozen {field} changed; investigate, do not rebaseline'
for field in ('policy', 'ruleset', 'errata'):
    assert a['versions'][field] == b['versions'][field], f'{field} changed'

expected = copy.deepcopy(a['programs']['scripts'])
migrations = {}
for card, index, timing, origins, turn in (
    ('BT14-010', '10', 'entry', None, 'any'),
    ('BT4-085', '10', 'entry', None, 'any'),
    ('BT4-086', '20', 'entry', None, 'any'),
    ('BT6-010', '0', 'battleEnd', ['hand'], 'opponent'),
    ('BT9-031', '0', 'entry', None, 'any'),
    ('TB1-055', '0', 'battleEnd', ['hand'], 'any'),
):
    old = copy.deepcopy(expected[card]['bySkill'][index])
    program = expected[card]['bySkill'][index]
    program['combo'] = dict(version=1, timing=timing, subject='self', origins=origins, turn=turn)
    program['trigger'] = ['comboed' if timing == 'battleEnd' else 'comboUsed']
    if card == 'BT6-010':
        guard, = program['ops']
        assert guard['op'] == 'if' and guard['cond'] == dict(kind='not', cond=dict(kind='isTurnPlayer'))
        assert set(guard) == {'op', 'cond', 'then'}
        program['ops'] = guard['then']
    migrations[f'{card}/front/{index}'] = {'before': old, 'after': copy.deepcopy(program)}
assert expected == b['programs']['scripts'], 'Executable change outside exact typed combo migration'

before_manifest = {r['key']: r for r in a['programs']['manifest']}
after_manifest = {r['key']: r for r in b['programs']['manifest']}
assert before_manifest.keys() == after_manifest.keys()
for key, before in before_manifest.items():
    after = after_manifest[key]
    if key in migrations:
        assert {k: v for k, v in before.items() if k not in ('programHash', 'compilerProgramHash')} == {
            k: v for k, v in after.items() if k not in ('programHash', 'compilerProgramHash')}
        assert before['programHash'] != after['programHash']
        assert after['programHash'] == after['compilerProgramHash']
    else:
        assert before == after, f'Unrelated manifest changed: {key}'
changes = {key: {'before': value, 'after': b['versions'][key]}
           for key, value in a['versions'].items() if value != b['versions'][key]}
assert set(changes) <= {'engine', 'sourceHead', 'engineSourceHash', 'loader', 'runner'}, changes
receipt = {
    'baseline': str(baseline.relative_to(root)),
    'baselineSHA256': hashlib.sha256(baseline.read_bytes()).hexdigest(),
    'actualSHA256': hashlib.sha256(actual.read_bytes()).hexdigest(),
    'equal': ['all 16 complete game records and trace hashes', 'catalog/source/defs',
              'decks/admission', 'seeds/move limits/protocol', 'policy/ruleset/errata',
              'summary/measures', 'all other executable fields and 69 unchanged skill programs'],
    'programMigrations': migrations, 'versionChanges': changes,
    'outcomes': b['summary'], 'gameplayExpectationChanges': [],
    'note': 'Six self-combo Autos gain typed metadata through shared compilation. BT6-010 turn qualification moves from a redundant effect guard into event qualification. Compiler controls do not certify production stored records or per-skill exercise.',
}
Path(sys.argv[2]).write_text(json.dumps(receipt, indent=2) + '\n')
print('All 16 exact game traces preserved; only six enumerated combo program migrations; 69 unchanged programs.')
