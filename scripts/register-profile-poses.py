"""Register all profile pose variants and regenerate static Metro requires."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest_path = root / 'assets/exercises/heroes/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest = [entry for entry in manifest if 'baseImage' not in entry or entry['id'] == entry['baseImage']]
for entry in manifest:
    entry['baseImage'] = entry['id']
originals = {(entry['movement'], entry['step']): entry['id'] for entry in manifest}
jobs = json.loads((root / 'docs/design/profile-exercise-heroes/generation-results.json').read_text())
for job in jobs:
    for step in (1, 2):
        asset_id = f"{job['key']}-{step}"
        manifest.append({'id': asset_id, 'movement': job['movement'], 'hero': job['hero'], 'file': asset_id+'.jpg', 'step': step, 'baseImage': originals[(job['movement'], step)]})
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
registry_path = root / 'src/exercises/heroIllustrations.ts'
source = registry_path.read_text()
source = source[:source.index('export const heroIllustrations:')]
source += 'export const heroIllustrations: Record<string, ImageSourcePropType> = {\n'
for entry in manifest:
    source += f"  '{entry['id']}': require('../../assets/exercises/heroes/{entry['file']}'),\n"
source += '};\n'
registry_path.write_text(source)
print(f'Registered {len(manifest)} poses')
