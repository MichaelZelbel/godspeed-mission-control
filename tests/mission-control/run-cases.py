"""Run real cold Hermes cases. No mock model responses or external writes."""
from pathlib import Path
import concurrent.futures
import json
import os
import shutil
import subprocess
import time

KIT = Path('C:/hub/dev/teach-it-once-kit-mission-control')
ROOT = Path('C:/Users/micha/AppData/Local/Temp/tio-mission-control-cases')
EVIDENCE = Path('C:/hub/dev/ownward-studio-mission-control/company-memory/book/chapter-verification/mission-control-raw')
EVIDENCE.mkdir(parents=True, exist_ok=True)
PROMPT = (KIT / 'tests/mission-control/prompt.txt').read_text(encoding='utf-8')

def run(case):
    folder = ROOT / case
    prompt = PROMPT.replace(str(ROOT / 'normal').replace('\\', '/'), str(folder).replace('\\', '/'))
    env = dict(os.environ)
    env.pop('HERMES_HOME', None)
    start = time.time()
    result = subprocess.run(['hermes', 'chat', '--oneshot', '--safe-mode', '-Q', '--provider', 'openai-codex', '-m', 'gpt-6-astra', '-t', 'file,terminal,web', '--max-turns', '18', '--run-budget', '240', '-q', prompt], env=env, cwd=str(folder), text=True, encoding='utf-8', errors='replace', capture_output=True, timeout=290)
    (EVIDENCE / (case + '.txt')).write_text(result.stdout + '\nSTDERR\n' + result.stderr, encoding='utf-8')
    metadata = {'case': case, 'exit_code': result.returncode, 'start_epoch': start, 'end_epoch': time.time(), 'output_exists': (folder/'output/decision.md').exists()}
    (EVIDENCE / (case + '.json')).write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    if metadata['output_exists']:
        shutil.copyfile(folder/'output/decision.md', EVIDENCE/(case+'.md'))
    return metadata

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(run, ['missing', 'priority', 'source-failure']):
            print(json.dumps(result), flush=True)
