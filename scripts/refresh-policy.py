"""Build an atomic policy snapshot using the existing, tested Python model."""
import json
from pathlib import Path
from policy_engine import get_policy_payload

root = Path(__file__).resolve().parent.parent
payload = get_policy_payload(force=True)
if not payload.get('index') or len(payload.get('drivers', [])) != 6:
    raise RuntimeError('Incomplete policy payload; retaining existing snapshot')
if all(d.get('freshness') == 'fallback' for d in payload['drivers']):
    raise RuntimeError('All policy sources failed; retaining existing snapshot')
path = root / 'tpi-latest.json'
tmp = path.with_suffix('.tmp')
tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
tmp.replace(path)
print('Policy snapshot updated:', payload['asOf'], payload['status'])
