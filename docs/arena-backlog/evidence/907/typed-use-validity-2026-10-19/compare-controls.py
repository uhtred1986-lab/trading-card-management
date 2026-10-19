"""Exact frozen gameplay; only independently enumerated kind/usage/validity metadata migrates."""
import copy, hashlib, json, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parents[5]
baseline = root / 'docs/arena-backlog/evidence/907/combo-qualifications-2026-10-19/starter-compiler-pack.json'
actual = Path(sys.argv[1])
a, b = json.loads(baseline.read_text()), json.loads(actual.read_text())
for field in ('inputs', 'catalog', 'protocol', 'decks', 'games', 'pairs', 'interruptions', 'summary', 'measures', 'storedRules'):
    assert a[field] == b[field], f'Frozen {field} changed; investigate, do not rebaseline'
for field in ('ruleset', 'errata'):
    assert a['versions'][field] == b['versions'][field], f'{field} changed'
# The only policy change is the reviewed legality boundary for dependent named
# sets. Keep every ranking/search source byte-identical to the original control.
policy_paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', a['versions']['sourceHead'], '--', 'src/lib/arena/policy'], cwd=root, text=True).splitlines()
assert sorted(policy_paths) == sorted(str(p.relative_to(root)) for p in (root/'src/lib/arena/policy').rglob('*') if p.is_file())
before_policy, after_policy = [], []
old_line = '  const plain = op && op.op === "choose" && op.as === pr.choice.continuation && op.atMost === undefined && op.sumTo === undefined;'
new_line = '  // Named sets narrow the legal pool after each pick (slot and power), so\n  // their dependent count must be answered one fresh engine offer at a time.\n' + old_line.replace('&& op.atMost', '&& !op.namedSet && op.atMost')
for path in policy_paths:
    old = subprocess.check_output(['git', 'show', a['versions']['sourceHead']+':'+path], cwd=root)
    expected_source = old
    if path == 'src/lib/arena/policy/boundary.ts':
        assert old.count(old_line.encode()) == 1
        expected_source = old.replace(old_line.encode(), new_line.encode())
    assert (root/path).read_bytes() == expected_source, f'Unreviewed policy change: {path}'
    before_policy.append([path, hashlib.sha256(old).hexdigest()])
    after_policy.append([path, hashlib.sha256(expected_source).hexdigest()])
tree_digest = lambda files: hashlib.sha256(json.dumps(files, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
assert tree_digest(before_policy) == a['versions']['policy']
assert tree_digest(after_policy) == b['versions']['policy'], 'Policy pin must describe the actual reviewed source'
expected = copy.deepcopy(a['programs']['scripts'])
limited = {'SD15-01/back/10': (True, None), 'SD15-02/front/0': (False, 1),
           'SD15-03/front/20': (False, 1), 'SD5-04/front/10': (True, None)}
manifest = {r['key']: r for r in a['programs']['manifest']}
migrations = []
for card, saved in expected.items():
    card_id, side = (card[:-5], 'back') if card.endswith('#back') else (card, 'front')
    for index, program in saved['bySkill'].items():
        keys = [k for k, r in manifest.items() if r['cardId'] == card_id and r['side'] == side and str(r['skillIndex']) == index]
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
assert set(changes) <= {'engine','sourceHead','engineSourceHash','loader','runner','policy'}, changes
receipt = dict(baseline=str(baseline.relative_to(root)), baselineSHA256=hashlib.sha256(baseline.read_bytes()).hexdigest(),
    actualSHA256=hashlib.sha256(actual.read_bytes()).hexdigest(),
    equal=['all 16 complete game records and trace hashes', 'catalog/source/defs','decks/admission',
           'seeds/move limits/protocol','all policy ranking/search sources','ruleset/errata','summary/measures','all existing executable fields'],
    migratedPrograms=migrations, limitedPrograms=limited, sparkingPrograms={'BT5-023/front/10':5},
    versionChanges=changes, outcomes=b['summary'], gameplayExpectationChanges=[],
    policyChange='Only the exact reviewed namedSet legality projection: ask for one fresh offer per dependent pick. No ranking/search change or strength promotion.',
    note='Persisted kind plus explicit usage/validity v1 metadata added; dependent-choice boundary separately pinned. Compiler controls do not certify actual production records or per-skill exercise.')
Path(sys.argv[2]).write_text(json.dumps(receipt,indent=2)+'\n')
print(f'All 16 exact game traces preserved; {len(migrations)} metadata-only program migrations.')
