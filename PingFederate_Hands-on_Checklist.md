# PingFederate হাতে-কলমে চেকলিস্ট (শূন্য থেকে SAML + OIDC SSO)

**লক্ষ্য:** নিজের হাতে PingFederate কনফিগার করা — দুই ডিরেক্টরি (OpenDJ আর Active Directory), selector দিয়ে রাস্তা বাছাই, একটা policy contract — তারপর `pingfed-test-app` দিয়ে SAML আর OIDC দুইভাবে লগইন করে যাচাই করা।

কিছু নাম (যেমন `pflab-node-app`, `pingfed-lab-idp`) টেস্ট অ্যাপের সাথে মিলিয়ে রাখা হয়েছে। এগুলো বদলালে অ্যাপের `.env` ফাইলও বদলাতে হবে।

প্রতিটা ধাপে আছে:
- **কেন:** এর কাজ কী
- **কোথায়:** প্যানেলের কোন জায়গা
- **কী করবে:** কোন ঘরে কী বসাবে
- **✔ যাচাই:** ঠিক হলো কি না কীভাবে বুঝবে

বিস্তারিত ব্যাখ্যা আর প্রতিটা প্রশ্নের উত্তর: `PingFederate_Learning_Notes.md`। সব পাসওয়ার্ড: `lab-credentials.txt`।

> **হালনাগাদ (২০২৬-১০-১৫):** যা আসলে বানানো হয়েছে সেই অনুযায়ী নতুন করে লেখা — AD, selector, বড় contract, SLO আর OIDC যোগ হয়েছে। `[x]` = শেষ।

---

## পর্ব ০: VM আর সার্ভিস

### - [x] 0.1 VM এর IP আর নেটওয়ার্ক
- **কেন:** ভুল IP বা ভুল নেটওয়ার্ক মোডে কিছুই খুলবে না।
- **জেনে রাখো:**
  - VM চলে **VMware Workstation** এ (`G:\VMS\WS\Windows Server 2019 (2).vmx`)
  - Network Adapter অবশ্যই **Bridged** (NAT হলে VM অন্য নেটওয়ার্কে চলে যায়)
  - IP **স্থির**: `192.168.0.29` (gateway/DNS এখন VM নিজেই, কারণ এটা domain controller)
- **✔ যাচাই:** ল্যাপটপের ব্রাউজারে `https://192.168.0.29:9999/pingfederate/app` খুলে admin দিয়ে লগইন হয়।

### - [x] 0.2 সার্ভিসগুলো চালু আছে কি না
- **কী করবে:** VM এ (`PINGFED\shahed` দিয়ে লগইন) `services.msc` → **OpenDJ Server**, **PingFederate**, আর AD এর সার্ভিস (Active Directory Domain Services, DNS, Kerberos KDC) Running।
- **জেনে রাখো:**
  - **OpenDJ:** port **1389** (389 এখন AD এর), base `ou=limbosoft,dc=pingfed,dc=com`, ইউজার ayesha.rahman, tanvir.ahmed, nusrat.jahan, rafiq.islam, test.user
  - **AD:** ডোমেইন `pingfed.lab`, port 389, ইউজার `OU=LabUsers,DC=pingfed,DC=lab` এ: karim.hossain, sadia.akter, imran.khan, farhana.begum, ad.tester; সার্ভিস অ্যাকাউন্ট `svc-pingfed`
  - Firewall এ "PingFed Lab" গ্রুপের নিয়ম 9999, 9031, 1389, 4444 খোলা রাখে

---

## পর্ব ১: সার্ভারের মৌলিক সেটিং

### - [x] 1.1 Base URL আর Entity ID
- **কেন:** PingFederate তার সব ঠিকানা (লগইন পেজ, metadata, OIDC issuer) Base URL দিয়ে বানায়। `localhost` থাকলে ল্যাপটপের ব্রাউজার পৌঁছাতে পারবে না।
- **কোথায়:** System → Server → Protocol Settings → **Federation Info**
- **কী করবে:** Base URL `https://192.168.0.29:9031`, SAML 2.0 Entity ID `pingfed-lab-idp` → Save
- **✔ যাচাই:** `https://192.168.0.29:9031/.well-known/openid-configuration` এ `issuer` = `https://192.168.0.29:9031` (localhost না)।

