"""List every certificate PingFederate holds, with days until expiry (read-only Admin API calls)."""
import datetime as dt
import os
import requests, urllib3

urllib3.disable_warnings()
BASE = 'https://172.22.127.250:9999/pf-admin-api/v1'
S = requests.Session()
S.verify, S.auth = False, (os.environ.get('PF_ADMIN_USER', 'admin'), os.environ['PF_ADMIN_PASSWORD'])
S.headers['X-XSRF-Header'] = 'PingFederate'

STORES = {
    'SSL server': '/keyPairs/sslServer',
    'Signing/decryption': '/keyPairs/signing',
    'SSL client': '/keyPairs/sslClient',
    'Trusted CA': '/certificates/ca',
}
now = dt.datetime.now(dt.timezone.utc)
print(f"{'Store':<20}{'Subject CN':<16}{'Self-signed':<13}{'Expires':<12}{'Days left':>9}  Status")
print('-' * 80)
for store, path in STORES.items():
    items = S.get(BASE + path).json().get('items', [])
    if not items:
        print(f'{store:<20}(none)')
    for c in items:
        exp = dt.datetime.fromisoformat(c['expires'].replace('Z', '+00:00'))
        days = (exp - now).days
        cn = c['subjectDN'].split('CN=')[1].split(',')[0]
        flag = 'EXPIRED' if days < 0 else 'renew soon' if days < 30 else 'ok'
        print(f"{store:<20}{cn:<16}{str(c['subjectDN'] == c['issuerDN']):<13}{exp:%Y-%m-%d}  {days:>9}  {flag}")
