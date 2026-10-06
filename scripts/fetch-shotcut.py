#!/usr/bin/env python3
"""Fetch only the exact official pinned Shotcut distribution in hosted CI."""
from pathlib import Path
import hashlib,json,os,tarfile,urllib.request,urllib.parse
ROOT=Path(__file__).resolve().parents[1]
PIN=json.loads((ROOT/'scripts/shotcut-release.json').read_text())
HOSTS={'api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'}
def allowed(url):
 p=urllib.parse.urlsplit(url)
 return p.scheme=='https'and p.hostname in HOSTS and p.port in (None,443)and not p.username and not p.password
class RestrictedRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,msg,headers,newurl):
  if not allowed(newurl):raise RuntimeError('Unexpected vendor download redirect; stopped before following')
  return super().redirect_request(request,fp,code,msg,headers,newurl)
def main():
 assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_TEMP'),'Official consumer runs only in hosted CI'
 folder=Path(os.environ['RUNNER_TEMP'])/'clip-chapter-shotcut';folder.mkdir(exist_ok=True)
 opener=urllib.request.build_opener(RestrictedRedirect())
 with opener.open(urllib.request.Request(PIN['releaseAPI'],headers={'Accept':'application/vnd.github+json','User-Agent':'ClipChapter-native-gate'}),timeout=60)as response:release=json.loads(response.read(2*1024*1024))
 assert release['tag_name']=='v'+PIN['version']and not release['draft']and not release['prerelease']
 asset=next(a for a in release['assets']if a['name']==PIN['asset']['name'])
 assert asset['browser_download_url']==PIN['asset']['url']and asset['size']==PIN['asset']['size']and asset['digest']=='sha256:'+PIN['asset']['sha256']
 archive=folder/PIN['asset']['name'];digest=hashlib.sha256();size=0
 assert allowed(PIN['asset']['url'])
 with opener.open(PIN['asset']['url'],timeout=180)as response,archive.open('wb')as out:
  assert allowed(response.url)
  while chunk:=response.read(1024*1024):
   size+=len(chunk);assert size<=PIN['asset']['size'];digest.update(chunk);out.write(chunk)
 assert size==PIN['asset']['size']and digest.hexdigest()==PIN['asset']['sha256'],'Official binary mismatch; extraction/execution blocked'
 with tarfile.open(archive)as tar:tar.extractall(folder,filter='data')
 candidates=[p for p in folder.rglob('shotcut')if p.is_file()and p.parent.name=='Shotcut.app']
 assert len(candidates)==1,f'Expected one official launcher: {[str(p)for p in folder.rglob("shotcut")]}'
 art=ROOT/'artifacts/native';art.mkdir(parents=True,exist_ok=True)
 (folder/'launcher.txt').write_text(str(candidates[0].resolve()))
 (art/'official-consumer-pin.json').write_text(json.dumps({**PIN,'actualBytes':size,'actualSHA256':digest.hexdigest(),'metadataAndBytesVerifiedBeforeExecution':True},indent=2)+'\n')
 print(f'Official Shotcut {PIN["version"]} exact txz verified before extraction: {digest.hexdigest()}')
if __name__=='__main__':main()
