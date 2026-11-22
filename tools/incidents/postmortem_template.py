"""Create or update the postmortem template kept in docs/runbooks/postmortems/<file>.md.

The Terraform provider (4.22) creates postmortem templates but can't read them back (empty ID,
400), so the Markdown file is the source of truth and this script upserts it by name. The
incident type comes from terraform/datadog/incidents.tf. Keys come from Secret Manager:

  DD_API_KEY=$(gcloud secrets versions access latest --secret=indowebinar-dd-api-key) \
  DD_APP_KEY=$(gcloud secrets versions access latest --secret=indowebinar-dd-app-key) \
    python3 -I tools/incidents/postmortem_template.py "Partner outage" docs/runbooks/postmortems/partner-outage.md

The template is named "<incident type> postmortem" and is the default for that type.
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://api.datadoghq.com/api/v2/incidents/config"


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None)
    req.add_header("DD-API-KEY", os.environ["DD_API_KEY"])
    req.add_header("DD-APPLICATION-KEY", os.environ["DD_APP_KEY"])
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as res:
        return json.load(res) if res.length != 0 else {}


type_name, path = sys.argv[1], sys.argv[2]
types = [t for t in call("GET", f"{API}/types")["data"] if t["attributes"]["name"] == type_name]
if not types:
    sys.exit(f"no incident type named {type_name!r}; run terraform apply in terraform/datadog first")
type_id = types[0]["id"]
name = f"{type_name} postmortem"
with open(path) as f:
    content = f.read()

query = urllib.parse.urlencode({"filter[incident-type]": type_id})
existing = [t for t in call("GET", f"{API}/postmortem-templates?{query}")["data"] if t["attributes"]["name"] == name]
# is_default is a timestamp: the most recent one is the type's default.
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
body = {"data": {
    "type": "postmortem_templates",
    "attributes": {"name": name, "content": content, "location": "datadog_notebooks", "is_default": now},
    "relationships": {"incident_type": {"data": {"id": type_id, "type": "incident_types"}}},
}}
if existing:
    body["data"]["id"] = existing[0]["id"]
    tpl = call("PATCH", f"{API}/postmortem-templates/{existing[0]['id']}", body)["data"]
else:
    tpl = call("POST", f"{API}/postmortem-templates", body)["data"]
print(f"{name}: {tpl['id']} (incident type {type_id})")
