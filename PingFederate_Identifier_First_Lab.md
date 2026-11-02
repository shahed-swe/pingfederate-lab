# Identifier First, from scratch: a second, fully separate login chain

A hands-on lab for PingFederate 13.1 on the Docker stack in `docker-lab/`. You build a second OIDC
app and a second authentication chain next to the existing `lab-main` one, so nothing you already
have is touched. Every PingFederate object is created by hand in the admin console.

What you learn:

- what the Identifier First adapter does and, just as important, what it does not do
- how a policy chains adapters and passes the identifier along (Input User ID Mapping)
- how to route a request to one policy and not another (OAuth Client Set selector + Continue)
- how an attribute from the first adapter ends up in the ID token three steps later

## 1. The idea in one picture

```
app2 (http://localhost:3200, client_id pflab-idfirst-app)
  │  /as/authorization.oauth2
  ▼
policy  idfirst-main
  root: selector idfirst-client  "is the request from pflab-idfirst-app?"
        │ yes                                  │ no
        ▼                                      ▼
  id-first  (Identifier First)             Continue → next policy (lab-main keeps serving app1)
  asks ONLY for a username, outputs:
     subject = what was typed
     domain  = part after "@" (empty if none)
        │
  Rule on domain:  equals "pingfed.lab" → ad     otherwise → Success
        │ ad                      │ Success
        ▼                         ▼
  if-ad-form                 if-opendj-form        (HTML Form adapters, username prefilled)
  ad-pcv → Samba AD          opendj-pcv → OpenDJ
        │                         │
        └────────► idfirst-contract ◄──────────┘   (subject, username, email, ..., identifier)
                        │
          grant mapping → access token mapping → OIDC policy idfirst-oidc → ID token + access token
```

### What Identifier First is, and is not

The adapter decides nothing. It shows one input box, and when the user submits it, it hands back
two attributes:

| User types                    | `subject`                      | `domain`      |
|-------------------------------|--------------------------------|---------------|
| `ayesha.rahman`               | `ayesha.rahman`                | (empty)       |
| `karim.hossain@pingfed.lab`   | `karim.hossain@pingfed.lab`    | `pingfed.lab` |

All routing logic lives in the policy, as a Rule on `domain`. The adapters are bricks; the policy is
the only place that holds logic. Add a third directory tomorrow and you add one brick and one rule
line, and `id-first` is untouched.

Other things the adapter gives you:

- a cookie that remembers the last identifiers (Identifier Cookie Lifetime, Maximum Identifiers
  Count), so returning users pick a name instead of typing it
- "Allow Cancelling Identifier Selection": the "use another account" link on that picker
- "Enable Risk Provider": a hook for PingOne Protect to score the user before any credential is
  asked (not used here)
- the username flows to the next adapter through the policy's Input User ID Mapping, so the user
  never types it twice; "Allow Username Edits During Chaining" on the HTML Form decides whether the
  prefilled name is read-only

## 2. Before you start

Running already (see `docker-lab/README.md`):

| Thing                   | Value                                                            |
|-------------------------|------------------------------------------------------------------|
| Admin console           | https://localhost:9999/pingfederate/app, `admin` / `Admin123`    |
| Runtime                 | https://localhost:9031                                           |
| OpenDJ data store / PCV | `opendjds` / `opendj-pcv`  (base `ou=People,dc=pingfed,dc=lab`)  |
| AD data store / PCV     | `adds` / `ad-pcv`  (base `DC=pingfed,DC=lab`)                    |
| Existing chain          | `lab-main` → `lab-contract` → `lab-jwt-atm` → `lab-oidc` → client `pflab-node-app` (app1, :3100) |
| app2                    | `pingfed-test-app2/`, http://localhost:3200, client `pflab-idfirst-app`, secret in its `.env` |

Reuse only the two data stores and the two PCVs. They are directory plumbing, not flow. Everything
else below is new and prefixed `if-` / `idfirst` so the two chains never get confused.

If `pingfed-test-app2` does not exist yet:

