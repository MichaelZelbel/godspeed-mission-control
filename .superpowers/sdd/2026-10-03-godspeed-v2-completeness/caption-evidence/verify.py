from pathlib import Path
import json
from PIL import Image
p=Path('.superpowers/sdd/2026-10-03-godspeed-v2-completeness/caption-evidence')
words=json.loads((p/'fictional.words.json').read_text())
spoken='This is a fictional caption test. A little red rocket flies above the moon. We keep the original audio and check every word.'
assert ' '.join(w['w'].strip() for w in words).casefold()==spoken.casefold()
assert all(0<=w['s']<w['e']<=9.103 for w in words)
# Compare text pixels to known flat source colour in this fictional fixture only.
im=Image.open(p/'visible-3.5.png').convert('RGB'); bg=im.getpixel((0,0))
pixels=[(x,y) for y in range(1300,1750) for x in range(1080) if max(abs(im.getpixel((x,y))[c]-bg[c]) for c in range(3))>50]
assert pixels
bounds=(min(x for x,y in pixels),min(y for x,y in pixels),max(x for x,y in pixels),max(y for x,y in pixels))
assert bounds[0]>=90 and bounds[2]<=990,bounds
(p/'verification.json').write_text(json.dumps({'spoken_text_matches_actual_transcription':True,'word_count':len(words),'time_range':[words[0]['s'],words[-1]['e']],'caption_pixels_3_5_seconds':bounds,'frame_inspection':'A LITTLE RED / ROCKET FLIES, ROCKET active amber; outline and shadow visible'},indent=2))

