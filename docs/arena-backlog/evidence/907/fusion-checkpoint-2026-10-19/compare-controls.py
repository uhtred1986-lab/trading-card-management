import json,sys,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[5]
before=root/'docs/arena-backlog/evidence/907/typed-payment-2026-10-19/starter-compiler-pack.json'
after=Path(sys.argv[1])
a=json.loads(before.read_text());b=json.loads(after.read_text())
for field in ('inputs','protocol','decks','games','programs','summary','measures'):
 assert a[field]==b[field], f'Frozen {field} changed; investigate, do not rebaseline'
for field in ('policy','ruleset','errata','runner'):
 assert a['versions'][field]==b['versions'][field],f'{field} changed'
r={'baseline':str(before.relative_to(root)),'baselineSHA256':hashlib.sha256(before.read_bytes()).hexdigest(),'actualSHA256':hashlib.sha256(after.read_bytes()).hexdigest(),'baselineVersions':a['versions'],'actualVersions':b['versions'],'equal':['catalog/source/defs/owner-specified costs','decks/complete admission records','seeds/move limits/protocol','all16 complete game records and trace hashes','all75 executable programs and manifest','summary/measures','policy/ruleset/errata/runner'],'outcomes':b['summary'],'expectationChanges':[],'note':'Compiler-mode controls, not production stored-mode qualification. Loader source difference from prior frozen pack includes #1066 authoring-only guard already disclosed in its receipt; exact executable programs and games equal.'}
Path(sys.argv[2]).write_text(json.dumps(r,indent=2)+'\n')
print('All16 full game records and75 programs exactly preserved; no expectation rebaseline.')
