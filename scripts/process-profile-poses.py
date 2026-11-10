"""Split generated two-panel sheets without changing poses; record provenance."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
job_file = root / 'docs/design/profile-exercise-heroes/generation-results.json'
jobs = json.loads(job_file.read_text())
for job in jobs:
    source = Path(job['source'])
    image = Image.open(source).convert('RGB')
    width, height = image.size
    job['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    job['sourceDimensions'] = [width, height]
    job['referenceSha256'] = hashlib.sha256((root / job['reference']).read_bytes()).hexdigest()
    if job.get('priorSource'):
        job['priorSourceSha256'] = hashlib.sha256(Path(job['priorSource']).read_bytes()).hexdigest()
    job['outputs'] = []
    for step in (1, 2):
        target = root / f"assets/exercises/heroes/{job['key']}-{step}.jpg"
        pose = image.crop(((step-1)*width//2, 0, step*width//2, height))
        pose.thumbnail((768, 1024), Image.Resampling.LANCZOS)
        pose.save(target, quality=88, optimize=True)
        job['outputs'].append({'file': str(target.relative_to(root)).replace('\\', '/'), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'dimensions': list(pose.size), 'bytes': target.stat().st_size})
job_file.write_text(json.dumps(jobs, indent=2)+'\n')
print(f'Processed {len(jobs)} sequences / {len(jobs)*2} poses')
