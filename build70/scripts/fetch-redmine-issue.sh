#!/usr/bin/env bash
# Fetches Wei Li's data-loading comment from a Redmine issue and extracts:
#   - dataset name
#   - manualDelivery path
#   - ApiCommonDatasets commit URL
#   - ApiCommonPresenters commit URL
#
# Usage:
#   ./fetch-redmine-issue.sh [--json] <ticket-number|redmine-url>
#
# Requires: REDMINE_SESSION env var (cookie value from browser devtools)
# Or pass cookie inline: REDMINE_SESSION=xxx ./fetch-redmine-issue.sh 53517

set -euo pipefail

JSON=0
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--json" ]]; then
    JSON=1
  else
    POSITIONAL+=("$arg")
  fi
done

if [[ ${#POSITIONAL[@]} -lt 1 ]]; then
  echo "Usage: $0 [--json] <ticket-number|redmine-url>" >&2
  exit 1
fi

ARG="${POSITIONAL[0]}"

# Accept either a full URL or a bare ticket number
if [[ "$ARG" =~ ^https?:// ]]; then
  URL="$ARG"
  TICKET=$(basename "$ARG")
else
  TICKET="$ARG"
  URL="https://redmine.apidb.org/issues/${TICKET}"
fi

if [[ -z "${REDMINE_SESSION:-}" ]]; then
  echo "Error: set REDMINE_SESSION to your _redmine_session cookie value" >&2
  exit 1
fi

TMPHTML=$(mktemp /tmp/redmine_XXXXXX.html)
trap 'rm -f "$TMPHTML"' EXIT

curl -s "$URL" \
  -H 'User-Agent: Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
  -H "Cookie: _redmine_session=${REDMINE_SESSION}" \
  -H 'Upgrade-Insecure-Requests: 1' \
  -o "$TMPHTML"

export TMPHTML TICKET JSON

python3 - <<'PYEOF'
import os, sys, re, json

ticket  = os.environ['TICKET']
as_json = os.environ['JSON'] == '1'
html    = open(os.environ['TMPHTML']).read()

def err(msg):
    if as_json:
        print(json.dumps({"ticket": ticket, "error": msg}))
    else:
        print(f"Error: {msg}", file=sys.stderr)
    sys.exit(1)

if 'redirected' in html[:500].lower() or ('login' in html[:2000].lower() and 'password' in html[:2000].lower()):
    err("not authenticated — session expired? Check REDMINE_SESSION")

if not re.search(r'rna.?seq', html, re.IGNORECASE):
    if as_json:
        print(json.dumps({"ticket": ticket, "skip": "no RNA-Seq content"}))
    else:
        print(f"skip: {ticket} (no RNA-Seq content)")
    sys.exit(0)

blocks = re.split(r'(?=<h5[^>]*class="[^"]*journal[^"]*")', html)

result = {}
for block in reversed(blocks):
    if 'Wei Li' not in block:
        continue
    text = re.sub(r'<[^>]+>', ' ', block)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&#39;', "'", text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'\s+', ' ', text).strip()

    if 'manualDelivery' not in text and 'rnaSeq_RSRC' not in text:
        continue

    m = re.search(r'(\w+_rnaSeq[^\s_]*_RSRC)', text, re.IGNORECASE)
    if m:
        result['dataset_name'] = m.group(1)

    m = re.search(r'(/eupath/data/\S+)', text)
    if m:
        result['manual_delivery'] = m.group(1).rstrip('.')

    commits = re.findall(r'https://github\.com/VEuPathDB/\S+/commit/[0-9a-f]+', text)
    for c in commits:
        if 'ApiCommonDatasets' in c:
            result['datasets_commit'] = c
        elif 'ApiCommonPresenters' in c:
            result['presenters_commit'] = c

    if result:
        break

if not result:
    err("could not find Wei Li's data-loading comment")

if as_json:
    print(json.dumps({"ticket": ticket, **result}))
else:
    print(f"ticket:           {ticket}")
    for k, v in result.items():
        print(f"{k+':':<20} {v}")
PYEOF
