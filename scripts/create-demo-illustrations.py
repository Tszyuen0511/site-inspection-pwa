from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

# Neutral, explicitly fictional illustrations for PDF layout QA; no reference
# photographs, project drawings or corporate assets are copied.
out = Path('tmp/pdfs')
out.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 27)
small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)
for index in range(1, 10):
    image = Image.new('RGB', (1200, 800), '#eef2f3')
    d = ImageDraw.Draw(image)
    d.rectangle((0,0,1200,75), fill='#25394d')
    d.text((35,23), 'FICTIONAL DEMONSTRATION ILLUSTRATION', font=font, fill='white')
    if index < 7:
        d.rectangle((0,76,1200,360),fill='#d9e9f3')
        d.polygon([(0,360),(300,320),(660,350),(950,305),(1200,360),(1200,740),(0,740)],fill='#d2c3a3')
        for n in range(8):
            x=180+n*100
            d.polygon([(x,220),(x+50,240),(x+50,570),(x,550)],fill='#809bb3',outline='#36516c',width=3)
            d.polygon([(x+50,240),(x+100,220),(x+100,550),(x+50,570)],fill='#b5c7d8',outline='#36516c',width=3)
        d.line((80,620,1100,620),fill='#556e4d',width=5)
        d.text((80,650), f'Demo observation {index:02d} - illustrative geometry only',font=font,fill='#314253')
    elif index < 9:
        d.rectangle((70,140,1130,650),fill='#c6a678',outline='#6b5741',width=10)
        for row in range(3):
            y=185+row*145
            d.rectangle((90,y-15,1110,y+105),fill='#e5d4b7',outline='#8f795d',width=5)
            for n in range(12):
                x=120+n*80
                d.ellipse((x,y,x+65,y+65),fill=['#a9a08c','#b0ada0','#888d88'][row],outline='#70695b',width=3)
        d.text((85,680),f'Demo sample box {index-6} of 2 - not a real core sample',font=font,fill='#314253')
    else:
        d.rectangle((60,105,1140,660),fill='white',outline='#687b8c',width=3)
        for x in range(100,1140,80): d.line((x,110,x,650),fill='#e0e5e9',width=2)
        for y in range(140,650,80): d.line((65,y,1135,y),fill='#e0e5e9',width=2)
        d.polygon([(240,150),(880,180),(1040,580),(200,610)],outline='#5b748b',width=5)
        for n,(x,y) in enumerate([(350,250),(620,260),(850,320),(420,470),(740,500)]):
            color=['#9ac78f','#e99b8e','#8eb0d7'][n%3]
            d.ellipse((x-28,y-28,x+28,y+28),fill=color,outline='#526778',width=3)
            d.text((x-48,y+38),f'DEMO-{n+1}',font=small,fill='#314253')
        d.text((80,690),'Illustrative progress plan - no real project coordinates',font=font,fill='#314253')
    d.rectangle((0,750,1200,800),fill='white')
    d.text((35,764),'For layout demonstration only. Not a site photograph or approved drawing.',font=small,fill='#6a7582')
    image.save(out/f'demo-image-{index}.jpg', quality=88)