### - [x] 1.2 Signing সার্টিফিকেট
- **কেন:** PingFederate প্রতিটা SAML উত্তরে এটা দিয়ে সই করে, অ্যাপ এটা দিয়ে যাচাই করে।
- **কোথায়:** Security → **Signing & Decryption Keys & Certificates** → Create New
- **কী করবে:** CN `PingFed Lab Signing`, SAN খালি, O `PingFed Lab`, C `BD`, Validity `730`, RSA 2048, RSA SHA256 → Save
- **এরপর:** Select Action → Export → **Certificate only** → `pingfed-test-app\pingfed-signing.crt`
- **⚠ সাবধান:** একই নামের পুরনো ফাইল থাকতে পারে — fingerprint মিলিয়ে নাও, না হলে লগইনে "Invalid signature"।

---

## পর্ব ২: লগইনের অংশ

### - [x] 2.1 Data Store: OpenDJ (`opendj-ds`)
- **কোথায়:** System → Data & Credential Stores → **Data Stores** → Add New Data Store
- **কী করবে:** Directory (LDAP) · Hostname `localhost:1389` → **Add** · Connection Security None · LDAP Type **Generic** · Simple · User DN `cn=Directory Manager` + পাসওয়ার্ড → Test Connection → Save
- **কেন Generic:** OpenDJ তালিকায় নেই; Generic = স্ট্যান্ডার্ড LDAP।

### - [x] 2.2 Data Store: Active Directory (`ad-ds`)
- **কী করবে:** Hostname `localhost:389` → Add · LDAP Type **Active Directory** · User DN `svc-pingfed@pingfed.lab` + তার পাসওয়ার্ড → Test Connection → Save
- **কেন `svc-pingfed`:** সবচেয়ে কম অধিকারের অ্যাকাউন্ট (শুধু পড়তে পারে), Administrator না।

### - [x] 2.3 PCV: OpenDJ (`opendj-pcv`)
- **কোথায়:** System → Data & Credential Stores → **Password Credential Validators** → Create New Instance
- **কী করবে:** LDAP Username Password Credential Validator · Datastore `opendj-ds` · Search Base `ou=limbosoft,dc=pingfed,dc=com` · Filter `cn=${username}` · Scope **Subtree** · Extended Contract: `displayName`, `employeeNumber`, `isMemberOf`, `sn`, `title`
- **⚠ সাবধান:** Scope One Level দিলে কাউকে পায় না → "ভুল পাসওয়ার্ড" দেখায়।

### - [x] 2.4 PCV: Active Directory (`ad-pcv`)
- **কী করবে:** Datastore `ad-ds` · Search Base `OU=LabUsers,DC=pingfed,DC=lab` · Filter **`sAMAccountName=${username}`** · Subtree · Case-Sensitive বন্ধ · Extended Contract: `displayName`, `sn`, `title`, `department`, `employeeID`, `memberOf`, `sAMAccountName`, `userPrincipalName`
- **ঐচ্ছিক:** Authentication Error Overrides (AD এ কাজ করে): `.*data 775.*` → Account Locked, `.*data 533.*` → Account Disabled, `.*data 532.*` → Password Expired, `.*data 773.*` → User Must Reset Password

### - [x] 2.5 Adapter: OpenDJ (`opendj-form`)
- **কোথায়:** Authentication → Integration → **IdP Adapters** → Create New Instance
- **কী করবে:**
  1. Type: HTML Form IdP Adapter, ID `opendjform`
  2. IdP Adapter: Credential Validators এ `opendj-pcv` → **Update** · Retries 3 · Session State Globally · Remember My Username ✔
  3. Extended Contract (PCV এর হুবহু নাম): `mail`, `givenName`, `displayName`, `sn`, `title`, `employeeNumber`, `isMemberOf`
  4. Adapter Attributes: Unique User Key `username`, Pseudonym শুধু `username`
  5. Adapter Contract Mapping: কিছু না (ঐচ্ছিক: `opendjlookup` attribute source)
- **⚠ সাবধান:** Credential Validators টেবিল খালি রাখলে adapter পাসওয়ার্ডই যাচাই করতে পারে না।

### - [x] 2.6 Adapter: AD (`ad-form`)
- **কী করবে:** HTML Form, ID `adform` · PCV **`ad-pcv`** · Session State **Per Adapter** · Extended Contract: `mail`, `givenName`, `displayName`, `sn`, `title`, `department`, `employeeID`, `memberOf`, `sAMAccountName`, `userPrincipalName` · Unique User Key + Pseudonym `username`
- **কেন Per Adapter:** Globally হলে OpenDJ এর session দিয়েই AD এর adapter পার হয়ে যেতে পারে।

