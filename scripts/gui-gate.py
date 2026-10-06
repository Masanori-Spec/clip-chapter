#!/usr/bin/env python3
"""Actual official Shotcut GUI authoring, marker table, mouse seek and save/reopen gate."""
from pathlib import Path
import csv,io,json,os,re,subprocess,time,traceback
from PIL import Image,ImageOps
import pyatspi
from gi.repository import GLib

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts/native';ART.mkdir(parents=True,exist_ok=True)
EXPECTED=json.loads((ROOT/'test/expected-gui.json').read_text())
REPORT={'status':'RUNNING','consumer':'Official Shotcut 26.9.27 GUI','checks':[],'markerViews':[],'screenshots':[]}
PROCESS=None
APP=None
MARKER_WINDOW=None
OCR_COUNT=0
FOCUS_SOURCES=[]

def focus_event(event):
 try:
  if event.detail1 or event.type=='focus:':FOCUS_SOURCES.append(event.source)
 except Exception:pass

pyatspi.Registry.registerEventListener(focus_event,'object:state-changed:focused','focus')

def pump_events():
 context=GLib.MainContext.default()
 deadline=time.monotonic()+.3
 while time.monotonic()<deadline:
  while context.pending():context.iteration(False)
  time.sleep(.01)

class MarkerMismatch(AssertionError):
 def __init__(self,message,rows=None):super().__init__(message);self.rows=rows

def command(*args):return subprocess.run(list(args),check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=10).stdout

def key(*keys):command('xdotool','key','--clearmodifiers',*keys);time.sleep(.25)

def type_text(text):command('xdotool','type','--clearmodifiers','--delay','10','--',text);time.sleep(.2)

def walk(node=None,depth=0):
 if node is None:node=pyatspi.Registry.getDesktop(0)
 if depth>35:return
 yield node
 try:
  count=min(node.childCount,5000)
  for i in range(count):yield from walk(node.getChildAtIndex(i),depth+1)
 except Exception:pass

def visible(node):
 try:return node.getState().contains(pyatspi.STATE_SHOWING)
 except Exception:return False

def find(predicate,timeout=12):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  for node in walk(APP):
   try:
    if visible(node)and predicate(node):return node
   except Exception:pass
  time.sleep(.3)
 raise RuntimeError('Expected accessible control not found')

