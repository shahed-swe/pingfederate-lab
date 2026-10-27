# PingFederate 13.1.3 on Docker (lab stack)

This folder is the Docker version of the lab: PingFederate + OpenDJ + Samba AD, configured for `../pingfed-test-app`.
Copy `.env.example` to `.env`, put your `PingFederate-13.1-Development.lic` here (it is gitignored), then `docker compose up -d`.

Local PingFederate instance using the official `pingidentity/pingfederate` image
and the `PingFederate-13.1-Development.lic` license in this folder.

## Start / stop

```bash
docker compose up -d        # start (first boot takes ~1 min)
docker compose logs -f      # follow logs
docker compose stop         # stop, keep data
docker compose down         # remove container, keep data volume
docker compose down -v      # remove container AND wipe all config (fresh install)
```

## URLs

| What | URL |
|---|---|
| Admin console | https://localhost:9999/pingfederate/app |
| Admin REST API | https://localhost:9999/pf-admin-api/v1 (Swagger: https://localhost:9999/pf-admin-api/api-docs) |
| Runtime engine | https://localhost:9031 |
| OIDC discovery | https://localhost:9031/.well-known/openid-configuration |
| Heartbeat | https://localhost:9031/pf/heartbeat.ping |

The TLS certificate is self-signed; accept the browser warning.

## Credentials

| User | Password |
|---|---|
| admin | Admin123 (set by `PF_ADMIN_USERNAME` / `PF_ADMIN_PASSWORD` in `.env`) |

The admin account is only created on the very first boot. Changing
`PF_ADMIN_USERNAME` or `PF_ADMIN_PASSWORD` later has no effect unless you `docker compose down -v`
and start fresh. Change the password in the console instead.

Admin API example:

```bash
curl -k -u admin:Admin123 -H "X-XSRF-Header: PingFederate" \
  https://localhost:9999/pf-admin-api/v1/version
```

## License

The license file is bind-mounted read-only into the container and copied to
`server/default/conf/pingfederate.lic` on every start, so replacing the `.lic`
file in this folder and restarting is all that is needed when it is renewed.

Current license: ID 01134916, K53tech.COM, PingFederate 13.1, free/developer tier,
expires **2026-11-04**.

## Persistence

All server config and data live in the named Docker volume
`pingfed_pingfederate-data` (mounted at `/opt/out` inside the container).
It survives restarts and `docker compose down`.

## Files

- `docker-compose.yml` – the stack definition
- `.env` – image tag, admin username/password, host ports
- `hooks/83-configure-admin.sh` – image hook, patched so the initial admin username comes from `ROOT_USER`
- `PingFederate-13.1-Development.lic` – your license

## Directories (OpenDJ + Active Directory)

Both run in the same compose stack and are reachable from PingFederate by service name.

| Directory | Container | From this Mac | Bind account | Base DN |
|---|---|---|---|---|
| OpenDJ 5.1.2 | `opendj` (`opendj:1389` inside Docker) | ldap://localhost:1389, ldaps://localhost:1636 | `cn=Directory Manager` / `OPENDJ_ADMIN_PASSWORD` | `dc=pingfed,dc=lab` |
| Samba AD DC (stands in for Windows AD) | `samba-ad` (`samba-ad:389` inside Docker) | ldap://localhost:10389, ldaps://localhost:10636 | `CN=Administrator,CN=Users,DC=pingfed,DC=lab` / `AD_ADMIN_PASSWORD` | `DC=pingfed,DC=lab` (realm PINGFED.LAB) |

Lab users (all can log in through either protocol; `login=ldap` -> OpenDJ, `login=ad` -> AD):

