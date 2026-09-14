"""Create a print-layout proof, not the production PDF export engine."""
from pathlib import Path
import math
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/storyboard-print-study.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path('/System/Library/Fonts/Supplemental')
def register_font(label, wanted, fallback):
    # Select by embedded face name rather than assuming TTC ordering.
    for index in range(16):
        try:
            font=TTFont(label, '/System/Library/Fonts/Avenir Next.ttc', subfontIndex=index)
            face=font.face.name
            if isinstance(face,bytes):face=face.decode('utf-8')
            if face==wanted:
                pdfmetrics.registerFont(font)
                print(label,face)
                return
        except Exception:
            continue
    pdfmetrics.registerFont(TTFont(label,str(FONT_DIR/fallback)))
register_font('Sans','AvenirNext-Regular','Arial.ttf')
register_font('SansMedium','AvenirNext-Medium','Arial.ttf')
register_font('SansBold','AvenirNext-DemiBold','Arial Bold.ttf')
register_font('SansItalic','AvenirNext-Italic','Arial Italic.ttf')

c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
c.setTitle('Teaser - storyboard print layout study')
c.setAuthor('Storyboard design study for Big Trimpy')
c.setSubject('A4 print layout with schematic artwork; not approved production boards')
W,H=A4
M=48
CW=W-2*M

def text(x,y,s,font='Sans',size=10,gray=.14):
    c.setFillGray(gray);c.setFont(font,size);c.drawString(x,y,s)

def right(x,y,s,font='Sans',size=9,gray=.4):
    c.setFillGray(gray);c.setFont(font,size);c.drawRightString(x,y,s)

def tracked(x,y,s,size=8,gray=.35):
    t=c.beginText(x,y);t.setFont('SansMedium',size);t.setCharSpace(.8);t.setFillGray(gray);t.textOut(s);t.setCharSpace(0);c.drawText(t)

def line(x1,y1,x2,y2,gray=.78,width=.5):
    c.setStrokeGray(gray);c.setLineWidth(width);c.line(x1,y1,x2,y2)

def path(points,gray=.35,width=.7,close=False):
    p=c.beginPath();p.moveTo(*points[0])
    for point in points[1:]:p.lineTo(*point)
    if close:p.close()
    c.setStrokeGray(gray);c.setLineWidth(width);c.drawPath(p,stroke=1,fill=0)

def frame(x,top,w,kind):
    h=w/2.39;y=top-h
    c.saveState()
    clip=c.beginPath();clip.rect(x,y,w,h);c.clipPath(clip,stroke=0,fill=0)
    c.translate(x,y);c.scale(w/600,h/251)
    if kind=='island':
        # Deliberately schematic coastline; not a map or proposed production design.
        for offset in [0,4]:
            points=[]
            for i in range(101):
                a=i/100*math.tau
                r=1+.11*math.sin(3*a)+.05*math.cos(7*a)
                points.append((310+(75+offset)*r*math.cos(a),119+(27+offset*.4)*r*math.sin(a)))
            path(points,.3 if offset==0 else .7,.75 if offset==0 else .45,True)
        path([(260,119),(283,132),(298,127),(321,142),(339,128),(361,123)],.43,.6)
        path([(276,116),(302,120),(319,134),(333,119),(349,117)],.57,.5)
        for yy,xx,length in [(49,48,100),(63,416,123),(89,104,66),(163,397,109),(185,178,68),(211,387,72)]:
            path([(xx,yy),(xx+length*.22,yy+1.5),(xx+length*.55,yy-1),(xx+length,yy+.5)],.68,.45)
        for dx,dy in [(-18,174),(392,201),(33,21)]:
            p=c.beginPath();p.moveTo(dx,dy);p.curveTo(dx+25,dy+20,dx+54,dy+15,dx+87,dy+8);p.curveTo(dx+115,dy+5,dx+152,dy+14,dx+192,dy+4)
            c.setStrokeGray(.68);c.setLineWidth(1);c.drawPath(p)
            p=c.beginPath();p.moveTo(dx+22,dy-9);p.curveTo(dx+65,dy+1,dx+101,dy-7,dx+159,dy-4);c.setLineWidth(.5);c.drawPath(p)
    else:
        # Anonymous blocking figure. Character reference art is not yet available.
        if kind=='medium':
            cx,cy,rx,ry=300,160,31,40
            body=[(228,-12),(234,76),(269,100),(283,111),(283,125)]
            other=[(317,125),(317,111),(331,100),(366,76),(372,-12)]
        else:
            cx,cy,rx,ry=300,140,65,87
            body=[(153,-32),(197,8),(247,22),(264,53)]
            other=[(336,53),(353,22),(403,8),(447,-32)]
        c.setStrokeGray(.28);c.setLineWidth(1.2);c.ellipse(cx-rx,cy-ry,cx+rx,cy+ry,stroke=1,fill=0)
        path(body,.32,1.2);path(other,.32,1.2)
        if kind=='medium':
            path([(269,100),(298,85),(331,100)],.52,.65)
            path([(253,74),(258,12)],.65,.55);path([(349,74),(342,12)],.65,.55)
        else:
            # Only the acting cue; no claimed character likeness.
            p=c.beginPath();p.moveTo(278,109);p.curveTo(290,98,309,98,322,109)
            c.setStrokeGray(.32);c.setLineWidth(1.2);c.drawPath(p)
        # A faint vertical construction line communicates centred blocking.
        c.setDash(2,5);line(300,0,300,251,.82,.45);c.setDash()
    c.restoreState()
    c.setStrokeGray(.64);c.setLineWidth(.45);c.rect(x,y,w,h,stroke=1,fill=0)
    return y