```bash
cd pingfederate-lab
rsync -a --exclude node_modules --exclude app.log pingfed-test-app/ pingfed-test-app2/
cd pingfed-test-app2 && ln -s ../pingfed-test-app/node_modules node_modules
# .env: PORT=3200, APP_URL=http://localhost:3200, OIDC_CLIENT_ID=pflab-idfirst-app,
#       OIDC_CLIENT_SECRET=<anything long and random>, SAML_SP_ENTITY_ID=pflab-idfirst-app
npm start
```

## 3. The stages

Each stage ends with a "Check" you can do yourself in the console. The Admin API equivalents are in
section 5 if you want to confirm from a terminal.

### Stage 1: three adapters

Authentication → Integration → IdP Adapters → Create New Instance.

**1a. `id-first`**

| Tab                | Field                                   | Value                               |
|--------------------|-----------------------------------------|-------------------------------------|
| Type               | Instance Name / Instance ID             | `id-first` / `idfirst`              |
|                    | Type                                    | Identifier First Adapter            |
| IdP Adapter        | Identifier Cookie Lifetime (days)       | `30`                                |
|                    | Maximum Identifiers Count               | `5`                                 |
|                    | Allow Cancelling Identifier Selection   | on                                  |
|                    | Identifier Selection Template           | `identifier.first.template.html` (default) |
|                    | Enable Risk Provider                    | off                                 |
| Extended Contract  | (nothing)                               | core attributes are `subject`, `domain` |
| Adapter Attributes | Pseudonym                               | tick `subject`                      |

**1b. `if-opendj-form`**

| Tab                | Field                                   | Value                                              |
|--------------------|-----------------------------------------|----------------------------------------------------|
| Type               | Name / ID / Type                        | `if-opendj-form` / `ifopendjform` / HTML Form IdP Adapter |
| IdP Adapter        | Credential Validators                   | add `opendj-pcv`                                   |
|                    | Challenge Retries                       | `3`                                                |
|                    | Session State                           | None                                               |
|                    | Allow Username Edits During Chaining    | off (prefilled name is read-only)                  |
| Extended Contract  | add                                     | `mail`, `displayName`, `title`, `departmentNumber`, `employeeNumber`, `isMemberOf` |
| Adapter Attributes | Pseudonym                               | tick `username`                                    |

**1c. `if-ad-form`**: same as 1b with Name/ID `if-ad-form` / `ifadform`, validator `ad-pcv`, extended
contract `mail`, `displayName`, `title`, `department`, `employeeNumber`, `memberOf`.

**1d. Fix the AD validator for full addresses.** AD users will type `karim.hossain@pingfed.lab`.
System → Data & Credential Stores → Password Credential Validators → `ad-pcv` → Search Filter:

```
(|(sAMAccountName=${username})(userPrincipalName=${username}))
```

Check: IdP Adapters list shows the three new instances; opening `id-first` → Adapter Attributes shows
`subject` and `domain`.

### Stage 2: policy contract

Authentication → Policies → Policy Contracts → Create New Contract.

| Field               | Value                                                                 |
|---------------------|-----------------------------------------------------------------------|
| Contract Name / ID  | `idfirst-contract` / `idfirstcontract`                                |
| Core                | `subject` (fixed)                                                     |
| Extended            | `username`, `email`, `displayName`, `department`, `groups`, `directory`, `identifier` |

`identifier` is new compared to `lab-contract`: it will carry what the user typed on the first
screen, so you can see Identifier First's output in the token at the end.

Check: contract appears in the list with 7 extended attributes.

### Stage 3: selector (created empty now, filled in Stage 4)

Authentication → Policies → Selectors → Create New Instance.

| Field           | Value                                              |
|-----------------|----------------------------------------------------|
| Name / ID       | `idfirst-client` / `idfirstclient`                 |
| Type            | OAuth Client Set Authentication Selector           |
| Clients         | leave empty for now; the list only shows existing clients |

Check: selector exists. (It is useless until Stage 4 adds the client.)

### Stage 4: OAuth client

