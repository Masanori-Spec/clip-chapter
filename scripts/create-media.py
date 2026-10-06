#!/usr/bin/env python3
"""Create only original synthetic fixture media; no user media is read or edited."""
from pathlib import Path
import json,subprocess
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts/native';ART.mkdir(parents=True,exist_ok=True)
chapters=[(30,'Before trim'),(90,'Chapter A'),(156,'Chapter B'),(240,'Chapter C'),(269,'Last included'),(270,'After trim')]
metadata=';FFMETADATA1\n'+''.join(f'\n[CHAPTER]\nTIMEBASE=1/30\nSTART={frame}\nEND={frame+1}\ntitle={name}\n'for frame,name in chapters)
(ART/'chapters.ffmeta').write_text(metadata)
source=ART/'source.mkv'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x257a85:s=320x180:r=30:d=20','-f','ffmetadata','-i',str(ART/'chapters.ffmeta'),'-map_metadata','1','-c:v','ffv1','-an',str(source)],check=True,timeout=90)
probe=subprocess.check_output(['ffprobe','-v','error','-show_chapters','-show_streams','-show_format','-of','json',str(source)],text=True,timeout=30)
(ART/'chapters.json').write_text(probe)
data=json.loads(probe);assert data['format']['start_time']=='0.000000';assert data['streams'][0]['r_frame_rate']=='30/1'
print('Created original 30fps, zero-origin 20-second fixture with chapters')