### - [x] 2.7 Policy Contract (`lab-contract`)
- **কেন:** দুই ডিরেক্টরি একই তথ্য আলাদা নামে দেয় (`isMemberOf`/`memberOf`, `employeeNumber`/`employeeID`)। contract একটাই নামের তালিকা দেয়, অ্যাপ বুঝতেই পারে না কোন ডিরেক্টরি।
- **কোথায়:** Authentication → Policies → **Policy Contracts** → Create New Contract
- **কী করবে:** `subject` (আগে থেকেই) + Extend: `username`, `email`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory` → Save

### - [x] 2.8 Selector (`login-selector`)
- **কেন:** URL এর `login` প্যারামিটার দেখে ঠিক করে OpenDJ না AD।
- **কোথায়:** Authentication → Policies → **Selectors** → Create New Instance
- **কী করবে:**
  1. Type: **HTTP Request Parameter Authentication Selector**, ID `loginselector`
  2. Authentication Selector: Parameter Name `login` · Case-Sensitive বন্ধ · Any খালি · **No Match** ✔ · **Not in Request** ✔
  3. Selector Result Values: `ldap`, `ad`
- **জেনে রাখো:** `ldap`/`ad` শুধু লেবেল; অর্থ বসে policy তে, কোন শাখায় কোন adapter দাও তার উপর।

### - [x] 2.9 Authentication Policy (`lab-main`)
- **কোথায়:** Authentication → Policies → **Policies**
- **কী করবে:**
  1. **IDP AUTHENTICATION POLICIES** ✔
  2. **Tracked HTTP Parameters** ট্যাবে `login` → Add (না দিলে redirect এর মাঝে হারায়, AD পথ কখনো আসে না)
  3. Add Policy → `lab-main` → Policy ঘরে **`login-selector`** (adapter না!)
  4. শাখা: ldap → `opendj-form` · ad → `ad-form` · No Match → `opendj-form` · Not in Request → `opendj-form`
  5. প্রতিটা adapter: Fail → **Done** · Success → **`lab-contract`** (Done না!) → Contract Mapping:

     | Contract | OpenDJ শাখা | AD শাখা |
     |---|---|---|
     | subject, username | Adapter `username` | Adapter `username` |
     | email | Adapter `mail` | Adapter `mail` |
     | displayName, title | Adapter একই নাম | Adapter একই নাম |
     | department | No Mapping / Text `N/A` | Adapter `department` |
     | employeeId | Adapter `employeeNumber` | Adapter `employeeID` |
     | groups | Adapter `isMemberOf` | Adapter `memberOf` |
     | directory | **Text** `OpenDJ` | **Text** `AD` |

  6. Options আর Rules এখন খালি (খালি rule সারি থাকলে Delete) · Copy/Paste দিয়ে OpenDJ শাখা তিনবার
  7. Done → পাতার নিচের **Save** ⚠
- **✔ যাচাই:** Policies তালিকায় `lab-main`: sources ad-form + opendj-form, selector login-selector, contract lab-contract, Enabled।

---

## পর্ব ৩: অ্যাপ onboard (SAML)

### - [x] 3.1 অ্যাপ চালু আর metadata
- **কী করবে:** `pingfed-test-app` এ `npm start` → `http://localhost:3000/diagnostics` (heartbeat, SAML IdP certificate OK) → `http://localhost:3000/saml/metadata` → Ctrl+S `sp-metadata.xml`

### - [x] 3.2 SP Connection (`pflab-node-app`)
- **কোথায়:** Applications → **SP Connections** → Create Connection
- **কী করবে:**
  1. Template না · Browser SSO Profiles + SAML 2.0 · Browser SSO ✔
  2. Import Metadata: **File** → `sp-metadata.xml` (URL না — VM থেকে ল্যাপটপের localhost দেখা যায় না)
  3. General Info: Entity ID `pflab-node-app`, Base URL `http://localhost:3000`
  4. Browser SSO:
     - Profiles: IdP-Initiated SSO ✔, SP-Initiated SSO ✔
     - Assertion Lifetime 5/5
     - Assertion Creation: Standard · Attribute Contract `SAML_SUBJECT` + `email`, `username`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory` · **Map New Authentication Policy → `lab-contract`** · সব Source = Authentication Policy Contract (SAML_SUBJECT ← `subject`)
     - Protocol Settings: ACS POST `/saml/acs` · Bindings Redirect + POST · **Always sign the SAML Assertion** · Encryption None
  5. Credentials: Signing Certificate = PingFed Lab Signing
  6. Activation: **Active** → Save

---

## পর্ব ৪: SAML টেস্ট

### - [x] 4.1 লগইন
| বাটন (`http://localhost:3000`) | ইউজার | profile এ দেখবে |
|---|---|---|
| SAML: OpenDJ | ayesha.rahman | `directory = OpenDJ`, groups এ lab-admins |
| SAML: Active Directory | karim.hossain | `directory = AD`, `department = IT` |
| SAML: Unknown value | যেকোনো OpenDJ ইউজার | No Match শাখা |
| SAML: no hint | যেকোনো OpenDJ ইউজার | Not in Request শাখা |

