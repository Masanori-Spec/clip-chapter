#!/usr/bin/env python3
"""Independent standard-library XML and byte-span verification with literal frame oracles."""
from pathlib import Path
from fractions import Fraction
import hashlib,json,re,xml.etree.ElementTree as ET
from xml.parsers import expat
ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'artifacts/native'
EXPECTED=json.loads((ROOT/'test/expected-gui.json').read_text())
def rounded(n):return (2*n.numerator+n.denominator)//(2*n.denominator)
def frame(value):
 if value.isdigit():return int(value)
 h,m,s=value.split(':');return rounded((int(h)*3600+int(m)*60+Fraction(s))*30)
def properties(node):return {p.attrib['name']:p.text or ''for p in node.findall('property')}
def timeline(xml):
 root=ET.fromstring(xml);nodes=[n for n in root.findall('tractor')if properties(n).get('shotcut')=='1'];assert len(nodes)==1;return root,nodes[0]
def markers(xml):
 root,tractor=timeline(xml);containers=[n for n in tractor.findall('properties')if n.attrib.get('name')=='shotcut:markers'];assert len(containers)==1
 return [{'text':properties(n)['text'],'start':frame(properties(n)['start']),'end':frame(properties(n)['end'])}for n in containers[0].findall('properties')]
def full_markers(xml):
 _,tractor=timeline(xml);container=next(n for n in tractor.findall('properties')if n.attrib.get('name')=='shotcut:markers')
 return {n.attrib['name']:{'attributes':dict(n.attrib),'properties':[(dict(p.attrib),p.text or '')for p in n]}for n in container}
def marker_span(xml):
 parser=expat.ParserCreate();stack=[];found=[];active=None
 def start(name,attrs):
  nonlocal active
  stack.append(name)
  if name=='properties'and attrs.get('name')=='shotcut:markers':
   assert active is None;active=(parser.CurrentByteIndex,len(stack))
 def end(name):
  nonlocal active
  if active and len(stack)==active[1]:
   start_index=active[0];end_index=xml.find(b'>',parser.CurrentByteIndex)+1;found.append((start_index,end_index));active=None
  stack.pop()
 parser.StartElementHandler=start;parser.EndElementHandler=end;parser.Parse(xml,True);assert len(found)==1;return found[0]
def nonmarkers(data):
 a,b=marker_span(data);return data[:a]+data[b:]
def main():
 before=(ART/'authored.mlt').read_bytes();after=(ART/'patched.mlt').read_bytes();root,tractor=timeline(before)
 profile=root.find('profile');assert profile.attrib['frame_rate_num']=='30'and profile.attrib['frame_rate_den']=='1'
 ids={n.attrib['id']:n for n in root if'id'in n.attrib};occurrences=[]
 for track in tractor.findall('track'):
  playlist=ids[track.attrib['producer']]
  if playlist.tag!='playlist':continue
  position=0
  for item in playlist:
   if item.tag=='blank':position+=frame(item.attrib['length'])
   elif item.tag=='entry':
    first,last=frame(item.attrib['in']),frame(item.attrib['out']);source=properties(ids[item.attrib['producer']]).get('resource','')
    if source.endswith('source.mkv'):occurrences.append({'sourceIn':first,'sourceOut':last,'timelineStart':position})
    position+=last-first+1
 assert occurrences==EXPECTED['occurrences'],occurrences
 assert markers(before)==EXPECTED['existing'];assert sorted(markers(after),key=lambda m:m['text'])==sorted(EXPECTED['markers'],key=lambda m:m['text'])
 assert nonmarkers(before)==nonmarkers(after),'A non-marker byte changed'
 old_markers,new_markers=full_markers(before),full_markers(after)
 for key,value in old_markers.items():assert key in new_markers and new_markers[key]==value,'Existing marker key/color/properties changed'
 receipt=json.loads((ART/'receipt.json').read_text());assert [m['title']for m in receipt['excluded']]==EXPECTED['excluded']
 shifted=(ART/'shifted.mlt').read_bytes();negative_expected=[dict(m)for m in EXPECTED['markers']]
 for m in negative_expected:
  if m['text']==EXPECTED['negative']['text']:m['start']=m['end']=EXPECTED['negative']['wrongStart']
 assert sorted(markers(shifted),key=lambda m:m['text'])==sorted(negative_expected,key=lambda m:m['text']),'Negative must be exactly the intended one-frame shift'
 assert nonmarkers(shifted)==nonmarkers(after)
 shifted_full=full_markers(shifted)
 for key,value in new_markers.items():
  actual=shifted_full[key];assert actual['attributes']==value['attributes']
  assert [(a,t)for a,t in actual['properties']if a['name']not in ['start','end']]==[(a,t)for a,t in value['properties']if a['name']not in ['start','end']]
 try:assert sorted(markers(shifted),key=lambda m:m['text'])==sorted(EXPECTED['markers'],key=lambda m:m['text'])
 except AssertionError:negative_rejected=True
 else:raise AssertionError('Independent oracle accepted shifted marker')
 report={'status':'PASS','independentParser':'Python standard-library ElementTree and Expat byte indices','literalOccurrences':occurrences,'literalMarkers':EXPECTED['markers'],'nonMarkerBytesUnchanged':True,'existingMarkerKeysColorsPropertiesUnchanged':True,'negativeIsExactIntendedShift':True,'nonMarkerSHA256':hashlib.sha256(nonmarkers(before)).hexdigest(),'originalMLTSHA256':hashlib.sha256(before).hexdigest(),'patchedMLTSHA256':hashlib.sha256(after).hexdigest(),'shiftedMarkerRejected':negative_rejected}
 (ART/'independent-patch-report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
