"""Exact frozen gameplay; only independently enumerated kind/usage/validity metadata migrates."""
import copy, hashlib, json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[5]
baseline = root / 'docs/arena-backlog/evidence/907/combo-qualifications-2026-10-19/starter-compiler-pack.json'
actual = Path(sys.argv[1])
a, b = json.loads(baseline.read_text()), json.loads(actual.read_text())
for field in ('inputs', 'catalog', 'protocol', 'decks', 'games', 'pairs', 'interruptions', 'summary', 'measures', 'storedRules'):
    assert a[field] == b[field], f'Frozen {field} changed; investigate, do not rebaseline'
for field in ('policy', 'ruleset', 'errata'):
    assert a['versions'][field] == b['versions'][field], f'{field} changed'
expected = copy.deepcopy(a['programs']['scripts'])
limited = {'SD15-01/back/10': (True, None), 'SD15-02/front/0': (False, 1),
           'SD15-03/front/20': (False, 1), 'SD5-04/front/10': (True, None)}
manifest = {r['key']: r for r in a['programs']['manifest']}
migrations = []
for card, saved in expected.items():
    for index, program in saved['bySkill'].items():
        keys = [k for k, r in manifest.items() if r['cardId'] == card and str(r['skillIndex']) == index]
        assert len(keys) == 1, (card, index, keys)
        key = keys[0]
        once, limit = limited.get(key, (False, None))
        program['kind'] = manifest[key]['kind']
        program['usage'] = dict(version=1, oncePerTurn=once, limit=limit)
        program['validity'] = dict(version=1, sparking=5 if key == 'BT5-023/front/10' else None)
        migrations.append(key)
assert expected == b['programs']['scripts'], 'Executable change outside exact typed kind/usage/validity migration'
after = {r['key']: r for r in b['programs']['manifest']}
assert manifest.keys() == after.keys()
for key, before in manifest.items():
    new = after[key]
    skip = ('programHash', 'compilerProgramHash')
    assert {k:v for k,v in before.items() if k not in skip} == {k:v for k,v in new.items() if k not in skip}, key
    assert new['programHash'] == new['compilerProgramHash']
changes = {k: {'before':v, 'after':b['versions'][k]} for k,v in a['versions'].items() if v != b['versions'][k]}
assert set(changes) <= {'engine','sourceHead','engineSourceHash','loader','runner'}, changes
receipt = dict(baseline=str(baseline.relative_to(root)), baselineSHA256=hashlib.sha256(baseline.read_bytes()).hexdigest(),
    actualSHA256=hashlib.sha256(actual.read_bytes()).hexdigest(),
    equal=['all 16 complete game records and trace hashes', 'catalog/source/defs','decks/admission',
           'seeds/move limits/protocol','policy/ruleset/errata','summary/measures','all existing executable fields'],
    migratedPrograms=migrations, limitedPrograms=limited, sparkingPrograms={'BT5-023/front/10':5},
    versionChanges=changes, outcomes=b['summary'], gameplayExpectationChanges=[],
    note='Only persisted kind plus explicit usage/validity v1 metadata added. Compiler controls do not certify actual production records or per-skill exercise.')
Path(sys.argv[2]).write_text(json.dumps(receipt,indent=2)+'\n')
print(f'All 16 exact game traces preserved; {len(migrations)} metadata-only program migrations.')