Applications → OAuth → Clients → Add Client. The page is long; every field that matters is listed, in
page order. "Leave default" means the PingFederate default ("Use Global Settings" / unchecked / NONE),
which is exactly how app1's client `pflab-node-app` is configured.

**Client identity**

| Field                                   | Value                                                      | Why |
|-----------------------------------------|------------------------------------------------------------|-----|
| Client ID                               | `pflab-idfirst-app`                                        | must equal `OIDC_CLIENT_ID` in app2's `.env` |
| Enabled                                 | on                                                         | |
| Name                                    | Identifier First App                                       | display only |
| Description                             | (optional)                                                 | |
| Client Authentication                   | **Client Secret** → paste `OIDC_CLIENT_SECRET` from `pingfed-test-app2/.env` (do not press Generate) | app2 already knows this secret |
| Client Secret Retention Period          | Use Global Settings                                        | how long an old secret keeps working after rotation |
| Require Signed Requests                 | off                                                        | JAR (signed request objects), later lesson |
| JWKS / JWKS URL                         | empty                                                      | only for private_key_jwt or signed requests |
| Require Pushed Authorization Requests   | off                                                        | PAR, later lesson |
| Require JWT Secured Authorization Response Mode | off                                                | JARM, later lesson |
| Require DPoP                            | off                                                        | sender-constrained tokens, later lesson |
| Redirect URIs                           | `http://localhost:3200/oidc/callback` → Add                | exact match required |
| Allow Authentication API Init           | off                                                        | only for apps using the Authentication API |

**Grants and tokens**

| Field                                   | Value                                                      | Why |
|-----------------------------------------|------------------------------------------------------------|-----|
| Bypass Authorization Approval           | **on**                                                     | no consent screen in the lab; turn off later to see the approval page |
| Restrict Common Scopes                  | off                                                        | all common scopes allowed |
| Exclusive Scopes                        | none                                                       | |
| Authorization Detail Types              | none                                                       | RAR, not used |
| Allowed Grant Types                     | **Authorization Code**, **Refresh Token**                  | implicit and others stay off |
| Restrict Response Types                 | off                                                        | |
| Default Access Token Manager            | `lab-jwt-atm`                                              | |
| Restrict to Default Access Token Manager| off                                                        | |
| Validate Using All Eligible Access Token Managers | off                                              | |
| Persistent Grants Expiration / Idle Timeout / Reuse | Use Global Settings                            | |
| Refresh Token Rolling Policy / Interval / Grace Period | Use Global Settings                        | refresh token lesson later |
| Require Proof Key for Code Exchange (PKCE) | **on**                                                  | app2 always sends `code_challenge` |
| Device Authorization settings           | Use Global Settings                                        | |
| Lockout (max malicious actions)         | Use Global Settings                                        | |

**OpenID Connect**

| Field                                   | Value                                                      | Why |
|-----------------------------------------|------------------------------------------------------------|-----|
| ID Token Signing Algorithm              | **RS256**                                                  | asymmetric; app2 verifies with `/pf/JWKS`. "Default" also resolves to RS256 here. Never HS256 for a browser-facing RP |
| ID Token Key Management Encryption Algorithm | NONE (unchecked)                                      | ID token encryption (JWE), later lesson |
| ID Token Content Encryption Algorithm   | (only appears if the one above is set)                     | |
| Policy                                  | Default now; **`idfirst-oidc` after Stage 6**              | which claims go into the ID token |
| Grant Access to Session Revocation API  | off                                                        | |
| Grant Access to Session Management API  | off                                                        | |
| UserInfo Response Signing Algorithm     | NONE                                                       | `/idp/userinfo.openid` returns plain JSON; app2 reads it as JSON. Set RS256 only if the RP expects a signed JWT (it would then have to verify it) |
| UserInfo Response Encryption Algorithms | NONE                                                       | |
| Pairwise Identifier User Type           | off                                                        | `sub` is the real username; on would give each client a different opaque `sub` |
| Sector Identifier URI                   | empty                                                      | only with pairwise |
| Logout Mode                             | None                                                       | front/back-channel logout is a later lesson |
| Post-Logout Redirect URIs               | `http://localhost:3200/` → Add                             | where PingFederate may send the browser after RP-initiated logout |
| PingAccess Logout Capable               | off                                                        | |
| Request Object Signing Algorithm        | Default                                                    | only used with Require Signed Requests |
| Token Endpoint Authentication Signing Algorithm | Default                                            | only for private_key_jwt |

