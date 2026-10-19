# PingFederate Lab

Hands-on notes and a test application from learning **PingFederate 13.1** in a home lab: a Windows Server VM running PingFederate, OpenDJ and Active Directory, and a Node.js relying party on the host. Most notes are written in Bengali.

## Contents

| Path | What it is |
|---|---|
| [PingFederate_Learning_Notes.md](PingFederate_Learning_Notes.md) | Main notes: data stores, password credential validators, HTML Form adapters, selectors, authentication policies, SAML SP connection, SLO, OIDC, plus a Q&A log |
| [PingFederate_Hands-on_Checklist.md](PingFederate_Hands-on_Checklist.md) | Step-by-step build checklist, from data store to OIDC |
| [PingFederate_OIDC_PKCE_Guide.md](PingFederate_OIDC_PKCE_Guide.md) | OIDC with Authorization Code + PKCE (S256), field by field, with tests, JWKS and token introspection exercises |
| `PingFederate_Module*.docx`, `PingFederate_Course_Concepts*.docx` | Course module write-ups (building blocks, certificates, SAML fundamentals) |
| [pingfed-test-app/](pingfed-test-app/) | Node.js/Express relying party: OIDC (code + PKCE, confidential or public client), SAML SP-initiated SSO and Single Logout, a JWKS/introspection "Token lab", diagnostics |
| [labs/](labs/) | Small scripts and sample output for the certificate and SAML modules |
| [sp-metadata.xml](sp-metadata.xml) | SAML metadata of the test app |

## Lab layout

```
Browser ── http://localhost:3000 ── Node test app (host)
   │
   └── https://<vm>:9031 ── PingFederate ── OpenDJ (LDAP 1389) / Active Directory (pingfed.lab)
```

One authentication policy (`lab-main`) uses an HTTP-request-parameter selector (`login=ldap|ad`) to choose an OpenDJ or AD HTML Form adapter. Both end in one policy contract (`lab-contract`), which feeds both the SAML SP connection and the OIDC/OAuth configuration.

## Running the test app

```bash
cd pingfed-test-app
npm install
cp .env.example .env   # set PF_BASE_URL, OIDC_CLIENT_SECRET, ...
npm start              # http://localhost:3000, check /diagnostics
```

## Not in this repo

Passwords, the app's `.env`, private keys and configuration backups are kept local and excluded by `.gitignore`. Hosts, user names and entity IDs in the notes refer to a private lab network.
