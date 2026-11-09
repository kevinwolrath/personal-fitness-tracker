"""Non-destructive #106 exports. Requires Pillow; never writes approved source PNGs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import hashlib
import json
from collections import deque

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets/branding'
OUT = ASSETS / 'generated'
BG = '#1b0835'
SOURCES = {
    'body-anvil-approved-female-launcher-original.png': '48cdd6f32a6c647e75573862826359c06726c75e91d5d40c836556aeab251656',
    'body-anvil-approved-female-launcher-1024.png': 'cf67841fadeb0872b35de136c7b2894e7cbcd83c36ba58caace17fe6c6fb542a',
    'body-anvil-approved-heroes.png': 'c9a5bfba44110236c793ceef9acbc6c2e653b1607c25374654dca1cdb3b4a1bf',
}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(im, name):
    im.save(OUT / name, optimize=True)

def build():
    for name, expected in SOURCES.items():
        if sha(ASSETS / name) != expected:
            raise ValueError(f'Approved source bytes changed: {name}')
    OUT.mkdir(parents=True, exist_ok=True)
    original = Image.open(ASSETS / 'body-anvil-approved-female-launcher-original.png').convert('RGB')
    heroes = Image.open(ASSETS / 'body-anvil-approved-heroes.png').convert('RGB')
    # Remove only the near-black exterior connected to source corners. No character pixels are repainted.
    launcher = original.copy()
    exterior = Image.new('RGB', original.size)
    exterior.putdata([(0, 0, 0) if max(p) <= 12 else (255, 255, 255) for p in original.get_flattened_data()])
    ImageDraw.floodfill(exterior, (0, 0), (128, 128, 128), thresh=0)
    mask = exterior.convert('L').point(lambda v: 255 if v == 128 else 0)
    launcher.paste(BG, mask=mask)
    save(launcher.resize((1024, 1024), Image.Resampling.LANCZOS), 'launcher-1024.png')
    save(launcher.resize((512, 512), Image.Resampling.LANCZOS).convert('RGBA'), 'store-icon-512.png')
    for size in (16, 32, 48, 192):
        save(launcher.resize((size, size), Image.Resampling.LANCZOS), f'favicon-{size}.png')

    # 64% artwork width inside Android's 108dp foreground canvas. Hair and chest emblem stay inside safe zone.
    foreground = Image.new('RGBA', (1080, 1080))
    art = launcher.convert('RGBA')
    edge = Image.new('L', art.size)
    ImageDraw.Draw(edge).rectangle((40, 40, art.width-41, art.height-41), fill=255)
    art.putalpha(edge.filter(ImageFilter.GaussianBlur(16)))
    art = art.resize((692, 692), Image.Resampling.LANCZOS)
    foreground.alpha_composite(art, (194, 194))
    save(foreground, 'adaptive-foreground.png')

    # Source-derived female bust/ponytail silhouette, with the original chest emblem knocked out.
    silhouette = Image.new('L', original.size)
    draw = ImageDraw.Draw(silhouette)
    draw.polygon([(65,1240),(96,1030),(150,870),(230,746),(340,660),(431,600),(479,511),(485,455),(467,375),(490,295),(541,226),(610,191),(704,156),(798,105),(851,80),(833,122),(824,173),(851,228),(887,316),(907,404),(887,464),(849,506),(827,558),(840,607),(901,677),(970,741),(1034,823),(1090,954),(1155,1240)], fill=255)
    draw.polygon([(146,756),(112,690),(137,594),(202,472),(249,381),(281,280),(318,208),(383,174),(452,163),(516,177),(554,205),(513,274),(480,352),(460,458),(417,555),(326,650),(249,704)], fill=255)
    emblem = Image.new('L', original.size)
    crop = original.crop((670,735,1000,910))
    glyph = Image.new('L', crop.size)
    glyph.putdata([max(0,min(255,(min(p)-180)*4)) for p in crop.get_flattened_data()])
    # Keep the connected emblem, excluding small costume-outline fragments in the crop.
    remaining={(x,y) for y in range(glyph.height) for x in range(glyph.width) if glyph.getpixel((x,y))>128}
    largest=set()
    while remaining:
        seed=remaining.pop(); component={seed}; queue=deque([seed])
        while queue:
            x,y=queue.popleft()
            for n in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if n in remaining:
                    remaining.remove(n); component.add(n); queue.append(n)
        if len(component)>len(largest): largest=component
    selection=Image.new('L',crop.size)
    for p in largest: selection.putpixel(p,255)
    glyph=ImageChops.multiply(glyph,selection.filter(ImageFilter.MaxFilter(3)))
    emblem.paste(glyph, (670,735))
    silhouette = ImageChops.subtract(silhouette, emblem)
    mono = Image.new('RGBA', (1080,1080))
    bust = Image.new('RGBA', original.size, 'white'); bust.putalpha(silhouette)
    mono.alpha_composite(bust.resize((692,692),Image.Resampling.LANCZOS), (194,194))
    save(mono, 'adaptive-monochrome.png')
    # A notification glyph is a small white-alpha export of the approved chest emblem, not a launcher logo.
    glyph = glyph.crop(glyph.getbbox())
    glyph.thumbnail((80, 64),Image.Resampling.LANCZOS)
    small = Image.new('RGBA',(96,96)); white = Image.new('RGBA',glyph.size,'white'); white.putalpha(glyph)
    small.alpha_composite(white,((96-glyph.width)//2,(96-glyph.height)//2))
    save(small,'notification-small.png')

    save(heroes.resize((1024,1024),Image.Resampling.LANCZOS),'splash-heroes.png')
    for name, size in [('feature-graphic.png',(1024,500)),('website-heroes.png',(1600,900))]:
        canvas=Image.new('RGB',size,'black'); art=heroes.copy(); art.thumbnail(size,Image.Resampling.LANCZOS)
        canvas.paste(art,((size[0]-art.width)//2,(size[1]-art.height)//2));save(canvas,name)
    exports=[]
    for path in sorted(OUT.glob('*.png')):
        im=Image.open(path)
        exports.append({'file':path.name,'size':list(im.size),'mode':im.mode,'sha256':sha(path)})
    (ASSETS/'manifest.json').write_text(json.dumps({'version':1,'background':BG,'sources':SOURCES,'exports':exports},indent=2)+'\n')
    for name, expected in SOURCES.items():
        assert sha(ASSETS/name)==expected
    print(f'Built {len(exports)} exports; approved masters unchanged.')

if __name__ == '__main__':
    build()