Save. Then go back to Authentication → Policies → Selectors → `idfirst-client` and add
`pflab-idfirst-app` to its client list. Save.

Check: Clients list shows `pflab-idfirst-app`; the selector shows one client. From a terminal,
`curl -ks -u admin:Admin123 -H 'X-XSRF-Header: PingFederate' https://localhost:9999/pf-admin-api/v1/oauth/clients/pflab-idfirst-app`
should show `requireProofKeyForCodeExchange: true`, `bypassApprovalPage: true`,
`oidcPolicy.idTokenSigningAlgorithm: RS256`.

### Stage 5: grant mapping and access token mapping

**5a. Grant mapping.** Authentication → OAuth → Policy Contract Grant Mapping → pick
`idfirst-contract` → Add Mapping. Attribute Sources: none. Contract Fulfillment:

| Contract    | Source                          | Value      |
|-------------|---------------------------------|------------|
| `USER_KEY`  | Authentication Policy Contract  | `subject`  |
| `USER_NAME` | Authentication Policy Contract  | `username` |

Issuance Criteria: none → Save.

**5b. Add `identifier` to the token manager.** Applications → OAuth → Access Token Management →
`lab-jwt-atm` → Access Token Attribute Contract → add `identifier` → Save. (The mapping in 5c can
only fill attributes the ATM contract has.)

**5c. Access token mapping.** Applications → OAuth → Access Token Mappings. Context
"Authentication Policy Contract: idfirst-contract", Access Token Manager `lab-jwt-atm` → Add Mapping.
Fulfillment, all Source = Authentication Policy Contract, same name on both sides:
`username`, `email`, `displayName`, `department`, `groups`, `directory`, `identifier`. The ATM also
has `title` and `employeeId`; leave them with Source "No Mapping" or map `title` ← `displayName` if
the UI insists on a value.

Check: Access Token Mappings list shows the new row for `idfirst-contract`. If the context dropdown
did not offer the contract, 5a was not saved.

### Stage 6: OIDC policy

Applications → OAuth → OpenID Connect Policy Management → Add Policy.

| Tab                  | Value                                                                                 |
|----------------------|---------------------------------------------------------------------------------------|
| Manage Policy        | Policy ID `idfirst-oidc`, Name "Identifier First OIDC", ATM `lab-jwt-atm`, ID Token Lifetime 5, Include User Info in ID Token on |
| Attribute Contract   | keep `sub`, `email`, `name`, `preferred_username`; delete the other standard claims; add `department`, `directory`, `identifier` |
| Attribute Scopes     | `email` → email; `profile` → name, preferred_username, department, directory, identifier |
| Contract Fulfillment | Source Access Token: `sub` ← username, `email` ← email, `name` ← displayName, `preferred_username` ← username, `department` ← department, `directory` ← directory, `identifier` ← identifier |

Do NOT click "Set as Default"; `lab-oidc` stays the default for app1. Then Applications → OAuth →
Clients → `pflab-idfirst-app` → OpenID Connect → Policy = `idfirst-oidc` → Save.

Check: the client's summary shows policy `idfirst-oidc`.

### Stage 7: the policy

Authentication → Policies → Policies → Add Policy. Name `idfirst-main`, enabled.