def click(node):
 rect=node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
 if rect.width<=0 or rect.height<=0 or rect.x<0 or rect.y<0:raise RuntimeError('Accessible control has no clickable visible rectangle')
 click_point(rect.x+max(1,rect.width//2),rect.y+max(1,rect.height//2))

def click_point(x,y):
 # Some packaged xdotool versions wait forever for motion at an unchanged point.
 # Read actual pointer coordinates instead, with a bounded exact-position check.
 command('xdotool','mousemove',str(x),str(y))
 deadline=time.monotonic()+2
 while time.monotonic()<deadline:
  position=dict(line.split('=',1)for line in command('xdotool','getmouselocation','--shell').splitlines()if '='in line)
  if position.get('X')==str(x)and position.get('Y')==str(y):break
  time.sleep(.05)
 else:raise RuntimeError(f'Pointer did not reach native control center {x},{y}')
 command('xdotool','click','1');pump_events();time.sleep(.25)

def click_named(name,roles=None):
 node=find(lambda n:n.name.replace('&','')==name and (roles is None or n.getRoleName()in roles));click(node);return node

def dump(label):
 entries=[]
 for i,node in enumerate(walk()):
  if i>14000:break
  try:
   if visible(node):
    entries.append({'role':node.getRoleName(),'name':node.name,'description':node.description,'children':node.childCount})
  except Exception:pass
 (ART/f'{label}-accessibility.json').write_text(json.dumps(entries,indent=2)+'\n')

def screenshot(label):
 path=ART/f'{label}.png';command('scrot','--overwrite',str(path));REPORT['screenshots'].append(path.name)

def wait_file(path,timeout=20):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if path.is_file()and path.stat().st_size>100:
   time.sleep(.6);return
  time.sleep(.2)
 raise RuntimeError(f'GUI did not save {path.name}')

def launch(path=None):
 global PROCESS,APP,MARKER_WINDOW
 MARKER_WINDOW=None;FOCUS_SOURCES.clear()
 assert os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('DISPLAY'),'Hosted Xvfb GUI required'
 launcher=Path(os.environ['RUNNER_TEMP'])/'clip-chapter-shotcut/launcher.txt'
 binary=launcher.read_text().strip()
 env=dict(os.environ,QT_QPA_PLATFORM='xcb',QT_QUICK_BACKEND='software',QT_OPENGL='software',LIBGL_ALWAYS_SOFTWARE='1',QT_LINUX_ACCESSIBILITY_ALWAYS_ON='1',QT_ACCESSIBILITY='1',SDL_AUDIODRIVER='dummy',LC_ALL='C.UTF-8')
 args=[binary,'--noupgrade','--fullscreen','--appdata',str(Path(os.environ['RUNNER_TEMP'])/'clip-chapter-profile')]
 if path:args.append(str(path))
 log=(ART/'shotcut-console.log').open('ab');PROCESS=subprocess.Popen(args,cwd=ART,env=env,stdout=log,stderr=subprocess.STDOUT)
 APP=None
 deadline=time.monotonic()+35
 while time.monotonic()<deadline:
  if PROCESS.poll()is not None:raise RuntimeError(f'Shotcut exited before GUI ready: {PROCESS.returncode}')
  desktop=pyatspi.Registry.getDesktop(0)
  for child in desktop:
   if 'shotcut'in child.name.lower():APP=child;break
  if APP is not None:
   try:
    find(lambda n:n.getRoleName()in ['frame','window'],timeout=2);time.sleep(2)
    window=command('xdotool','search','--onlyvisible','--name','Shotcut').splitlines()[0]
    command('xdotool','windowsize','--sync',window,'1536','1024');command('xdotool','windowmove','--sync',window,'0','0');command('xdotool','windowfocus','--sync',window);time.sleep(.5);return
   except RuntimeError:pass
  time.sleep(.5)
 raise RuntimeError('Shotcut accessibility application did not become ready')

def close_app():
 global PROCESS,APP
 if PROCESS is None:return
 main_window=command('xdotool','search','--onlyvisible','--name','Shotcut').splitlines()[0];command('xdotool','windowfocus',main_window)
 key('ctrl+q')
 try:PROCESS.wait(timeout=15)
 except subprocess.TimeoutExpired:
  dump('unexpected-close');screenshot('unexpected-close');raise RuntimeError('Shotcut did not close cleanly; unexpected prompt')
 PROCESS=None;APP=None;time.sleep(.5)

def open_file(path):
 key('ctrl+o');find(lambda n:n.getRoleName()in ['dialog','file chooser']and n.name=='Open File',timeout=8);key('alt+n','ctrl+a');type_text(str(path));key('Return');time.sleep(2)

def save_as(path):
 main_window=command('xdotool','search','--onlyvisible','--name','Shotcut').splitlines()[0];command('xdotool','windowfocus',main_window)
 if path.exists():raise RuntimeError('Native test save target already exists')
 key('ctrl+shift+s');find(lambda n:n.getRoleName()in ['dialog','file chooser']and n.name=='Save XML',timeout=8);key('alt+n','ctrl+a');type_text(str(path));key('Return');wait_file(path);time.sleep(.5)

def set_frames_format():
 click_named('Settings',['menu','menu item']);click_named('Time Format',['menu','menu item']);click_named('Frames',['check menu item','radio menu item','menu item']);time.sleep(.4)

def current_position():
 # TimeSpinBox's native accessible description is the official Current position tooltip.
 node=find(lambda n:'Current position'in(n.description or '')or n.name=='Current position',timeout=5)
 for candidate in [node]+list(walk(node)):
  try:
   text=candidate.queryText().getText(0,-1).strip()
   if re.fullmatch(r'\d+',text):return int(text),text
  except Exception:pass
  try:
   value=candidate.queryValue().currentValue
   if value>=0:return int(value),str(value)
  except Exception:pass
 raise RuntimeError('Native Current position did not expose an integer frame value')

def pause_player():
 first,_=current_position();time.sleep(.3);second,_=current_position()
 if second!=first:click_named('Play/Pause',['push button'])
 first,_=current_position();time.sleep(.35);second,_=current_position()
 assert first==second,f'Native player did not pause: {first} to {second}'

def seek_source(frame):
 pause_player()
 control=find(lambda n:'Current position'in(n.description or '')or n.name=='Current position')
 click(control);key('ctrl+a');type_text(str(frame));key('Return','Tab')
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  value,_=current_position()
  if value==frame:
   time.sleep(.3);stable,_=current_position()
   if stable==frame:return
  time.sleep(.15)
 raise AssertionError(f'Native seek expected stable frame {frame}, observed {value}')

def marker_panel():
 return find(lambda n:n.getRoleName()=='panel'and n.name=='Markers',timeout=2)

def show_markers():
 global MARKER_WINDOW
 if MARKER_WINDOW:return
 try:MARKER_WINDOW=command('xdotool','search','--onlyvisible','--name','^Markers$').splitlines()[-1]
 except (subprocess.CalledProcessError,IndexError):pass
 try:panel=marker_panel()
 except RuntimeError:
  key('ctrl+shift+6');panel=marker_panel()
 # Qt's scroll-area hierarchy omits the visible Markers children from AT-SPI.
 # Float and enlarge the actual dock, then read its rendered table independently.
 float_button=next((n for n in walk(panel)if n.name=='Float'and visible(n)),None)
 if not MARKER_WINDOW and float_button:click(float_button)
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  try:
   ids=command('xdotool','search','--onlyvisible','--name','^Markers$').splitlines()
   if ids:MARKER_WINDOW=ids[-1];break
  except subprocess.CalledProcessError:pass
  time.sleep(.2)
 if not MARKER_WINDOW:raise RuntimeError('Native Markers floating window not found')
 command('xdotool','windowsize',MARKER_WINDOW,'1000','620');command('xdotool','windowmove',MARKER_WINDOW,'100','30');command('xdotool','windowfocus',MARKER_WINDOW);time.sleep(.5)

def marker_ocr(normalize=True):
 global OCR_COUNT
 OCR_COUNT+=1
 label=f'ocr-markers-{OCR_COUNT:02d}'
 geometry=dict(line.split('=',1)for line in command('xdotool','getwindowgeometry','--shell',MARKER_WINDOW).splitlines()if '='in line)
 x,y,w,h=(int(geometry[k])for k in ['X','Y','WIDTH','HEIGHT'])
 assert w>=900 and h>=600,'Native marker window did not reach readable size'
 raw=ART/f'{label}.png';command('scrot','--overwrite',str(raw))
 crop=Image.open(raw).convert('RGB').crop((x,y,x+w,y+h));crop.save(ART/f'{label}-panel.png')
 # Normalize actual dark-theme pixels only. No generated labels or expected values.
 prepared=(ImageOps.grayscale(crop).point(lambda value:0 if value>150 else 255)if normalize else crop).resize((w*3,h*3))
 path=ART/f'{label}-ocr.png';prepared.save(path)
 result=command('tesseract',str(path),'stdout','--psm','6'if normalize else '11','tsv')
 (ART/f'{label}.tsv').write_text(result)
 words=[]
 for row in csv.DictReader(io.StringIO(result),delimiter='\t'):
  if row['level']!='5'or not row['text'].strip():continue
  words.append({'text':row['text'].strip(),'x':x+int(row['left'])/3,'y':y+int(row['top'])/3,'w':int(row['width'])/3,'h':int(row['height'])/3,'confidence':float(row['conf'])})
 return words,{'x':x,'y':y,'width':w,'height':h,'evidence':label}

def read_table():
 # A Qt focus event can expose the otherwise omitted native table directly.
 # This branch reads actual AT-SPI cells; if unavailable, use rendered pixels.
 pump_events()
 for source in reversed(FOCUS_SOURCES[-30:]):
  node=source
  for _ in range(5):
   try:
    table=node.queryTable();columns={}
    for i in range(table.nColumns):
     name=table.getColumnDescription(i)
     if not name:name=table.getColumnHeader(i).name
     columns[name]=i
    if not all(name in columns for name in ['Color','Name','Start','End','Duration']):raise RuntimeError('Not the native markers table')
    rows=[]
    for i in range(table.nRows):
     values={name:table.getAccessibleAt(i,columns[name]).name for name in ['Name','Start','End']}
     cell=table.getAccessibleAt(i,columns['Name']);rect=cell.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
     if not visible(cell)or rect.width<=0 or rect.height<=0 or rect.x<0 or rect.y<0:raise RuntimeError('Native table cell is not visibly clickable')
     rows.append({'text':values['Name'],'start':int(values['Start']),'end':int(values['End']),'clickX':rect.x+rect.width//2,'clickY':rect.y+rect.height//2})
    if rows:
     _,geometry=marker_ocr();REPORT.setdefault('tableReadMethods',[]).append('Native AT-SPI table reached through real focus event');return rows,geometry
   except Exception:pass
   try:node=node.parent
   except Exception:break
 words,geometry=marker_ocr()
 REPORT.setdefault('tableReadMethods',[]).append('OCR of the actual enlarged native table')
 # Headers and column boundaries come from the actual rendered native table.
 headers={}
 for name in ['Color','Name','Start','End','Duration']:
  matches=[word for word in words if word['text']==name and word['y']<geometry['y']+100]
  if len(matches)!=1:raise RuntimeError(f'Native OCR requires one visible {name} column header: {matches}')
  headers[name]=matches[0]
 if max(word['y']for word in headers.values())-min(word['y']for word in headers.values())>5:raise RuntimeError('Native table headers are not aligned')
 if not headers['Color']['x']<headers['Name']['x']<headers['Start']['x']<headers['End']['x']<headers['Duration']['x']:raise RuntimeError('Unexpected actual native marker column order')
 top=max(word['y']+word['h']for word in headers.values())+1
 # The native tree expands above the fixed bottom edit/toolbar region.
 bottom=geometry['y']+geometry['height']-150
 candidates=[word for word in words if top<=word['y']<bottom and headers['Name']['x']-5<=word['x']<headers['Duration']['x']-5]
 lines=[]
 for word in sorted(candidates,key=lambda word:(word['y']+word['h']/2,word['x'])):
  cy=word['y']+word['h']/2
  line=next((line for line in lines if abs(line['y']-cy)<=5),None)
  if line is None:line={'y':cy,'words':[]};lines.append(line)
  line['words'].append(word)
 rows=[]
 for line in lines:
  cells={}
  for name,next_name in [('Name','Start'),('Start','End'),('End','Duration')]:
   cell=[word for word in line['words']if headers[name]['x']-5<=word['x']<headers[next_name]['x']-5]
   cells[name]=' '.join(word['text']for word in sorted(cell,key=lambda word:word['x']))
   if any(word['confidence']<25 for word in cell):raise RuntimeError(f'Native OCR low confidence: {cell}')
  if not cells['Name']or not re.fullmatch(r'\d+',cells['Start'])or not re.fullmatch(r'\d+',cells['End']):raise RuntimeError(f'Native marker row is not completely readable: {cells}')
  rows.append({'text':cells['Name'],'start':int(cells['Start']),'end':int(cells['End']),'clickX':int(headers['Name']['x']+20),'clickY':int(line['y'])})
 if not rows:raise RuntimeError('Native OCR found no marker rows')
 return rows,geometry

def rename_baseline():
 rows,geometry=read_table()
 assert len(rows)==1 and rows[0]['start']==rows[0]['end']==30,'Expected one GUI-created marker at30'
 click_point(rows[0]['clickX'],rows[0]['clickY'])
 # Read the existing marker label in the actual lower name-edit field, then
 # click those observed pixels. The dock's hidden AT-SPI descendants are unused.
 words,geometry=marker_ocr(normalize=False)
 lower=[word for word in words if word['y']>geometry['y']+geometry['height']-150]
 lines=[]
 for word in sorted(lower,key=lambda word:(word['y']+word['h']/2,word['x'])):
  cy=word['y']+word['h']/2
  line=next((line for line in lines if abs(line['y']-cy)<=5),None)
  if line is None:line={'y':cy,'words':[]};lines.append(line)
  line['words'].append(word)
 matches=[line for line in lines if ' '.join(word['text']for word in sorted(line['words'],key=lambda word:word['x']))==rows[0]['text']]
 if len(matches)!=1:raise RuntimeError('Native name editor label was not uniquely readable')
 line=matches[0];click_point(int(min(word['x']for word in line['words'])+10),int(line['y']))
 key('ctrl+a');type_text('Baseline');key('Tab');time.sleep(.3)
 observed,_=read_table()
 assert [{k:row[k]for k in ['text','start','end']}for row in observed]==EXPECTED['existing'],'Native baseline rename was not visible in the table'

def verify_markers(label,click_all=True):
 show_markers();pause_player()
 rows,geometry=read_table();expected=EXPECTED['markers']
 observed=[{k:row[k]for k in ['text','start','end']}for row in rows]
 if len(rows)!=len(expected)or sorted(observed,key=lambda r:r['text'])!=sorted(expected,key=lambda r:r['text']):raise MarkerMismatch(f'{label}: actual native marker rows mismatch: {observed}',observed)
 seeks=[]
 if click_all:
  for expected_row in expected:
   latest,_=read_table();row=next(r for r in latest if r['text']==expected_row['text'])
   # Real mouse release is essential: keyboard selection alone does not call seekRequested.
   click_point(row['clickX'],row['clickY']);time.sleep(.4)
   position,text=current_position()
   if position!=expected_row['start']:raise MarkerMismatch(f"{label}: click {expected_row['text']} expected playhead{expected_row['start']}, got{position}")
   project=find(lambda n:n.getRoleName()=='page tab'and n.name=='Project')
   if not project.getState().contains(pyatspi.STATE_SELECTED):raise MarkerMismatch('Marker click did not switch to Project')
   seeks.append({'text':expected_row['text'],'expectedFrame':expected_row['start'],'actualFrame':position,'nativePositionText':text,'projectTabSelected':True})
 REPORT['markerViews'].append({'label':label,'rows':observed,'actualMouseClickSeeks':seeks});screenshot(label);dump(label)
 return observed

def author_fixture():
 launch();screenshot('01-startup');dump('01-startup');set_frames_format();open_file(ART/'source.mkv')
 seek_source(0);key('i');seek_source(299);key('o');key('a');time.sleep(2)
 open_file(ART/'source.mkv');seek_source(90);key('i');seek_source(269);key('o');key('a');time.sleep(2)
 click_named('Project',['page tab']);seek_source(30);key('m');time.sleep(.5);show_markers();time.sleep(.5)
 rename_baseline()
 save_as(ART/'authored.mlt');screenshot('02-authored-fixture');dump('02-authored-fixture');close_app();REPORT['checks'].append('Official GUI authored and saved two occurrences plus baseline marker')

def main():
 author_fixture()
 subprocess.run(['node','scripts/convert-fixture.mjs'],cwd=ROOT,check=True,timeout=30)
 subprocess.run(['/usr/bin/python3','scripts/verify-patch.py'],cwd=ROOT,check=True,timeout=30)
 REPORT['checks'].append('Independent literal frames and marker-only byte preservation passed')
 launch(ART/'patched.mlt');time.sleep(1);verify_markers('03-patched-native');save_as(ART/'roundtrip.mlt');key('ctrl+s');time.sleep(.5);close_app()
 launch(ART/'roundtrip.mlt');time.sleep(1);verify_markers('04-native-save-reopen');close_app();REPORT['checks'].append('Native save and fresh-process reopen preserved marker table and mouse-seek frames')
 launch(ART/'shifted.mlt');time.sleep(1)
 try:verify_markers('05-shifted-negative',click_all=False)
 except MarkerMismatch as error:
  negative_expected=[dict(m)for m in EXPECTED['markers']]
  for m in negative_expected:
   if m['text']==EXPECTED['negative']['text']:m['start']=m['end']=EXPECTED['negative']['wrongStart']
  assert error.rows is not None and sorted(error.rows,key=lambda m:m['text'])==sorted(negative_expected,key=lambda m:m['text']),'GUI negative failed for an unintended fault'
  REPORT['negativeObservedRows']=error.rows
  screenshot('05-shifted-negative');dump('05-shifted-negative');REPORT['negativeControl']={'rejected':True,'type':'actual GUI marker frame mismatch','reason':str(error)}
 else:raise AssertionError('Shifted marker negative control was accepted')
 close_app();REPORT['status']='PASS'

if __name__=='__main__':
 try:main()
 except Exception as error:
  REPORT['status']='FAIL';REPORT['reason']=str(error);REPORT['traceback']=traceback.format_exc()
  try:screenshot('failure');dump('failure')
  except Exception:pass
  if PROCESS and PROCESS.poll()is None:PROCESS.terminate()
  raise
 finally:
  (ART/'gui-report.json').write_text(json.dumps(REPORT,indent=2)+'\n');print(json.dumps(REPORT,indent=2))