- নতুন ইউজার টেস্টে **Incognito** (PingFederate session মনে রাখে)
- OIDC বাটন চাপলে "400 Invalid client_id" — OAuth client এখনো নেই (পর্ব ৬)

---

## পর্ব ৫: SAML Single Logout (SLO)

### - [x] 5.1 অ্যাপের দিক (Claude করেছে)
- অ্যাপের নিজের signing key `sp-signing.key`/`sp-signing.crt`, `/saml/logout`, `/saml/slo`, profile এ "Single Logout (SLO)" আর "Log out of app only" বাটন
- ⚠ অ্যাপ এখন লগইনের অনুরোধেও সই করে → 5.2 এর সার্টিফিকেট ছাড়া SAML লগইনে error হতে পারে

### - [ ] 5.2 PingFederate এর দিক
- **SP Connection `pflab-node-app` → Browser SSO:**
  - Profiles: **SP-Initiated SLO** ✔, **IdP-Initiated SLO** ✔
  - Protocol Settings → **SLO Service URLs**: Redirect `/saml/slo`, POST `/saml/slo`
  - Credentials → **Signature Verification Settings**: Trust Model **Unanchored**, Primary Verification Certificate = import `pingfed-test-app\sp-signing.crt`
  - Save
- **Authentication → Policies → Sessions:** **Track Adapter Sessions for Logout** ✔ → Save
- **✔ যাচাই:** লগইন → Single Logout (SLO) → "Logged out" পাতা → আবার লগইনে **পাসওয়ার্ড চায়**। তুলনা: "Log out of app only" এর পর পাসওয়ার্ড চায় না।

---

## পর্ব ৬: OIDC (একই লগইন, token দিয়ে)

লগইনের অংশ (policy, selector, adapter, contract) একই — শুধু contract এর পরের অংশ নতুন।

> 📄 ঘর ধরে ধরে পুরো গাইড: [PingFederate_OIDC_PKCE_Guide.md](PingFederate_OIDC_PKCE_Guide.md)

### - [ ] 6.0 শুধু S256 PKCE
- System → OAuth Settings → Authorization Server Settings → **Disallow Plain PKCE** ✔ → Save
- **✔ যাচাই:** discovery তে `code_challenge_methods_supported` = শুধু `S256`

### - [x] 6.1 Scopes
- System → OAuth Settings → **Scope Management** → `profile`, `email` (`openid` আগে থেকেই) → Save

### - [ ] 6.2 Access Token Manager (`lab-jwt-atm`)
- Applications → OAuth → **Access Token Management** → Create New Instance
- Type: **JSON Web Tokens**, ID `labjwtatm` · Lifetime 60 · **Use Centralized Signing Key** ✔ · RS256 · Session Validation সব খালি · Attribute Contract: `username`, `email`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory` → Save

### - [ ] 6.3 Policy Contract Grant Mapping
- Authentication → **OAuth** → **Policy Contract Grant Mapping** → `lab-contract` → USER_KEY ← `subject`, USER_NAME ← `username` → Save

### - [ ] 6.4 Access Token Mapping
- Applications → OAuth → **Access Token Mappings** → Context **Authentication Policy Contract: lab-contract**, ATM `lab-jwt-atm` → সব attribute ← contract এর একই নাম → Save

### - [ ] 6.5 OIDC Policy (`lab-oidc`)
- Applications → OAuth → **OpenID Connect Policy Management** → Add Policy
- ATM `lab-jwt-atm` · Include User Info in ID Token ✔ · claims: `sub`, `email`, `name`, `preferred_username`, `title`, `department`, `groups`, `directory` · Scopes: email → email; profile → name, preferred_username, title, department · Source Access Token (sub ← username, name ← displayName…) · **Set as Default**

### - [ ] 6.6 OAuth Client (`pflab-node-app`)
- Applications → OAuth → **Clients** → Add Client
- Client Secret → **Generate** (কপি করো — পরে দেখা যায় না) · Redirect URI `http://localhost:3000/oidc/callback` · Grant Types **Authorization Code** (+ Refresh Token) · **Require PKCE** ✔ · ATM `lab-jwt-atm` · OIDC Policy `lab-oidc` → Save
- **Client Authentication:** ক) **Client Secret** (confidential, সুপারিশ) বা খ) **None** (public — SPA/মোবাইলের মতো; তখন PKCE ই একমাত্র সুরক্ষা)