1. Root: **Selector** `idfirst-client`. It produces two results, labelled **YES** (the request came
   from a client in the selector's list, i.e. `pflab-idfirst-app`) and **NO** (any other client).
2. **YES** → Authentication Source → IdP Adapter **`id-first`**.
   - Fail → **Done**.
   - Click **Rules** on the `id-first` node: Attribute Name `domain`, Condition **equals**,
     Value `pingfed.lab`, Result `ad`. Tick **Default to Success**. Save. The node now has
     branches `Fail`, `ad`, `Success`.
3. **NO** (request is from some other client) → **Continue**. This means "I am not the policy
   for this request, try the next one", which is how `lab-main` keeps serving app1.
4. `ad` → IdP Adapter **`if-ad-form`**. Click **Options** on it → Input User ID Mapping:
   Source `id-first`, Attribute `subject`. Fail → Done.
5. `Success` → IdP Adapter **`if-opendj-form`**, same Options mapping. Fail → Done.
6. Under `if-ad-form` Success → **Policy Contract** `idfirst-contract` → Contract Fulfillment:

   | Contract      | Source                    | Value         |
   |---------------|---------------------------|---------------|
   | `subject`     | Adapter (if-ad-form)      | `username`    |
   | `username`    | Adapter (if-ad-form)      | `username`    |
   | `email`       | Adapter (if-ad-form)      | `mail`        |
   | `displayName` | Adapter (if-ad-form)      | `displayName` |
   | `department`  | Adapter (if-ad-form)      | `department`  |
   | `groups`      | Adapter (if-ad-form)      | `memberOf`    |
   | `directory`   | Text                      | `ad`          |
   | `identifier`  | **Adapter (id-first)**    | `subject`     |

   The last row is the chaining lesson: two levels down the tree you can still pick `id-first` as a
   source, because every adapter that ran earlier in the policy stays available.

7. Under `if-opendj-form` Success → Policy Contract `idfirst-contract`, same table with source
   `if-opendj-form`, `department` ← `departmentNumber`, `groups` ← `isMemberOf`, `directory` ← `opendj`.
8. Save the policy. In the Policies list, move **`idfirst-main` above `lab-main`**. PingFederate
   walks the trees top to bottom; the Continue branch is what lets the next tree run, so the
   selector-rooted tree must come first.
9. Make sure "IdP Authentication Policies" is enabled at the top of the Policies page (it already is
   for `lab-main`).

Check: the Policies page shows `idfirst-main` first, enabled, with no "incomplete branch" warning.

### Stage 8: test

Use an Incognito window (an existing PingFederate session would skip the screens you want to see).

| #  | Do                                                             | Expect                                                                 |
|----|----------------------------------------------------------------|------------------------------------------------------------------------|
| 1  | http://localhost:3200 → "OIDC: no hint"                        | a page asking for a username only, no password box                     |
| 2  | type `ayesha.rahman`                                           | OpenDJ password form, username prefilled and read-only                 |
| 3  | password `Lab-Pass123!`                                        | profile: `directory: opendj`, `identifier: ayesha.rahman`, groups from OpenDJ |
| 4  | Log out, "OIDC: no hint" again                                 | identifier page now offers `ayesha.rahman` to pick (the cookie)        |
| 5  | "use another account" → `karim.hossain@pingfed.lab`            | AD password form                                                       |
| 6  | password `Lab-Pass123!`                                        | profile: `directory: ad`, `identifier: karim.hossain@pingfed.lab`      |
| 7  | same window, http://localhost:3100 → "OIDC: OpenDJ"            | app1 goes straight to the old OpenDJ form (its `login=ldap` selector), proving the chains are separate |
| 8  | http://localhost:3200/oidc/login?login=ad                      | still the username-only page: the old parameter means nothing here     |
| 9  | type `nobody@pingfed.lab`, any password                        | AD form error after 3 retries → Fail. Identifier First does not check that the user exists |

## 4. What to notice

- **Two screens, one login.** The user never typed the username twice. That is Input User ID Mapping.
- **Routing without a hint.** app1 needed `?login=ad`; app2 reads the domain. Identifier First is
  "home realm discovery" for free.
- **Attributes travel.** `identifier` came from the first adapter, passed through a second adapter and
  a contract, into an access token mapping and an OIDC claim. Five places had to agree on the name.
- **Policy order is logic.** Swap `idfirst-main` below `lab-main` and app2 would hit `lab-main`
  first (whose root selector is `login-selector`, which has a "Not in Request" branch and therefore
  always matches). Order is part of the design, not cosmetics.
- **Continue vs Done.** Done ends the login (success or fail). Continue says "next policy". A
  selector at the root plus Continue on the "No" branch is the standard way to dedicate a policy to
  one client, one IP range, or one SAML SP.

## 5. Checking from a terminal (optional)

```bash
A='admin:Admin123'; H='X-XSRF-Header: PingFederate'; API=https://localhost:9999/pf-admin-api/v1
curl -ks -u $A -H "$H" $API/idp/adapters/idfirst | python3 -m json.tool | head -40        # Stage 1
curl -ks -u $A -H "$H" $API/authenticationPolicyContracts/idfirstcontract                  # Stage 2
curl -ks -u $A -H "$H" $API/authenticationSelectors/idfirstclient                          # Stage 3/4
curl -ks -u $A -H "$H" $API/oauth/clients/pflab-idfirst-app                                # Stage 4/6
curl -ks -u $A -H "$H" $API/oauth/authenticationPolicyContractMappings/idfirstcontract     # Stage 5a
curl -ks -u $A -H "$H" $API/oauth/accessTokenMappings | python3 -c "import sys,json;[print(m['id']) for m in json.load(sys.stdin)]"  # 5c
curl -ks -u $A -H "$H" $API/oauth/openIdConnect/policies/idfirst-oidc                      # Stage 6
curl -ks -u $A -H "$H" $API/authenticationPolicies/default | python3 -c "import sys,json;[print(t['name'], t['enabled']) for t in json.load(sys.stdin)['authnSelectionTrees']]"  # Stage 7 order
docker exec pingfederate tail -f /opt/out/instance/log/audit.log                            # Stage 8: who hit which adapter
```

## 6. If something is off

| Symptom                                                   | Likely cause                                              | Fix                                                        |
|-----------------------------------------------------------|-----------------------------------------------------------|------------------------------------------------------------|
| app2 shows the old OpenDJ form, no username screen        | `idfirst-main` is below `lab-main`, the selector has no client, or `id-first` sits under NO instead of YES | move the policy up; add the client to `idfirst-client` |
| app1 broke too                                            | "No" branch of the selector is Done instead of Continue    | set it to Continue                                         |
| username box on the password form is empty                | Options → Input User ID Mapping not set on the form node  | Stage 7 steps 4/5                                          |
| `karim.hossain@pingfed.lab` → wrong password every time   | `ad-pcv` filter is still `sAMAccountName=${username}`     | Stage 1d                                                   |
| `identifier` missing in the token                         | one of: contract, policy fulfillment, ATM contract, access token mapping, OIDC policy | Stage 2, 7, 5b, 5c, 6 |
| Policy will not save: incomplete branch                   | a Rule added a branch with nothing under it               | give every branch Done, Continue, an adapter or a contract |
| `invalid_client` at app2                                  | secret in PingFederate ≠ `.env`, or redirect URI differs  | Stage 4                                                    |

## 7. Names in one place

| Object               | Name / ID                                  |
|----------------------|--------------------------------------------|
| Adapters             | `id-first`/`idfirst`, `if-opendj-form`/`ifopendjform`, `if-ad-form`/`ifadform` |
| Policy contract      | `idfirst-contract`/`idfirstcontract` (+ `identifier`) |
| Selector             | `idfirst-client`/`idfirstclient` (OAuth Client Set) |
| OAuth client         | `pflab-idfirst-app`, redirect `http://localhost:3200/oidc/callback` |
| Grant mapping        | `idfirst-contract` → USER_KEY/USER_NAME     |
| Access token mapping | context `idfirst-contract` → `lab-jwt-atm` (+ `identifier`) |
| OIDC policy          | `idfirst-oidc` (not default)               |
| Policy               | `idfirst-main`, first in the list          |
| Test users           | OpenDJ `ayesha.rahman`; AD `karim.hossain@pingfed.lab`; password `Lab-Pass123!` |
