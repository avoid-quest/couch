#!/usr/bin/env python3
"""Check the installed updater through an existing paired Administrator.
COUCH_TOKEN_FILE names a private JSON file containing the existing token.
Usage: python3 check-updater.py http://DEVICE:4100 receipt.json
Requires Manual policy; never stages or installs a release.
"""
import json, os, pathlib, sys, time, urllib.request, urllib.error
base, destination = sys.argv[1:]
token = json.loads(pathlib.Path(os.environ['COUCH_TOKEN_FILE']).read_text())['token']
receipt = {'observations': []}
def call(path, body=None):
    request = urllib.request.Request(base + path, headers={'Authorization': 'Bearer ' + token, 'Origin': base, 'Content-Type': 'application/json'}, data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)
def settled():
    for _ in range(80):
        status, state = call('/api/updates')
        assert status == 200, (status, state)
        if state['status'] != 'checking':
            return state
        time.sleep(0.5)
    raise AssertionError('The installed check did not finish')
try:
    receipt['before'] = settled()
    assert receipt['before']['policy'] == 'manual', 'Keep automatic installation disabled for this check-only test'
    receipt['request'] = call('/api/updates/check', {'check': True})
    assert receipt['request'][0] == 202, receipt['request']
    receipt['after'] = settled()
    assert receipt['after']['currentCheck'] and receipt['after']['status'] != 'failed', receipt['after'].get('error')
    receipt['passed'] = True
finally:
    pathlib.Path(destination).write_text(json.dumps(receipt, indent=2) + '\n')
