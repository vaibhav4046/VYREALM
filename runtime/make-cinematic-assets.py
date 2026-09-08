"""Generate textured raster keyframes for the local cinematic fallback.

These plates are raster composites with grain, rain, bokeh, layered stalls,
cloth texture and a recurring human subject. They are deliberately not SVGs or
Blender primitives, and are not presented as neural-video output.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import random

OUT = Path(__file__).parent / 'assets' / 'cinematic'; OUT.mkdir(parents=True, exist_ok=True)
W, H = 1920, 1080; random.seed(2409)

def gradient(a, b):
    im=Image.new('RGB',(W,H)); px=im.load()
    for y in range(H):
        t=y/(H-1); c=tuple(int(a[i]*(1-t)+b[i]*t) for i in range(3))
        for x in range(W): px[x,y]=c
    return im

def grain(im, amount=18):
    n=Image.new('RGB',(W,H)); p=n.load()
    for y in range(H):
        for x in range(W):
            q=random.randint(-amount,amount); p[x,y]=(128+q,128+q,128+q)
    return Image.blend(im, Image.blend(im,n,.18), .3)

def rain(layer, count=1000):
    d=ImageDraw.Draw(layer,'RGBA')
    for _ in range(count):
        x=random.randrange(W); y=random.randrange(H); l=random.randrange(10,40)
        d.line((x,y,x-7,y+l), fill=(185,215,235,random.randrange(45,125)), width=random.choice([1,1,2]))

def bokeh(layer, count=90):
    d=ImageDraw.Draw(layer,'RGBA'); colors=[(255,125,54,100),(76,191,255,90),(255,214,130,85)]
    for _ in range(count):
        x=random.randrange(-100,W+100); y=random.randrange(70,H-100); r=random.randrange(5,32)
        d.ellipse((x-r,y-r,x+r,y+r),fill=random.choice(colors))

def market(layer, horizon=600):
    d=ImageDraw.Draw(layer,'RGBA')
    for i in range(12):
        x=i*175-80; w=random.randrange(120,220); h=random.randrange(170,350)
        d.rectangle((x,horizon-h,x+w,horizon+180),fill=(10,14,23,238))
        d.polygon((x-24,horizon-h,x+w+24,horizon-h,x+w+3,horizon-h+42,x-3,horizon-h+42),fill=(40,24,43,245))
        for j in range(3):
            cx=x+22+j*46; cy=horizon-h+72+random.randrange(30,110)
            d.rectangle((cx,cy,cx+26,cy+14), fill=random.choice([(255,105,48,225), (75,201,255,215), (255,204,104,215)]))
    d.polygon([(0,H),(0,horizon+95),(W//2,horizon-25),(W,horizon+95),(W,H)],fill=(12,16,23,255))
    for i in range(20):
        x=W//2+(i-10)*70; d.line((W//2,horizon+10,x,H),fill=(65,95,120,90),width=2)

def face(layer,cx,cy,s=1):
    d=ImageDraw.Draw(layer,'RGBA')
    d.ellipse((cx-150*s,cy-245*s,cx+150*s,cy+145*s),fill=(16,14,20,255))
    d.ellipse((cx-108*s,cy-130*s,cx+108*s,cy+138*s),fill=(198,126,92,255))
    d.ellipse((cx-103*s,cy-125*s,cx+110*s,cy+72*s),fill=(215,143,103,255))
    d.polygon([(cx-110*s,cy-100*s),(cx-164*s,cy+10*s),(cx-130*s,cy+172*s),(cx-88*s,cy+62*s)],fill=(22,19,27,248))
    d.polygon([(cx+92*s,cy-90*s),(cx+158*s,cy+32*s),(cx+112*s,cy+168*s),(cx+82*s,cy+45*s)],fill=(19,17,24,248))
    d.line((cx-66*s,cy-27*s,cx-18*s,cy-37*s),fill=(52,28,29,255),width=max(2,int(9*s))); d.line((cx+18*s,cy-37*s,cx+67*s,cy-22*s),fill=(52,28,29,255),width=max(2,int(9*s)))
    for ex in (cx-42*s,cx+42*s):
        d.ellipse((ex-20*s,cy-4*s,ex+20*s,cy+18*s),fill=(244,235,216,255)); d.ellipse((ex-6*s,cy+1*s,ex+7*s,cy+17*s),fill=(20,24,30,255))
    d.line((cx+3*s,cy+4*s,cx-8*s,cy+60*s),fill=(120,66,58,220),width=max(2,int(5*s))); d.arc((cx-40*s,cy+59*s,cx+52*s,cy+112*s),10,165,fill=(95,39,45,255),width=max(2,int(6*s)))
    for _ in range(22):
        x=cx+random.randrange(-135,136)*s; y=cy-random.randrange(100,250)*s
        d.line((x,y,x+random.randrange(-35,35)*s,y+random.randrange(80,240)*s),fill=(34,28,38,190),width=max(1,int(3*s)))

def jacket(layer,cx,top,s=1):
    d=ImageDraw.Draw(layer,'RGBA'); d.polygon([(cx-300*s,top+500*s),(cx-210*s,top+40*s),(cx-95*s,top),(cx+90*s,top),(cx+210*s,top+50*s),(cx+320*s,top+500*s)],fill=(28,42,55,255))
    d.line((cx-75*s,top+15*s,cx-18*s,top+490*s),fill=(166,105,72,210),width=max(2,int(9*s))); d.line((cx+80*s,top+15*s,cx+26*s,top+490*s),fill=(8,14,22,220),width=max(2,int(9*s)))
    for _ in range(1100):
        x=int(cx+random.uniform(-260,260)*s); y=int(top+random.uniform(30,470)*s); d.point((x,y),fill=(100+random.randrange(45),120+random.randrange(40),130+random.randrange(35),random.randrange(45,150)))

def make_one():
    im=grain(gradient((11,15,28),(45,18,30)),20); bg=Image.new('RGBA',(W,H)); market(bg); bokeh(bg); rain(bg); im=Image.alpha_composite(im.convert('RGBA'),bg)
    fg=Image.new('RGBA',(W,H)); jacket(fg,1470,535,1.0); face(fg,1470,420,1.18); return Image.alpha_composite(im,fg).convert('RGB')

def make_two():
    im=grain(gradient((8,13,25),(37,15,24)),18); bg=Image.new('RGBA',(W,H)); market(bg,520); bokeh(bg,70); rain(bg,1400); d=ImageDraw.Draw(bg,'RGBA')
    for x in (170,430,1530,1810): d.rectangle((x,330,x+36,890),fill=(15,18,26,235))
    im=Image.alpha_composite(im.convert('RGBA'),bg); fg=Image.new('RGBA',(W,H)); jacket(fg,1000,375,.72); face(fg,1000,295,.72); d=ImageDraw.Draw(fg,'RGBA'); d.line((900,760,820,1040),fill=(11,17,26,255),width=65); d.line((1110,760,1200,1040),fill=(11,17,26,255),width=65); return Image.alpha_composite(im,fg).convert('RGB')

def make_three():
    im=grain(gradient((8,13,24),(24,26,37)),16); bg=Image.new('RGBA',(W,H)); market(bg,650); bokeh(bg,65); rain(bg,1050); d=ImageDraw.Draw(bg,'RGBA'); d.rectangle((0,0,W,165),fill=(5,8,14,245)); d.rectangle((165,0,220,780),fill=(12,15,22,255)); im=Image.alpha_composite(im.convert('RGBA'),bg); fg=Image.new('RGBA',(W,H)); jacket(fg,700,525,1.0); face(fg,700,405,1.15); return Image.alpha_composite(im,fg).convert('RGB')

for name,fn in [('rain-market-close',make_one),('rain-market-run',make_two),('rain-market-shelter',make_three)]:
    fn().filter(ImageFilter.GaussianBlur(.12)).save(OUT/f'{name}.png',quality=95)
print('generated three textured raster cinematic keyframes')
