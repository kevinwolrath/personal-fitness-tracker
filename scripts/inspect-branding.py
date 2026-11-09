"""Inspect generated resources and make explicitly labeled previews; never operates a device."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib,xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'docs/design/issue-106-branding'
ASSETS=ROOT/'assets/branding'
RES=ROOT/'android/app/src/main/res'
OUT.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ASSETS/'manifest.json').read_text())
for name,digest in manifest['sources'].items():
    assert hashlib.sha256((ASSETS/name).read_bytes()).hexdigest()==digest
report={'kind':'Generated resource inspection; not an installed-device test','sourcesUnchanged':True,'android':[]}
for density,scale in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
    for folder,name,size in [('mipmap','ic_launcher.webp',48),('mipmap','ic_launcher_foreground.webp',108),('mipmap','ic_launcher_monochrome.webp',108),('drawable','notification_icon.png',24),('drawable','splashscreen_logo.png',288)]:
        file=RES/f'{folder}-{density}'/name
        im=Image.open(file)
        assert im.size==(int(size*scale),int(size*scale)),str(file)
        if name in ('notification_icon.png','ic_launcher_foreground.webp','ic_launcher_monochrome.webp'):
            assert im.mode=='RGBA' and im.getchannel('A').getextrema()==(0,255),str(file)
        if name=='notification_icon.png':
            assert all(min(p[:3])>=245 for p in im.get_flattened_data() if p[3]>0),str(file)
        report['android'].append({'file':str(file.relative_to(ROOT)).replace('\\','/'),'size':list(im.size),'mode':im.mode})
colors={n.attrib['name']:n.text.lower() for n in ET.parse(RES/'values/colors.xml').getroot()}
assert colors['iconBackground']=='#1b0835' and colors['splashscreen_background']=='#000000'
xml=(RES/'mipmap-anydpi-v26/ic_launcher.xml').read_text()
assert '<monochrome ' in xml and '<foreground ' in xml and '<background ' in xml
round_xml=(RES/'mipmap-anydpi-v26/ic_launcher_round.xml').read_text()
assert '<monochrome ' in round_xml and '@mipmap/ic_launcher_foreground' in round_xml
report['androidAdaptiveLayers']=True;report['androidColors']=colors
ios=ROOT/'artifacts/issue-106-ios/BodyAnvil/Images.xcassets/AppIcon.appiconset'
contents=json.loads((ios/'Contents.json').read_text()); icon=Image.open(ios/contents['images'][0]['filename'])
assert icon.size==(1024,1024) and icon.mode=='RGB'
report['ios']={'generator':'Actual installed Expo generateUniversalIconAsync','size':list(icon.size),'mode':icon.mode,'contents':contents}
(OUT/'resource-report.json').write_text(json.dumps(report,indent=2)+'\n')

font=ImageFont.load_default(size=15)
sheet=Image.new('RGB',(1120,760),'#eeeeee');draw=ImageDraw.Draw(sheet)
names=['launcher-1024.png','adaptive-foreground.png','adaptive-monochrome.png','notification-small.png','splash-heroes.png','feature-graphic.png']
for i,name in enumerate(names):
    im=Image.open(ASSETS/'generated'/name).convert('RGBA');im.thumbnail((350,300))
    bg=Image.new('RGBA',im.size,'#1b0835' if i<4 else 'black');bg.alpha_composite(im)
    x=10+i%3*370;y=40+i//3*355;sheet.paste(bg.convert('RGB'),(x,y));draw.text((x,y+305),name,fill='black',font=font)
draw.text((10,8),'Deterministic exports — original masters unchanged',fill='black',font=font)
sheet.save(OUT/'export-preview.jpg',quality=95)

sheet=Image.new('RGB',(1000,520),'#eeeeee');draw=ImageDraw.Draw(sheet)
foreground=Image.open(ASSETS/'generated/adaptive-foreground.png')
mono=Image.open(ASSETS/'generated/adaptive-monochrome.png')
for i,(name,radius) in enumerate([('Circle',360),('Squircle',160),('Rounded square',90)]):
    for j,source in enumerate([foreground,mono]):
        canvas=Image.new('RGBA',(1080,1080),'#1b0835');canvas.alpha_composite(source)
        visible=canvas.crop((180,180,900,900));mask=Image.new('L',(720,720));d=ImageDraw.Draw(mask)
        if radius==360:d.ellipse((0,0,719,719),fill=255)
        else:d.rounded_rectangle((0,0,719,719),radius=radius,fill=255)
        visible.putalpha(mask)
        small=visible.resize((48,48),Image.Resampling.LANCZOS)
        # Actual 48px raster enlarged without smoothing to expose small-size legibility.
        big=small.resize((192,192),Image.Resampling.NEAREST)
        x=20+i*330;y=50+j*235
        sheet.paste(big,(x,y),big);draw.text((x,y+195),f'{name} · 48px '+('color' if j==0 else 'themed'),fill='black',font=font)
draw.text((20,10),'Mask resource previews — NOT installed launcher screenshots',fill='black',font=font)
sheet.save(OUT/'mask-preview-48px.png')

before=ROOT/'artifacts/issue-106-native-before/splash.png'
if before.exists():
    sheet=Image.new('RGB',(800,470),'#eeeeee');draw=ImageDraw.Draw(sheet)
    for i,p in enumerate([before,RES/'drawable-mdpi/splashscreen_logo.png']):
        im=Image.open(p).convert('RGB').resize((360,360),Image.Resampling.LANCZOS);sheet.paste(im,(20+i*400,50))
    draw.text((20,10),'Generated native splash resources — not installed screenshots',fill='black',font=font)
    draw.text((20,425),'Before: Expo placeholder / white',fill='black',font=font)
    draw.text((420,425),'After: approved heroes / black',fill='black',font=font)
    sheet.save(OUT/'splash-resource-before-after.jpg',quality=95)
print('PASS: source hashes, 25 Android density resources, adaptive layers/background, opaque iOS catalog; previews saved.')
