# PingFed Lab App

A small Node.js app that logs in through PingFederate, so you can test adapters, selectors and policies.

- **OpenID Connect:** authorization code flow with PKCE. The app verifies the ID token signature and calls the UserInfo endpoint.
- **SAML 2.0:** SP-initiated login. The AuthnRequest goes over HTTP-Redirect and the signed Response comes back over HTTP-POST to `/saml/acs`. IdP-initiated login also works.
- **Adapter switch:** each login button adds `login=ldap|local|radius` to the request. The PingFederate selector `pflablogin` reads it and the `pflab-main` policy runs the matching adapter. The `adapter` / `auth_adapter` claim shows which adapter actually ran.

## Quick start

```bash
npm install
cp .env.example .env              # then edit PF_BASE_URL if the VM IP changed
node setup-pingfed.js             # dry run: shows what it would change in PingFederate
node setup-pingfed.js --apply     # creates/updates the PingFederate objects, writes the client secret and pingfed-signing.crt
npm start                         # http://localhost:3000
```

Open http://localhost:3000/diagnostics first. Every check should be **OK**.

## What `setup-pingfed.js` configures

| Step | Object | Why |
|---|---|---|
| federation | Base URL `https://<VM>:9031`, SAML entity ID `pingfed-lab-idp` | Endpoints, issuer and metadata must be reachable from the laptop |
| signing | Signing key pair `pflabsigning`, exported to `pingfed-signing.crt` | Signs SAML assertions; the app verifies with the exported certificate |
| adapterfix | `htmlformopendj`: username from the adapter, email from LDAP `mail` | It used `emailAddress`, which doesn't exist in OpenDJ, so username came back empty |
| apc | Policy contract `pflab-app` (subject, email, username, adapter) | Standard output of every login path |
| selector | `pflablogin` (HTTP Request Parameter `login`) | Picks the path |
| policy | Tree `pflab-main`; IdP authentication policies switched on; `login` tracked | ldap → htmlformopendj, local → htmlformsimplepcv, radius → htmlformradius; anything else → htmlformopendj |
| oauthserver | Scopes `profile`, `email`; grant attributes `email`, `adapter` | |
| atm | Access token manager `pflabatm` (reference tokens) | |
| mappings | Contract → persistent grant → access token | |
| oidc | OIDC policy `pflaboidc` (sub, email, preferred_username, auth_adapter) | ID token claims |
| client | OAuth client `pflab-node-app` (code + PKCE, secret saved to `.env`) | |
| spconnection | SAML SP connection `pflab-node-app`, ACS `http://localhost:3000/saml/acs` | |

Run a single step with `--only=`, e.g. `node setup-pingfed.js --apply --only=client`.

## Testing ideas

| Test | How | What to look for |
|---|---|---|
| Each adapter | The OIDC/SAML buttons for ldap, local, radius | `auth_adapter` / `adapter` claim |
| Session reuse | Log in with ldap, then click "local" | You aren't prompted: htmlformopendj has a global session. Use **Custom request → prompt=login** to force a new login. |
| Wrong password | Wrong password on any form | Error on the form; for RADIUS, event 6273 on the VM |
| Fallback path | Custom request with `login=xyz` | "No Match" branch → OpenDJ form |
| Token types | Profile page | Reference access token (opaque) vs ID token (JWT) |
| SAML assertion | Profile → Raw → SAML Response | Signature, Conditions, AttributeStatement |
| New adapter or selector | Add a branch in the PingFederate policy, then use **Custom request** | |

## Notes
- `PF_TLS_INSECURE=true` skips TLS verification **only for calls to PingFederate**, because the lab certificate is self-signed `CN=localhost`. Set it to `false` once PingFederate has a certificate your laptop trusts.
- If the VM IP changes, update `PF_BASE_URL` in `.env` and rerun `node setup-pingfed.js --apply --only=federation`.
- The RADIUS path also depends on the VM IP. The `radiuspcv` hostname and the NPS RADIUS client must match the VM's current address.
