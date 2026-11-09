"""Compose deterministic Playwright evidence, without generating or altering screenshot content.
Run after e2e/gamification.spec.ts: python scripts/issue-73-contact-sheet.py (requires Pillow).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent / 'docs/design/issue-73-gamification'
stages = ['initial-today', 'quest-complete', 'first-achievement', 'level-up', 'milestone', 'achievement-gallery', 'goal-achieved', 'final-progress']
widths = [360, 390, 430]
thumb_w, thumb_h, gap, caption = 160, 360, 12, 28
sheet = Image.new('RGB', (6 * (thumb_w + gap) + gap, 4 * (thumb_h + caption + gap) + gap), '#101519')
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default(size=12)
for i, stage in enumerate(stages):
    for j, width in enumerate(widths):
        n = i * 3 + j
        x, y = gap + (n % 6) * (thumb_w + gap), gap + (n // 6) * (thumb_h + caption + gap)
        img = Image.open(root / f'{width}-{stage}.png').convert('RGB')
        img.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        sheet.paste(img, (x, y))
        draw.text((x, y + thumb_h + 3), f'{width} · {stage}', fill='#F1F3F4', font=font)
sheet.save(root / 'journey-contact-sheet.jpg', quality=92)
print(root / 'journey-contact-sheet.jpg')
