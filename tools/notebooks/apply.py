"""Create or update the Datadog notebooks kept in docs/runbooks/notebooks/*.json.

The Terraform provider has no notebook resource, so the JSON files are the source of truth and
this script upserts them by name (Notebooks API v1). Keys come from Secret Manager:

  DD_API_KEY=$(gcloud secrets versions access latest --secret=indowebinar-dd-api-key) \
  DD_APP_KEY=$(gcloud secrets versions access latest --secret=indowebinar-dd-app-key) \
    python3 -I tools/notebooks/apply.py docs/runbooks/notebooks/*.json

Prints each notebook's URL. Re-run after editing a JSON file.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://api.datadoghq.com/api/v1/notebooks"
APP = "https://app.datadoghq.com/notebook"


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None)
    req.add_header("DD-API-KEY", os.environ["DD_API_KEY"])
    req.add_header("DD-APPLICATION-KEY", os.environ["DD_APP_KEY"])
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as res:
        return json.load(res)


def upsert(path):
    with open(path) as f:
        attrs = json.load(f)
    found = call("GET", f"{API}?{urllib.parse.urlencode({'query': attrs['name'], 'count': 100})}")["data"]
    existing = [n for n in found if n["attributes"]["name"] == attrs["name"]]
    body = {"data": {"type": "notebooks", "attributes": attrs}}
    if existing:
        nb = call("PUT", f"{API}/{existing[0]['id']}", body)["data"]
    else:
        nb = call("POST", API, body)["data"]
    print(f"{attrs['name']}: {APP}/{nb['id']}")


for p in sys.argv[1:]:
    upsert(p)
