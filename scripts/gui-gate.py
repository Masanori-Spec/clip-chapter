#!/usr/bin/env python3
"""Actual official Shotcut GUI authoring, marker table, mouse seek and save/reopen gate."""
from pathlib import Path
import json,os,re,subprocess,time,traceback
import pyatspi

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts/native';ART.mkdir(parents=True,exist_ok=True)
EXPECTED=json.loads((ROOT/'test/expected-gui.json').read_text())
REPORT={'status':'RUNNING','consumer':'Official Shotcut 26.9.27 GUI','checks':[],'markerViews':[],'screenshots':[]}
PROCESS=None
APP=None
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
 command('xdotool','mousemove','--sync',str(rect.x+max(1,rect.width//2)),str(rect.y+max(1,rect.height//2)))
 command('xdotool','click','1');time.sleep(.25)

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
 global PROCESS,APP
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
 key('ctrl+q')
 try:PROCESS.wait(timeout=15)
 except subprocess.TimeoutExpired:
  dump('unexpected-close');screenshot('unexpected-close');raise RuntimeError('Shotcut did not close cleanly; unexpected prompt')
 PROCESS=None;APP=None;time.sleep(.5)

def open_file(path):
 key('ctrl+o');find(lambda n:n.getRoleName()in ['dialog','file chooser']and n.name=='Open File',timeout=8);key('alt+n','ctrl+a');type_text(str(path));key('Return');time.sleep(2)

def save_as(path):
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

def marker_table(timeout=10):
 node=find(lambda n:n.getRoleName()in ['tree table','table','tree']and n.queryTable().nColumns>=3 and any(n.queryTable().getColumnDescription(i)in ['Name','Start'] for i in range(n.queryTable().nColumns)),timeout=timeout)
 return node,node.queryTable()

def show_markers():
 try:marker_table(timeout=1)
 except RuntimeError:
  key('ctrl+shift+6');marker_table(timeout=10)

def read_table():
 node,table=marker_table();columns={}
 for column in range(table.nColumns):
  desc=table.getColumnDescription(column)
  if not desc:
   try:desc=table.getColumnHeader(column).name
   except Exception:pass
  columns[desc]=column
 if not all(k in columns for k in ['Name','Start','End']):raise RuntimeError(f'Unexpected native marker columns {columns}')
 rows=[]
 for row in range(table.nRows):
  values={name:table.getAccessibleAt(row,columns[name]).name for name in ['Name','Start','End']}
  try:rows.append({'text':values['Name'],'start':int(values['Start']),'end':int(values['End']),'row':row})
  except ValueError:raise RuntimeError(f'Markers are not in native Frames display: {values}')
 return node,table,columns,rows

def verify_markers(label,click_all=True):
 show_markers();pause_player()
 node,table,columns,rows=read_table();expected=EXPECTED['markers']
 observed=[{k:row[k]for k in ['text','start','end']}for row in rows]
 if len(rows)!=len(expected)or sorted(observed,key=lambda r:r['text'])!=sorted(expected,key=lambda r:r['text']):raise MarkerMismatch(f'{label}: actual native marker rows mismatch: {observed}',observed)
 seeks=[]
 if click_all:
  for expected_row in expected:
   _,table,columns,latest=read_table();row=next(r for r in latest if r['text']==expected_row['text'])
   # Real mouse release is essential: keyboard selection alone does not call seekRequested.
   click(table.getAccessibleAt(row['row'],columns['Name']));time.sleep(.4)
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
 # Selecting the native row exposes its actual name-edit widget.
 _,table,columns,rows=read_table();assert len(rows)==1,'Expected one GUI-created baseline marker';click(table.getAccessibleAt(0,columns['Name']))
 name_field=find(lambda n:'Set the name for this marker.'in(n.description or ''))
 click(name_field);key('ctrl+a');type_text('Baseline');key('Tab');time.sleep(.4)
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