### - [ ] 6.7 অ্যাপে secret
- `pingfed-test-app\.env` এ ক) `OIDC_CLIENT_SECRET=<নতুন secret>` বা খ) `OIDC_CLIENT_SECRET=` (খালি) → অ্যাপ restart (Claude কে বলো)
- **✔ যাচাই:** OIDC: OpenDJ → ayesha (`directory = OpenDJ`) · OIDC: Active Directory → karim (`directory = AD`) · profile → Raw → **PKCE (S256)** এ verifier/challenge
- **✔ PKCE বাধ্যতামূলক কি না:** PKCE ছাড়া authorize URL খুললে `invalid_request` (URL নোট ফাইলে)

---

## পর্ব ৭: এরপর (একটা একটা করে)

- [ ] **Rules:** `lab-admins`/`AD-Lab-Admins` গ্রুপের জন্য আলাদা শাখা (`memberOf` multi-value contains DN)
- [ ] **Issuance Criteria:** গ্রুপে না থাকলে (`test.user`, `ad.tester`) লগইন আটকানো
- [ ] **Fragment:** OpenDJ শাখার পুনরাবৃত্ত mapping একবার বানিয়ে বারবার ব্যবহার
- [ ] **আরও selector:** CIDR, HTTP Header, Requested AuthN Context, Session, Connection Set, Extended Property, Tag
- [ ] **আরও adapter:** HTTP Basic, Composite, Identifier First (+ Incoming User ID), Passthrough, X.509, Reference ID
- [ ] **Kerberos:** `svc-pfkerb` + SPN `HTTP/WIN-60PG2A911IE.pingfed.lab` → AD Domains/Kerberos Realms → Kerberos Adapter → policy তে আগে Kerberos, ব্যর্থ হলে HTML Form
- [ ] **পাসওয়ার্ড ব্যবস্থাপনা:** Change Password, Email OTP রিসেট (টেস্ট SMTP), AD তে LDAPS + delegation
- [ ] **Authentication Sessions** চালু করে session-বাঁধা token

---

## মনে রাখার সহজ নিয়ম

| প্রশ্ন | কে উত্তর দেয় |
|---|---|
| কে লগইন করছে? | Data Store → PCV → Adapter |
| কোন রাস্তায় যাবে? | Selector → Policy |
| লগইন থেকে কী তথ্য বের হবে? | Policy Contract |
| কাকে দেবে? | SP Connection (SAML), অথবা ATM + OIDC Policy + OAuth Client (OIDC) |

## কাজের নিয়ম
- নিজে হাতে কনফিগার করো; Claude শুধু গাইড করে, আর বললে API দিয়ে **শুধু পড়ে** মিলিয়ে দেখে।
- প্রতিটা প্রশ্নের উত্তর `PingFederate_Learning_Notes.md` এ জমা হয়।
- একবারে একটা জিনিস বদলাও; কাজ করছে দেখে তারপর পরেরটা।

## দরকারি ফাইল
- সব পাসওয়ার্ড আর সার্ভারের তথ্য: `lab-credentials.txt`
- শেখার নোট আর প্রশ্ন-উত্তর লগ: `PingFederate_Learning_Notes.md`
- টেস্ট অ্যাপ: `pingfed-test-app\` (চালানোর নিয়ম `README.md` এ)
- SP metadata: `sp-metadata.xml`
- রিসেটের আগের কনফিগারেশন: `backups\pingfed-config-before-reset-20261005-1223.zip`
- পুরনো OpenDJ ইউজার: `backups\opendj-limbosoft-before-reset-20261005-1239.ldif`
- OpenDJ কনফিগ (port বদলের আগে, VM এ): `C:\lab-backups\opendj-config-20261005-1223.ldif`