| Directory | Login | Password | Name | Title / Department | Groups |
|---|---|---|---|---|---|
| OpenDJ | `ayesha.rahman` | `Lab-Pass123!` | Ayesha Rahman | Software Engineer / Engineering | lab-users |
| OpenDJ | `rahim.uddin` | `Lab-Pass123!` | Rahim Uddin | IAM Analyst / Security | lab-users, lab-admins |
| OpenDJ | `farhan.ahmed` | `Farhan#2026` | Farhan Ahmed | Product Manager / Product | lab-users |
| OpenDJ | `sadia.khan` | `Sadia#2026` | Sadia Khan | QA Engineer / Engineering | lab-users |
| OpenDJ | `tanvir.hasan` | `Tanvir#2026` | Tanvir Hasan | DevOps Engineer / Infrastructure | lab-users, lab-admins |
| OpenDJ | `mitu.akter` | `Mitu#2026` | Mitu Akter | Finance Analyst / Finance | lab-users |
| AD | `karim.hossain` | `Lab-Pass123!` | Karim Hossain | Network Engineer / Infrastructure | lab-users, lab-admins |
| AD | `nadia.islam` | `Lab-Pass123!` | Nadia Islam | HR Manager / Human Resources | lab-users |
| AD | `rafiq.islam` | `Rafiq#2026` | Rafiq Islam | Security Analyst / Security | lab-users, lab-admins |
| AD | `sumaiya.chowdhury` | `Sumaiya#2026` | Sumaiya Chowdhury | Marketing Lead / Marketing | lab-users |
| AD | `imran.kabir` | `Imran#2026` | Imran Kabir | Support Engineer / Customer Support | lab-users |
| AD | `lamia.haque` | `Lamia#2026` | Lamia Haque | Data Analyst / Analytics | lab-users |

- OpenDJ users come from `directories/opendj/users.ldif`, imported once on first start.
- AD users are created by `directories/ad/10-users.sh` on every start (idempotent). Edit it and `docker compose restart samba-ad` to add more.
- Samba runs with `INSECURE_LDAP=true` so PingFederate can simple-bind over plain LDAP. Lab only.

## Lab app + OIDC flow

`setup-oidc-lab.js` configures PingFederate for `../pingfed-test-app` through the Admin API,
following `../PingFederate_OIDC_PKCE_Guide.md`:

| Object | Name / ID |
|---|---|
| LDAP data stores | `opendjds`, `adds` |
| Credential validators | `opendj-pcv`, `ad-pcv` (LDAP, expose mail/displayName/title/department/employee number/groups) |
| HTML Form adapters | `opendj-form`, `ad-form` |
| Selector | `login-selector` (HTTP request parameter `login` = `ldap` or `ad`) |
| Policy | `lab-main` (ldap -> OpenDJ form, ad -> AD form, anything else -> OpenDJ) -> contract `lab-contract` |
| Access token manager | `lab-jwt-atm` (JWT, RS256, centralized key, 60 min) |
| OIDC policy | `lab-oidc` (default; sub, email, name, preferred_username, title, department, groups, directory) |
| OAuth client | `pflab-node-app` (confidential, Authorization Code + Refresh, PKCE S256 required, redirect `http://localhost:3100/oidc/callback`) |

Re-run (idempotent) after changing anything:

```bash
OIDC_CLIENT_SECRET=<secret from ../pingfed-test-app/.env> PF_ADMIN_PASSWORD=Admin123 node setup-oidc-lab.js
```

Run the app (its `.env` is already written for port 3100):

```bash
cd ../pingfed-test-app && npm start      # http://localhost:3100  (diagnostics: /diagnostics)
```

All six checks on /diagnostics pass (OIDC and SAML).

## SAML (SP connection + Single Logout)

`setup-saml-lab.js` does checklist parts 1.2, 3.2 and 5.2 through the Admin API:

| Object | Value |
|---|---|
| IdP entity ID | `pingfed-lab-idp` (System > Protocol Settings > Federation Info) |
| IdP signing key | `pflabsigning` "PingFed Lab Signing", exported to `pingfed-test-app/pingfed-signing.crt` |
| App signing key | `pingfed-test-app/sp-signing.key` / `sp-signing.crt` (self-signed, generated with openssl); imported into the SP connection as the verification certificate |
| SP connection | `pflab-node-app`: SP/IdP-initiated SSO + SLO, ACS POST `http://localhost:3100/saml/acs`, SLO Redirect+POST `http://localhost:3100/saml/slo`, assertions signed, attributes from `lab-contract` |
| Sessions | Track Adapter Sessions for Logout = on (needed for SLO to end the adapter session) |

```bash
PF_ADMIN_PASSWORD=Admin123 node setup-saml-lab.js   # idempotent; re-exports pingfed-signing.crt
```
