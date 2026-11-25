"""Submit exactly the strips and five-slot request used by Rollout Studio."""
import argparse
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urljoin, urlsplit

SPACE = 'https://noahhowa-image-stitch-fork.hf.space'


def curl(url, *args, timeout=120):
    return subprocess.check_output(
        ['curl','--fail-with-body','--silent','--show-error','--connect-timeout','15',
         '--max-time',str(timeout),*args,url])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('strips',type=Path)
    parser.add_argument('result',type=Path)
    args = parser.parse_args()
    paths = sorted(args.strips.glob('strip_*.jpg'))
    if not 3 <= len(paths) <= 5:
        raise ValueError(f'Expected three to five strips, found {len(paths)}')
    job_path = args.result.with_suffix('.job.json')
    if job_path.is_file():
        job_id = json.loads(job_path.read_text())['event_id']
    else:
        upload_args = [item for p in paths for item in ('-F',f'files=@{p};type=image/jpeg')]
        uploaded = json.loads(curl(f'{SPACE}/gradio_api/upload?upload_id=adjust{time.time_ns()}', *upload_args))
        items = [{'path':p,'url':None,'size':None,'orig_name':'strip.jpg',
                  'mime_type':'image/jpeg','is_stream':False,'meta':{'_type':'gradio.FileData'}} for p in uploaded]
        if len(items)!=len(paths):
            raise RuntimeError(f'Unexpected upload result: {uploaded}')
        payload = json.dumps({'data':items+[None]*(5-len(items))})
        job = json.loads(curl(f'{SPACE}/gradio_api/call/process_images','-H','Content-Type: application/json',
                              '--data-binary',payload))
        job_id = job['event_id']
        job_path.write_text(json.dumps(job)+'\n')
    print(args.strips.name,'job',job_id,flush=True)
    events = curl(f'{SPACE}/gradio_api/call/process_images/{job_id}', timeout=150).decode()
    args.result.with_suffix('.events.txt').write_text(events)
    for block in events.strip().split('\n\n'):
        if not block.startswith('event: complete\n'):
            continue
        result = json.loads(block.partition('\ndata: ')[2])[0]
        if not isinstance(result,dict):
            raise RuntimeError(f'Unexpected stitch result: {result}')
        url = urljoin(SPACE,result.get('url') or '/gradio_api/file='+result['path'])
        if urlsplit(url).hostname != urlsplit(SPACE).hostname:
            raise RuntimeError('Unexpected file origin from stitching Space')
        args.result.write_bytes(curl(url))
        print(args.result, args.result.stat().st_size, 'bytes', flush=True)
        return
    raise RuntimeError(f'Hugging Face returned no image: {events[-1000:]}')


if __name__=='__main__':
    main()