text(M,H-69,'Teaser',font='SansMedium',size=36,gray=.1)
tracked(M,H-91,'STORYBOARD / SCENE 01',size=8)
right(W-M,H-48,'10 SEPTEMBER 2026',size=8,gray=.35)
right(W-M,H-64,'LAYOUT STUDY 02',size=8,gray=.35)
line(M,H-112,W-M,H-112,.8,.45)

text(M,704,'01',font='SansMedium',size=20,gray=.5)
text(M+39,706,'Island',font='SansMedium',size=14,gray=.12)
right(W-M,708,'AERIAL',font='SansMedium',size=8,gray=.35)
bottom=frame(M,686,CW,'island')
text(M,bottom-17,'01A',font='SansBold',size=8.5)
text(M+39,bottom-17,'A small island in a vast ocean.',size=10)
tracked(M,bottom-44,'CAMERA',size=7.5)
text(M+78,bottom-44,'Flying through wispy clouds.',size=10.5)
line(M,406,W-M,406,.84,.4)

text(M,380,'02',font='SansMedium',size=20,gray=.5)
text(M+39,382,'Matilda',font='SansMedium',size=14,gray=.12)
right(W-M,384,'CONTINUOUS SHOT / 2 PANELS',font='SansMedium',size=8,gray=.35)
gap=20;pw=(CW-gap)/2
bottom2=frame(M,362,pw,'medium')
frame(M+pw+gap,362,pw,'close')
text(M,bottom2-17,'02A',font='SansBold',size=8.5)
text(M+32,bottom2-17,'Medium shot. Centred.',size=9.5)
text(M+pw+gap,bottom2-17,'02B',font='SansBold',size=8.5)
text(M+pw+gap+32,bottom2-17,'Close-up. Smiling.',size=9.5)

tracked(M,215,'CAMERA',size=7.5)
text(M+78,215,'Dolly forward from panel A to panel B.',size=10.5)
tracked(M,191,'ACTION',size=7.5)
text(M+78,191,'Matilda smiles as the camera moves closer.',size=10.5)
tracked(M,151,'DIALOGUE',size=7.5)
text(M+78,151,'No dialogue supplied for this layout study.',font='SansItalic',size=10.5,gray=.4)

line(M,87,W-M,87,.8,.45)
text(M,70,'Layout proof. Schematic figures are not approved character designs.',size=8,gray=.4)
tracked(M,43,'PENCIL / 2.39:1',size=7.5)
right(W-M-31,43,'SCENE 01',size=7.5,gray=.4)
right(W-M,41,'01',font='SansMedium',size=14,gray=.12)
c.showPage();c.save()
print(OUT)
