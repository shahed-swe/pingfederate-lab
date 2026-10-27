# PingFederate OIDC: PCV থেকে Admin-only SSO + MFA

Oct 20, 2026 · @Dev

## ০. বড় ছবি: বসের task টা PingFederate এর ভাষায়

বসের চারটা কথা = PingFederate এর চারটা জিনিস। লগইনের অংশ (PCV → adapter → policy → contract) একবার বানাও, তারপর দুইটা app সেটাকে OIDC দিয়ে ব্যবহার করে।

| বস যা বলেছে | PingFederate এ মানে | কোথায় বানাবে |
| --- | --- | --- |
| 2 ta application banao, SSO | দুইটা OAuth client (app1, app2), একই policy contract; একবার লগইন → দ্বিতীয় app এ পাসওয়ার্ড চায় না | Applications → OAuth → Clients + Authentication → Policies → Sessions |
| SSO only if user is admin | লগইনের পর **policy rule**: user এর group এ `lab-admins` আছে? না থাকলে Fail | Authentication → Policies → Policies → adapter node এর Rules |
| Admin will have certain role | role = directory attribute (OpenDJ `isMemberOf`, AD `memberOf`) | Data store + PCV contract + adapter contract |
| Admin will need MFA | admin শাখায় **PingOne MFA adapter** (দ্বিতীয় ধাপ) | Authentication → Integration → IdP Adapters |
| Identity first | **Identifier First adapter**: আগে শুধু username, তারপর ঠিক ডিরেক্টরির ফর্ম | IdP Adapters |
| Session use kora shikho | **Authentication Sessions**: লগইন মনে রাখা, SSO এর চাবি | Authentication → Policies → Sessions |
| Ping risk adapter | **PingOne Protect adapter**: ঝুঁকি স্কোর; HIGH হলে block, LOW হলে MFA skip করা যায় | IdP Adapters |

পুরো প্রবাহ (ব্রাউজার থেকে token পর্যন্ত):

1. app1 → `/as/authorization.oauth2` (code + PKCE)
2. Identifier First: username → কোন ডিরেক্টরি? (`@pingfed.lab` বা selector)
3. HTML Form (OpenDJ বা AD) → PCV পাসওয়ার্ড যাচাই, attribute আনে (`mail`, `title`, `isMemberOf`/`memberOf`)
4. Rule: `groups` এ `lab-admins` আছে? না → Fail (SSO নেই)
5. PingOne Protect: risk HIGH → Fail; নইলে চলো
6. PingOne MFA: push / TOTP / email OTP → pass
7. Policy contract `lab-contract` ভরে → session তৈরি
8. Grant mapping → Access Token (JWT) → OIDC policy → ID token → app1
9. app2 → authorization → session আছে → ধাপ ২–৬ skip → সরাসরি token (এটাই SSO)

ধাপ ৭ এ এসে সব এক হয়ে যায়: SAML হোক বা OIDC, app1 হোক বা app2, contract একই। এজন্যই policy contract দিয়ে লগইন একবার বানালেই হয়।

## ১. আগে থেকে যা আছে, যা লাগবে

Docker lab এ (`~/Desktop/pingfed`) OIDC এর পুরো চেইন একবার করা আছে। এই গাইডে সেগুলো আবার বানাবে না; বুঝবে কেন আছে, আর তার উপর নতুন জিনিস (Identifier First, rule, session, MFA, Risk, app2) যোগ করবে।

| জিনিস | নাম (UI তে) | ID (API তে) | অবস্থা |
| --- | --- | --- | --- |
| PingFederate 13.1.3 | https://localhost:9999/pingfederate/app (admin / Admin123) |  | চলছে |
| OpenDJ | `opendj:1389`, base `dc=pingfed,dc=lab` |  | 6 user, group `lab-users`, `lab-admins` |
| Samba AD | `samba-ad:389`, base `DC=pingfed,DC=lab` |  | 6 user, একই group |
| Data store | OpenDJ (lab), Active Directory (lab) | `opendjds`, `adds` | আছে |
| PCV | `opendj-pcv`, `ad-pcv` | `opendjpcv`, `adpcv` | আছে, contract এ mail/displayName/title/department/employeeNumber/groups |
| Adapter | `opendj-form`, `ad-form` (HTML Form) | `opendjform`, `adform` | আছে |
| Selector | `login-selector` (\`?login=ldap | ad\`) | `loginselector` |
| Policy | `lab-main` |  | আছে; ধাপ ৭ এ নতুন করে সাজাবে |
| Policy contract | `lab-contract` (subject, username, email, displayName, title, department, employeeId, groups, directory) | `labcontract` | আছে |
| ATM | `lab-jwt-atm` (JWT, RS256) | `labjwtatm` | আছে |
| OIDC policy | `Lab OIDC Policy` (default) | `laboidc` | আছে |
| OAuth client | `pflab-node-app` (app1, http://localhost:3100) |  | আছে |
| Sessions | Authentication Sessions |  | **বন্ধ** (enableSessions=false) → ধাপ ৪ |
| Identifier First, PingOne MFA, PingOne Protect adapter | নেই |  | ধাপ ২, ৫, ৬ |
| app2 + দ্বিতীয় OAuth client | নেই |  | ধাপ ৯ |

**যা লাগবে (একবার):** PingOne MFA আর PingOne Protect দুটোই Ping এর cloud service। PingFederate 13.1.3 এ adapter দুটো bundled (Authentication → Integration → IdP Adapters → Create New Instance → Type তালিকায় “PingOne MFA IdP Adapter 3.3” আর “PingOne Protect IdP Adapter 1.0.8”), কিন্তু কাজ করতে একটা PingOne environment লাগবে।

- [ ] PingOne trial খোলো: https://www.pingidentity.com/en/try-ping.html (30 দিন free, credit card লাগে না)
- [ ] Trial এর environment এ **MFA** আর **Protect** service যোগ করো (Environment → Services)
- [ ] Environment ID, region (NA/EU/AP) টুকে রাখো; ধাপ ৫ এ PingOne connection বানাতে লাগবে
- [ ] PingOne এ test user বানাও যার username = OpenDJ/AD এর username (যেমন `rahim.uddin`), কারণ MFA adapter PingOne এ user খুঁজে username দিয়ে

PingOne ছাড়া শেখার বিকল্প: ধাপ ৩, ৪, ৭, ৯ (rule, session, policy, দুই app SSO) সবই PingOne ছাড়া হয়। শুধু ধাপ ৫–৬ (MFA, Risk) এ PingOne লাগে। আগে PingOne ছাড়া পুরোটা চালু করো, তারপর MFA বসাও।

## ২. Building block গুলো: কী, কেন, কোথায়

প্রতিটা block একটা কাজ করে আর পরেরটাকে খাবার দেয়। ক্রমটা মুখস্থ করো: data store → PCV → adapter → policy (selector/rule) → contract → session; তারপর OAuth client → ATM → OIDC policy।

| Block | কী করে | কেন লাগে | UI তে কোথায় |
| --- | --- | --- | --- |
| Data store | ডিরেক্টরির সাথে connection (host, bind DN, password) | PCV আর attribute lookup এই connection দিয়ে কথা বলে | System → Data & Credential Stores → Data Stores |
| PCV (Password Credential Validator) | username+password নিয়ে ডিরেক্টরিতে bind করে যাচাই; সাথে user এর attribute ফেরত দেয় | adapter নিজে পাসওয়ার্ড চেনে না, PCV কে জিজ্ঞেস করে | System → Data & Credential Stores → Password Credential Validators |
| IdP Adapter | ব্যবহারকারীর সাথে কথা বলে (ফর্ম দেখায়, push পাঠায়, risk মাপে) আর শেষে attribute contract ভরে | এক ধরনের প্রমাণ = এক adapter; policy তে পরপর বসানো যায় | Authentication → Integration → IdP Adapters |
| HTML Form adapter | লগইন ফর্ম; PCV দিয়ে পাসওয়ার্ড যাচাই | প্রথম factor | ওই |
| Identifier First adapter | শুধু username (বা email) নেয়, পাসওয়ার্ড না; `subject` আর `domain` দেয় | কোন user কোন ডিরেক্টরি/পদ্ধতিতে যাবে তা পাসওয়ার্ড চাওয়ার আগেই ঠিক হয় (যেমন `@pingfed.lab` → AD) | ওই |
| PingOne MFA adapter | PingOne এ user খুঁজে দ্বিতীয় factor চালায় (app push, TOTP, SMS, email) | বসের “admin will need MFA” | ওই (PingOne connection লাগে) |
| PingOne Protect adapter | ব্রাউজার/IP/আচরণ দেখে ঝুঁকি মাপে; `riskLevel` LOW/MEDIUM/HIGH দেয় | ঝুঁকি অনুযায়ী MFA চাওয়া বা block | ওই |
| Selector | কোন শাখায় যাবে তা ঠিক করে (request parameter, OAuth client, session আছে কিনা, IP range) | লগইনের আগে রাস্তা বাছাই | Authentication → Policies → Selectors |
| Policy (tree) | selector/adapter নোড জোড়া গাছ; প্রতি শাখার শেষে Fail বা contract | পুরো লগইন লজিক এক জায়গায় | Authentication → Policies → Policies |
| Rule (policy node এ) | adapter সফল হলে তার attribute দেখে নতুন শাখা বানায় (যেমন groups এ lab-admins আছে → “admin”) | বসের “only if admin” | policy তে adapter node → Rules |
| Policy contract | লগইনের ফলাফলের স্ট্যান্ডার্ড আকার (subject + attributes) | SAML, OIDC সবাই একই contract থেকে নেয় | Authentication → Policies → Policy Contracts |
| Authentication Session | adapter সফল হলে PingFederate মনে রাখে (cookie); পরের অনুরোধে ওই adapter skip | এটাই SSO: app1 এ লগইন, app2 তে পাসওয়ার্ড না | Authentication → Policies → Sessions |
| OAuth client | app এর পরিচয় (client\_id, secret, redirect URI, PKCE) | প্রতি app একটা | Applications → OAuth → Clients |
| ATM (Access Token Manager) | access token এর ধরন (JWT/reference) আর ভেতরের attribute | API যাচাই করবে | Applications → OAuth → Access Token Management |
| OIDC policy | ID token এ কোন claim যাবে, কোন scope এ | app ব্যবহারকারীকে চেনে ID token দিয়ে | Applications → OAuth → OpenID Connect Policy Management |

**দুইটা ভুল যা সবাই করে:** (1) PCV এ attribute না রাখলে adapter তা পায় না, policy তে rule লেখা যায় না। (2) Session বন্ধ রেখে SSO আশা করা: HTML Form এর নিজস্ব “Session State” আর PingFederate এর Authentication Session দুই জিনিস; বস যেটা বলছে সেটা দ্বিতীয়টা।

## ধাপ ১: Data store আর PCV (OpenDJ + AD)

লক্ষ্য: PingFederate দুই ডিরেক্টরিতে bind করতে পারে, আর PCV পাসওয়ার্ড যাচাইয়ের সাথে **group attribute** ফেরত দেয় (admin চেনার জন্য এটাই মূল)। Lab এ দুটোই আছে; খুলে মিলিয়ে নাও।

### ১.১ Data store

**কোথায়:** System → Data & Credential Stores → Data Stores → Add New Data Store → Directory (LDAP)

| ঘর | OpenDJ (`opendjds`) | AD (`adds`) | কেন |
| --- | --- | --- | --- |
| Hostname | `opendj:1389` | `samba-ad:389` | Docker network এ service name; ল্যাপটপ থেকে হলে `localhost:1389` / `localhost:10389` |
| LDAP Type | Generic | Active Directory | AD type দিলে PF `memberOf`, account-lock error ইত্যাদি AD স্টাইলে বোঝে |
| Connection Security | None | None | lab; production এ LDAPS + trusted cert |
| Authentication | Simple: `cn=Directory Manager` | Simple: `CN=Administrator,CN=Users,DC=pingfed,DC=lab` | service account, user এর পাসওয়ার্ড না |

**Test Connection** সবুজ না হলে সামনে যেও না।

### ১.২ PCV

**কোথায়:** System → Data & Credential Stores → Password Credential Validators → Create New Instance → Type **LDAP Username Password Credential Validator**

| ঘর | `opendj-pcv` | `ad-pcv` |
| --- | --- | --- |
| LDAP Datastore | OpenDJ (lab) | Active Directory (lab) |
| Search Base | `ou=People,dc=pingfed,dc=lab` | `DC=pingfed,DC=lab` |
| Search Filter | `uid=${username}` | `sAMAccountName=${username}` |
| Scope of Search | Subtree | Subtree |
| Case-Sensitive Matching | off | off |

**Extended Contract (ট্যাব ২) ⭐ এখানেই role আসে:** core এ `DN`, `givenName`, `mail`, `username` আগে থেকেই। একটা একটা করে Add:

| OpenDJ | AD | কাজ |
| --- | --- | --- |
| `displayName` | `displayName` | নাম |
| `title` | `title` | পদবি |
| `departmentNumber` | `department` | বিভাগ |
| `employeeNumber` | `employeeNumber` | employee ID |
| `isMemberOf` | `memberOf` | **group তালিকা** → ধাপ ৩ এর rule এটা দেখে |

কেন নাম আলাদা: OpenDJ তে group membership একটা virtual attribute `isMemberOf`; AD তে সত্যিকারের attribute `memberOf`। দুটোই পূর্ণ group DN দেয়, যেমন `cn=lab-admins,ou=Groups,dc=pingfed,dc=lab` আর `CN=lab-admins,CN=Users,DC=pingfed,DC=lab`।

**✔ যাচাই:** প্রতিটা PCV এর Summary তে extended attribute তালিকা দেখো। এখানে যা নেই, পরে কোথাও পাবে না।

## ধাপ ২: Adapter: HTML Form আর Identifier First

লক্ষ্য: তিনটা adapter: `id-first` (username নেয়), `opendj-form` আর `ad-form` (পাসওয়ার্ড নেয়)। শেষ দুটো lab এ আছে, শুধু contract মিলিয়ে নাও।

**কোথায়:** Authentication → Integration → IdP Adapters → Create New Instance

### ২.১ HTML Form adapter (আছে, মিলিয়ে নাও)

| ঘর | `opendj-form` | `ad-form` | কেন |
| --- | --- | --- | --- |
| Type | HTML Form IdP Adapter | ওই |  |
| Credential Validators | `opendj-pcv` | `ad-pcv` | পাসওয়ার্ড যাচাই যে PCV করবে |
| Challenge Retries | 3 | 3 |  |
| Session State | **None** | None | adapter এর নিজস্ব session না; SSO হবে ধাপ ৪ এর Authentication Session দিয়ে |
| Allow Username Edits During Chaining | off | off | Identifier First থেকে আসা username বদলানো যাবে না |

**Extend the Contract (ট্যাব Adapter Attributes):** core `username` (**Pseudonym** ✔), `policy.action`। Extended এ PCV এর সব attribute একই নামে: `mail`, `displayName`, `title`, `departmentNumber`/`department`, `employeeNumber`, `isMemberOf`/`memberOf`। নিয়ম: adapter contract এ নাম থাকলে PCV থেকে মান আসে, না থাকলে আসে না।

### ২.২ Identifier First adapter (নতুন)

| ঘর | মান | কেন |
| --- | --- | --- |
| Instance Name / ID | `id-first` / `idfirst` |  |
| Type | **Identifier First Adapter** |  |
| Identifier Cookie Lifetime | 30 (দিন) | ব্রাউজার username মনে রাখে, পরেরবার শুধু বেছে নেয় |
| Maximum Identifiers Count | 5 | কয়টা মনে রাখবে |
| Allow Cancelling Identifier Selection | on | “অন্য user” বাটন |
| Identifier Selection Template | `identifier.first.template.html` | default |
| Enable Risk Provider | off | ধাপ ৬ এ Protect adapter আলাদা নোড হিসেবে বসাবে, সেটা বেশি পরিষ্কার |

**Contract:** `subject` (যা টাইপ করল) আর `domain` (`@` এর পরের অংশ, না থাকলে খালি)। এই দুটা দিয়ে policy তে রাস্তা বাছাই হবে:

- `domain` = `pingfed.lab` (user লিখল `karim.hossain@pingfed.lab`) → AD ফর্ম
- `domain` খালি (শুধু `ayesha.rahman`) → OpenDJ ফর্ম

**username পরের adapter এ যায় কীভাবে:** policy তে HTML Form node এ **Options → Input User ID Mapping** = `id-first` এর `subject`। AD এর জন্য `@pingfed.lab` কেটে দিতে চাইলে সেখানে Expression: `#this.get("subject").toString().split("@")[0]` (Expression দিতে System → Server → General Settings এ OGNL চালু লাগে)। সহজ বিকল্প: `ad-pcv` এর filter `(|(sAMAccountName=${username})(userPrincipalName=${username}))` করো, তাহলে পুরো email দিয়েও লগইন হয়।

**✔ যাচাই:** IdP Adapters তালিকায় তিনটা; `id-first` এর contract এ subject + domain।

## ধাপ ৩: Admin কে চেনা: group/role আর policy rule

লক্ষ্য: লগইনের পর PingFederate নিজেই দেখবে user এর group তালিকায় `lab-admins` আছে কিনা। থাকলে “admin” শাখা, না থাকলে Fail। PingFederate 13 এ আলাদা “LDAP Group selector” নেই; এটা করা হয় policy তে adapter node এর **Rules** দিয়ে।

### ৩.১ Role কোথায় থাকে

| ডিরেক্টরি | admin group | attribute যেটায় আসে | lab এ কে admin |
| --- | --- | --- | --- |
| OpenDJ | `cn=lab-admins,ou=Groups,dc=pingfed,dc=lab` | `isMemberOf` (multi-value) | rahim.uddin, tanvir.hasan |
| AD | `CN=lab-admins,CN=Users,DC=pingfed,DC=lab` | `memberOf` (multi-value) | karim.hossain, rafiq.islam |

বাকিরা (ayesha, sadia, farhan, mitu, nadia, sumaiya, imran, lamia) non-admin: এরা লগইন করতে পারবে কিন্তু SSO পাবে না (Fail)।

### ৩.২ Rule লেখা

**কোথায়:** Authentication → Policies → Policies → `lab-main` → `opendj-form` node → **Rules**

| ঘর | OpenDJ node | AD node |
| --- | --- | --- |
| Attribute Name | `isMemberOf` | `memberOf` |
| Condition | **multi-value contains (DN)** | multi-value contains (DN) |
| Value | `cn=lab-admins,ou=Groups,dc=pingfed,dc=lab` | `CN=lab-admins,CN=Users,DC=pingfed,DC=lab` |
| Result | `admin` | `admin` |
| Default to Success | **off** | off |

“Default to Success” off মানে: rule না মিললে আলাদা কোনো শাখা নেই, সোজা **Fail**। এটাই “SSO only if admin”। উল্টোটা (non-admin কে MFA ছাড়া ঢুকতে দেওয়া) চাইলে on করো: তখন node এর নিচে `admin` আর `Success` দুই শাখা হবে।

API তে একই জিনিস (`authnSelectionTrees[].rootNode...action.attributeRules`):

```json
{"fallbackToSuccess": false,
 "items": [{"attributeName": "isMemberOf", "condition": "MULTIVALUE_CONTAINS_DN",
            "expectedValue": "cn=lab-admins,ou=Groups,dc=pingfed,dc=lab", "result": "admin"}]}
```

**Condition কোনটা কখন:** `MULTIVALUE_CONTAINS_DN` = DN হিসেবে তুলনা (space/case উপেক্ষা), group এর জন্য সবসময় এটা। `EQUALS` একটা মানের attribute এর জন্য (যেমন `title = "IAM Analyst"`)। Role যদি group না হয়ে attribute হয় (যেমন AD এ `employeeType=admin`), তাহলে PCV contract এ সেই attribute যোগ করো আর rule এ `EQUALS` দাও।

**✔ যাচাই:** policy tree তে `opendj-form` এর নিচে তিনটা শাখা দেখাবে: Fail, admin (আর Default to Success on হলে Success)। ধাপ ৭ এ admin শাখার নিচে MFA বসবে।

## ধাপ ৪: Authentication Sessions (SSO এর চাবি)

লক্ষ্য: app1 এ লগইনের পর app2 খুললে PingFederate আর পাসওয়ার্ড/MFA চাবে না। তার জন্য adapter এর সফল ফলাফল PingFederate কে মনে রাখতে হবে। Lab এ এটা এখন বন্ধ।

**কোথায়:** Authentication → Policies → Sessions

### ৪.১ Global অংশ (Authentication Sessions)

| ঘর | মান | কেন |
| --- | --- | --- |
| Enable Authentication Sessions | ✔ | মূল সুইচ |
| Make Authentication Sessions Persistent | off (lab) | on হলে ব্রাউজার বন্ধ করলেও থাকে |
| Idle Timeout | 60 min | এতক্ষণ কিছু না করলে শেষ |
| Max Timeout | 8 hours | যাই করো, এর পর আবার লগইন |
| Track Adapter Sessions for Logout | ✔ (আছে) | SLO/logout এ adapter session ও শেষ হয় |

### ৪.২ Adapter অনুযায়ী (Authentication Session Policies)

একই পাতায় Add Policy → adapter বেছে নাও। কোন adapter এর সেশন মনে রাখবে তা এখানে ঠিক হয়:

| Adapter | Enable Sessions | কেন |
| --- | --- | --- |
| `id-first` | off | username নেওয়াটা প্রমাণ না; cookie এ মনে থাকে |
| `opendj-form`, `ad-form` | **✔** | পাসওয়ার্ড একবার |
| `pingone-mfa` | **✔** | MFA ও একবার; off রাখলে প্রতি app এ push আসবে (step-up শেখার জন্য পরে off করে দেখো) |
| `pingone-protect` | off | ঝুঁকি প্রতিবার মাপা উচিত |

User Device Type = Any, Persistent = off, Idle/Max global এর মতো।

### ৪.৩ কীভাবে কাজ করে

1. app1 → authorization → policy চলে → `opendj-form` সফল → PingFederate একটা session রাখে (`PF` cookie, ভেতরে adapter + user + attributes)
2. app2 → authorization → একই policy → `opendj-form` node এ এসে PingFederate দেখে session আছে → ফর্ম না দেখিয়ে আগের attribute দিয়ে সামনে যায়
3. Rule আবার চলে (session এর attribute দিয়ে), MFA node এও session আছে → skip → contract → token

**Session Authentication Selector (ঊর্ধ্বতন শেখা):** selector type “Session Authentication Selector” দিয়ে policy এর শুরুতেই জিজ্ঞেস করা যায় “এই adapter এর session আছে?” → Yes/No শাখা। দরকার যখন session থাকলে অন্য রাস্তা নিতে চাও (যেমন Identifier First skip)।

**বুঝে রাখো:** OIDC তে `prompt=login` পাঠালে PingFederate session উপেক্ষা করে আবার লগইন চায়; `max_age=0` ও একই। Lab app এর “Custom request” দিয়ে টেস্ট করা যায়।

**✔ যাচাই:** লগইন করে ব্রাউজারে `https://localhost:9031` এর cookie তে `PF` দেখো; Admin → Authentication → Policies → Sessions → Session Management এ নিজের session দেখা যায়।

## ধাপ ৫: MFA adapter (PingOne MFA)

লক্ষ্য: admin শাখায় পাসওয়ার্ডের পর দ্বিতীয় factor। PingFederate নিজে OTP পাঠায় না; PingOne MFA adapter PingOne cloud কে বলে “এই user কে challenge করো”, PingOne push/TOTP/SMS/email চালায়, ফল ফেরত দেয়।

### ৫.১ PingOne এর দিক (একবার)

1. Trial environment এ Services → **MFA** যোগ করো।
2. Authentication → MFA → Policies: একটা MFA policy (যেমন `lab-admin-mfa`), method: Mobile app push + TOTP + Email।
3. Directory → Users: admin user গুলো বানাও, **username হুবহু OpenDJ/AD এর মতো** (`rahim.uddin`, `tanvir.hasan`, `karim.hossain`, `rafiq.islam`), email দাও। পরে “Provision Users” চালু করলে PingFederate নিজেই বানাবে।
4. Environment → Properties: **Environment ID** আর region টুকে রাখো।

### ৫.২ PingFederate ↔ PingOne connection

**কোথায়:** System → External Systems → **PingOne Connections** → Add Connection

| ঘর | মান |
| --- | --- |
| Name | `pingone-lab` |
| Credential | PingOne এ Integrations → PingFederate → Add → credential কপি করো (বা Applications → Worker app এর Admin credential) |

Save এর পর environment আর region নিজেই ভরে যায়। একই connection MFA আর Protect দুই adapter ব্যবহার করবে।

### ৫.৩ Adapter

**কোথায়:** Authentication → Integration → IdP Adapters → Create New Instance → Type **PingOne MFA IdP Adapter 3.3**

| ঘর | মান | কেন |
| --- | --- | --- |
| Instance Name / ID | `pingone-mfa` / `pingonemfa` |  |
| PingOne Environment | `pingone-lab` (ড্রপডাউন) | ৫.২ এর connection |
| PingOne Population | Default | কোন population এ user খুঁজবে |
| Application | PingOne এ PingFederate এর জন্য তৈরি app (Worker) | adapter এই app দিয়ে API ডাকে |
| PingOne Authentication Policy | `lab-admin-mfa` | কোন method চলবে |
| Username Attribute | খালি (default = আগের adapter এর `username`) | PingOne এ এই নামে user খুঁজবে |
| Email Attribute | `mail` | provisioning এ email device বানাতে |
| Prompt Users to Set Up MFA | ✔ | প্রথমবার device যোগ করার সুযোগ |
| Provision Users and Authentication Methods | ✔ (lab) | PingOne এ user না থাকলে বানিয়ে নেয় |
| DEFAULT AUTHENTICATION METHOD FOR PROVISIONED USERS | EMAIL | lab এ ফোন না থাকলেও চলে |
| User Not Found Failure Mode | **Block user** | admin হয়েও PingOne এ নেই = ঢুকতে দেবে না |
| Service Unavailable Failure Mode | Block (production) / Bypass (lab টেস্টে) | PingOne না পেলে কী হবে |

**Adapter Attributes ট্যাব:** core `username`; extended এ `pingone.mfa.devices`/`amr` লাগলে যোগ করো (OIDC `amr` claim এ “mfa” দেখাতে কাজে লাগে)।

### ৫.৪ Policy তে বসানো (ধাপ ৭ এ পুরো গাছ)

`opendj-form` → `admin` শাখা → `pingone-mfa` node। সেখানে **Options → Input User ID Mapping** = `opendj-form` এর `username` (কোন user কে challenge করবে)। Fail → Done(Fail), Success → contract।

**PingOne না থাকলে এখনই কী করবে:** ধাপ ৭ এ MFA node এর জায়গায় আপাতত আরেকটা HTML Form adapter (যেমন `admin-reconfirm`, একই PCV) বসাও: admin কে দ্বিতীয়বার পাসওয়ার্ড চাইবে। সত্যিকার MFA না, কিন্তু “admin শাখায় বাড়তি ধাপ” এর পুরো মেকানিজম (rule → শাখা → নতুন adapter → session) একই; PingOne এলে শুধু node এর adapter বদলাবে।

**✔ যাচাই:** Incognito → app1 → `rahim.uddin` → পাসওয়ার্ড → PingOne এর MFA পাতা (email code / push) → profile। `ayesha.rahman` দিয়ে → MFA আসবে না, সোজা Fail।

## ধাপ ৬: PingOne Protect (Risk) adapter

লক্ষ্য: পাসওয়ার্ডের পর, MFA এর আগে ঝুঁকি মাপা। Protect adapter ব্রাউজার fingerprint, IP, নতুন device, অসম্ভব ভ্রমণ (impossible travel) ইত্যাদি দেখে `riskLevel` = LOW / MEDIUM / HIGH দেয়। Policy তার উপর শাখা নেয়।

### ৬.১ PingOne এর দিক

1. Services → **Protect** যোগ করো।
2. Threat Protection → Risk Policies: default policy থাকে (`Default Risk Policy`); শেখার জন্য একটা কপি করো `lab-risk`, যেখানে “Anonymous network” আর “New device” এর weight বাড়াও। তাহলে VPN/Incognito দিয়ে সহজে HIGH বানানো যায়।

### ৬.২ Adapter

**কোথায়:** Authentication → Integration → IdP Adapters → Create New Instance → Type **PingOne Protect IdP Adapter 1.0.8**

| ঘর | মান | কেন |
| --- | --- | --- |
| Instance Name / ID | `pingone-protect` / `pingoneprotect` |  |
| PingOne Environment | `pingone-lab` | ধাপ ৫.২ এর connection |
| PingOne Risk Policy | `lab-risk` |  |
| Include Dynamic Device Profile | ✔ | ব্রাউজার থেকে JavaScript দিয়ে device তথ্য নেয় |
| Device Profiling Timeout | 5000 ms |  |
| Failure Mode | Continue with fallback policy decision | PingOne না পেলে থেমে যাবে না |
| Fallback Policy Decision Value | MEDIUM | তখন MFA চাইবে (নিরাপদ দিক) |

**Additional User Attributes টেবিল:** Incoming `username` → PingOne Protect `user.name` (কার ঝুঁকি মাপছে)। Policy তে node এর Input User ID Mapping = `opendj-form` এর `username`।

**Adapter contract (আগে থেকেই):** `riskLevel`, `riskScore`, `recommendedAction`, `mitigation.action`। Rule লেখা হবে `riskLevel` এর উপর।

### ৬.৩ Policy তে rule

`pingone-protect` node → Rules (Default to Success **on**, কারণ LOW/MEDIUM দুটোই চলবে):

| Attribute | Condition | Value | Result | তারপর |
| --- | --- | --- | --- | --- |
| `riskLevel` | equals | `HIGH` | `high` | Done (Fail): block |
| `riskLevel` | equals | `LOW` | `low` | সোজা contract (MFA skip) — বসের নিয়ম “admin সবসময় MFA” হলে এই rule বাদ |
| (মিলল না = MEDIUM) |  |  | Success | `pingone-mfa` |

**বসের requirement অনুযায়ী সবচেয়ে সহজ রূপ:** শুধু HIGH rule রাখো। তাহলে: HIGH → block; বাকি সব admin → MFA। Risk এখানে “MFA এর আগের গেট”।

**Session:** Protect adapter এ session off (ধাপ ৪.২); তাই app2 তে গেলেও ঝুঁকি আবার মাপবে, কিন্তু MFA আর পাসওয়ার্ড session থেকে skip হবে। এটাই “continuous risk evaluation”।

**✔ যাচাই:** সাধারণ ব্রাউজার এ admin লগইন → MFA → profile। PingOne → Threat Protection → Dashboard এ ওই লগইনের risk event দেখো। VPN/Tor দিয়ে আবার → HIGH → block।

## ধাপ ৭: পুরো policy tree জোড়া লাগানো

লক্ষ্য: ধাপ ২–৬ এর টুকরোগুলো এক গাছে। একটাই policy `lab-main`; selector `login-selector` এর জায়গায় শুরুতে `id-first`। সব শাখার শেষ হয় Fail নয়তো `lab-contract` এ।

&#91;embedded content: policy lab-main · 7 node, 3 branch\]

পড়ার নিয়ম: উপর থেকে নিচে একটা লগইন; ডানের লাল box এ যাওয়া মানে token নেই। app2 আসলে session থাকা node গুলো (form, MFA) চুপচাপ পার হয়, শুধু rule আর risk আবার চলে।

**কোথায়:** Authentication → Policies → Policies → `lab-main` (Enable IdP Authentication Policies ✔ থাকতে হবে)

| Node | Type | শাখা | Options / Rules | কেন |
| --- | --- | --- | --- | --- |
| 1 | `id-first` (adapter) | Fail → Done; Success → নিচে | contract এর `domain` এর উপর rule: equals `pingfed.lab` → result `ad`; Default to Success on (= `ldap`) | username থেকে ডিরেক্টরি বাছাই |
| 2a | `opendj-form` | Fail → Done; `admin` → node 3 | Input User ID Mapping = `id-first.subject`; Rules: `isMemberOf` multi-value contains DN `cn=lab-admins,ou=Groups,dc=pingfed,dc=lab` → `admin`, Default to Success **off** | ধাপ ৩ |
| 2b | `ad-form` | একই | Input User ID Mapping = `id-first.subject`; Rules: `memberOf` contains DN `CN=lab-admins,CN=Users,DC=pingfed,DC=lab` → `admin`, Default off | ধাপ ৩ |
| 3 | `pingone-protect` | `high` → Done(Fail); Success → node 4 | Input User ID Mapping = ২a/২b এর `username`; Rule `riskLevel` equals `HIGH` → `high`, Default to Success on | ধাপ ৬ |
| 4 | `pingone-mfa` | Fail → Done; Success → node 5 | Input User ID Mapping = ২a/২b এর `username` | ধাপ ৫ |
| 5 | Policy Contract `lab-contract` | শেষ | Contract Fulfillment নিচে | ধাপ ৮ এর খাবার |

**Node 5 এর Contract Fulfillment (OpenDJ শাখা; AD শাখায় source `ad-form`, attribute নাম AD এর):**

| Contract | Source | Value |
| --- | --- | --- |
| subject, username | Adapter (opendj-form) | `username` |
| email | Adapter (opendj-form) | `mail` |
| displayName, title | Adapter (opendj-form) | `displayName`, `title` |
| department | Adapter (opendj-form) | `departmentNumber` (AD: `department`) |
| employeeId | Adapter (opendj-form) | `employeeNumber` |
| groups | Adapter (opendj-form) | `isMemberOf` (AD: `memberOf`) |
| directory | Text | `opendj` (AD: `ad`) |

**গাছটা দুইবার কেন:** OpenDJ আর AD শাখায় node 3–5 একই। UI তে copy নেই; একই জিনিস দুইবার বানাতে হয়, নয়তো **Fragment** (Authentication → Policies → Fragments) এ node 3–5 একবার বানিয়ে দুই শাখায় বসাও। শেখার দ্বিতীয় ধাপ হিসেবে Fragment করো।

**Tracked HTTP parameter:** আগের `login` parameter আর লাগে না; Identifier First নিজেই রাস্তা ঠিক করে। app এর বাটনের `login=ldap|ad` এখন শুধু দেখানোর জন্য।

**✔ যাচাই:** policy Save এর পর Summary তে প্রতিটা শাখা শেষ পর্যন্ত Done বা contract এ গেছে কিনা দেখো; ঝুলে থাকা শাখা থাকলে PingFederate Save নেয় না।

## ধাপ ৮: Contract থেকে token (OIDC এর অংশ)

লক্ষ্য: `lab-contract` ভরার পর PingFederate কীভাবে access token আর ID token বানায়। Lab এ চারটাই আছে (PingFederate\_OIDC\_PKCE\_Guide.md এর ধাপ ২–৫); এখানে শুধু ক্রম আর নতুন দুই claim।

| # | জিনিস | কোথায় | কী বলে | lab এ নাম |
| --- | --- | --- | --- | --- |
| 1 | Policy Contract Grant Mapping | Authentication → OAuth → Policy Contract Grant Mapping | “এই contract থেকে grant (অনুমতির রেকর্ড) কার নামে হবে”: USER\_KEY ← subject, USER\_NAME ← username | `lab-contract` |
| 2 | Access Token Manager | Applications → OAuth → Access Token Management | access token এর ধরন আর ভেতরের attribute তালিকা | `lab-jwt-atm` (JWT, RS256, 60 min) |
| 3 | Access Token Mapping | Applications → OAuth → Access Token Mappings | context = `lab-contract`, ATM = `lab-jwt-atm`; প্রতি attribute ← contract এর একই নাম | আছে |
| 4 | OIDC Policy | Applications → OAuth → OpenID Connect Policy Management | ID token এর claim ← access token এর attribute; scope → claim | `lab-oidc` (Default) |
| 5 | OAuth Client | Applications → OAuth → Clients | app এর পরিচয়, redirect URI, PKCE, কোন ATM/OIDC policy | `pflab-node-app` + ধাপ ৯ এ দ্বিতীয়টা |

কেন এই ক্রম: 3 এ context ড্রপডাউনে contract আসে কেবল 1 থাকলে; 4 এ claim এর source হয় 2 এর attribute; 5 এ ATM আর policy বাছতে 2 আর 4 লাগে।

### ৮.১ বসের task এর জন্য দুই নতুন claim

| Claim | কোথা থেকে | কেন |
| --- | --- | --- |
| `role` | contract এ নতুন attribute `role` ← Text `admin` (admin শাখায় ভরা হয়) → ATM contract → OIDC policy claim `role` | app এক নজরে দেখে কে admin; group DN parse করতে হয় না |
| `amr` | OIDC policy তে extended claim `amr` (multi-valued) ← Text `pwd` + `mfa`; PingOne MFA adapter থেকে নিলে adapter contract এ `amr` যোগ করে contract হয়ে আনো | OIDC standard: Authentication Methods Reference; app প্রমাণ পায় MFA হয়েছে |

নতুন attribute যোগ করার ক্রম (না হলে ড্রপডাউনে পাবে না): Policy Contract এ attribute → policy এর node 5 এ fulfillment → ATM এর contract → Access Token Mapping → OIDC Policy contract + fulfillment। পাঁচ জায়গায় একই নাম।

### ৮.২ Scope → claim (OIDC policy, ট্যাব Attribute Scopes)

| Scope | Claims |
| --- | --- |
| `email` | email |
| `profile` | name, preferred\_username, title, department, role, groups, directory |

Lab এ দেখা গেছে কোনো scope এ না থাকা claim (`groups`, `directory`) ID token এ আসে নি, শুধু access token এ ছিল। তাই যা ID token এ চাও, কোনো না কোনো scope এ বসাও।

**✔ যাচাই:** app এর profile পাতায় ID token এ `role: admin`, `amr: ["pwd","mfa"]`, access token এ `groups`।

## ধাপ ৯: দুইটা app, দুইটা OAuth client, SSO টেস্ট

লক্ষ্য: বসের “2 ta application, SSO”। সবচেয়ে কম কাজ: lab app টাই দ্বিতীয় port এ আরেকবার চালাও, আলাদা client\_id দিয়ে। PingFederate এর কাছে সেটা আলাদা app।

### ৯.১ app2 চালানো

```bash
cd ~/Desktop/pingfed/pingfederate-lab
cp -r pingfed-test-app pingfed-test-app2
cd pingfed-test-app2
# .env এ বদলাও: PORT=3200, APP_URL=http://localhost:3200, OIDC_CLIENT_ID=pflab-node-app2, OIDC_CLIENT_SECRET=<নতুন>, SESSION_SECRET=<আলাদা>
npm start
```

### ৯.২ দ্বিতীয় OAuth client

**কোথায়:** Applications → OAuth → Clients → Add Client

| ঘর | app1 (আছে) | app2 (নতুন) |
| --- | --- | --- |
| Client ID | `pflab-node-app` | `pflab-node-app2` |
| Name | Lab Node App (OIDC) | Lab Node App 2 |
| Client Authentication | Client Secret | Client Secret (Generate, এখনই .env এ) |
| Redirect URIs | `http://localhost:3100/oidc/callback` | `http://localhost:3200/oidc/callback` |
| Allowed Grant Types | Authorization Code, Refresh Token | একই |
| Require PKCE | ✔ | ✔ |
| Default Access Token Manager | `lab-jwt-atm` | একই |
| OpenID Connect Policy | `lab-oidc` | একই |
| Post-Logout Redirect URIs | `http://localhost:3100/` | `http://localhost:3200/` |

দুই client একই policy, একই contract, একই session ব্যবহার করে। SSO এর জন্য client এ আলাদা কিছু লাগে না; session (ধাপ ৪) ই সব।

### ৯.৩ SSO টেস্ট (Incognito তে)

1. http://localhost:3100 → OIDC login → `rahim.uddin` → পাসওয়ার্ড → MFA → profile (app1)
2. একই ব্রাউজারে http://localhost:3200 → OIDC login → **কোনো ফর্ম না**, সোজা profile (app2)। এটাই SSO।
3. app2 এর ID token এ `auth_time` app1 এর সময়ের = নতুন লগইন হয়নি, session থেকে এসেছে।
4. app1 এ Log out (OIDC end-session) → app2 তে আবার login → ফর্ম আসে (session শেষ)। না এলে ধাপ ৪ এর Track Adapter Sessions for Logout দেখো।

### ৯.৪ বসের দেখানোর মতো করে সাজানো (ঐচ্ছিক)

- app1 = OIDC (`pflab-node-app`), app2 = SAML (SP connection `pflab-node-app`, আছে): এক লগইনে দুই protocol। lab app এ OIDC আর SAML দুই বাটনই আছে, তাই এক app দিয়েই দেখানো যায়।
- app দুনোর জন্য আলাদা নিয়ম চাইলে (যেমন app2 তে সবাই ঢুকবে, app1 শুধু admin): policy এর শুরুতে **OAuth Client Set Authentication Selector** → client অনুযায়ী দুই শাখা। এটা শেখার তৃতীয় ধাপ।

**✔ যাচাই:** Admin console → Authentication → Policies → Sessions → Session Management এ user এর একটা session, তার নিচে দুই client এর grant (Applications → OAuth → Grant Management তেও দেখা যায়)।

## টেস্ট checklist

প্রতিটা টেস্ট Incognito তে, কারণ session থাকলে ফর্ম আসবে না। পাসওয়ার্ড pingfed/README.md এর user table এ।

| # | টেস্ট | কীভাবে | হওয়া উচিত | কোন ধাপ প্রমাণ হয় |
| --- | --- | --- | --- | --- |
| 1 | Identifier First | app1 → login → শুধু username ঘর | `ayesha.rahman` → OpenDJ ফর্ম; `karim.hossain@pingfed.lab` → AD ফর্ম | ২ |
| 2 | Non-admin block | `ayesha.rahman` (OpenDJ, non-admin) | পাসওয়ার্ড ঠিক তবু error পাতা, token নেই | ৩ |
| 3 | Non-admin block (AD) | `nadia.islam@pingfed.lab` | একই | ৩ |
| 4 | Admin + MFA | `rahim.uddin` | পাসওয়ার্ড → MFA পাতা → profile; ID token এ `role: admin`, `amr` এ `mfa` | ৩, ৫ |
| 5 | Admin + MFA (AD) | `rafiq.islam@pingfed.lab` | একই, `directory: ad` | ৩, ৫ |
| 6 | ভুল MFA | MFA তে ভুল code | Fail, token নেই; PingFederate audit.log এ failure | ৫ |
| 7 | SSO app1 → app2 | টেস্ট 4 এর পর http://localhost:3200 | ফর্ম নেই, সোজা profile | ৪, ৯ |
| 8 | Session timeout | Idle timeout 2 min করে 3 মিনিট অপেক্ষা → app2 | আবার ফর্ম | ৪ |
| 9 | Forced re-login | app এর Custom request → `prompt=login` | session থাকলেও ফর্ম | ৪ |
| 10 | Risk HIGH | VPN/Tor বা PingOne এ risk policy তে “Anonymous network = HIGH” করে | admin হলেও block | ৬ |
| 11 | Risk fallback | PingOne connection ভুল credential দিয়ে | Failure Mode অনুযায়ী MEDIUM → MFA চায়, block করে না | ৬ |
| 12 | Logout সবার | app1 Log out → app2 login | আবার ফর্ম | ৪ |
| 13 | PKCE বাধ্যতামূলক | authorization URL থেকে `code_challenge` কেটে | `invalid_request` | ৮ |

- [ ] 1–3 PingOne ছাড়াই করা যায়
- [ ] 4–7, 12 বসের মূল requirement
- [ ] 8–9 session বোঝার জন্য
- [ ] 10–11 risk বোঝার জন্য

## ভুল হলে

আগে log, তারপর অনুমান। Docker এ:

```bash
docker exec pingfederate tail -f /opt/out/instance/log/server.log      # প্রতিটা request, exception
docker exec pingfederate tail -f /opt/out/instance/log/audit.log       # কে কখন কোন adapter তে success/failure
docker exec pingfederate tail -f /opt/out/instance/log/admin.log       # admin console এ কী বদলালে
```

| লক্ষণ | কারণ | ঠিক করা |
| --- | --- | --- |
| Rule এ `isMemberOf` ড্রপডাউনে নেই | PCV বা adapter contract এ attribute নেই | ধাপ ১.২ আর ২.১: দুই জায়গায় একই নামে যোগ করো |
| admin হয়েও Fail | rule এর DN হুবহু মিলছে না (OpenDJ `ou=Groups` vs AD `CN=Users`) বা condition `EQUALS` | condition `multi-value contains (DN)`; audit.log এ attribute value দেখো |
| app2 তেও ফর্ম আসে (SSO নেই) | Authentication Sessions বন্ধ, বা adapter এর session policy off, বা app `prompt=login` পাঠাচ্ছে | ধাপ ৪.১, ৪.২; authorization URL দেখো |
| MFA প্রতি app এ আবার আসে | `pingone-mfa` এর session policy off | ধাপ ৪.২ এ on |
| “User not found” MFA তে | PingOne এ ওই username নেই / population আলাদা | PingOne Users এ একই username; বা Provision Users on |
| MFA adapter: 401/403 PingOne থেকে | PingOne connection এর credential ভুল/expired, বা worker app এ role নেই | System → External Systems → PingOne Connections → নতুন credential; PingOne app এ Identity Data Admin role |
| Protect adapter সবসময় MEDIUM | PingOne এ পৌঁছাচ্ছে না, fallback দিচ্ছে | server.log এ protect adapter এর error; Docker থেকে internet আছে কিনা |
| Identifier First এর পর ফর্মে username খালি | HTML Form node এ Input User ID Mapping দেওয়া হয়নি | ধাপ ২.২ |
| AD এ `karim.hossain@pingfed.lab` দিয়ে পাসওয়ার্ড ভুল | PCV filter শুধু `sAMAccountName` | filter এ `userPrincipalName` যোগ (ধাপ ২.২) |
| Policy Save হয় না: “incomplete branch” | কোনো শাখা Done/contract এ শেষ হয়নি (rule যোগ করলে নতুন শাখা আসে) | প্রতিটা শাখার নিচে কিছু দাও |
| ID token এ `role`/`amr` নেই | পাঁচ জায়গার কোনো একটায় নাম নেই, বা scope এ নেই | ধাপ ৮.১, ৮.২ |
| Lab app “Discovery failed” | PingFederate বন্ধ বা license শেষ (2026-11-04) | `docker compose ps`; README এর license অংশ |

**সবচেয়ে কাজের অভ্যাস:** প্রতিটা পরিবর্তনের পর Incognito তে একটা admin আর একটা non-admin দিয়ে লগইন; audit.log এ দুই লাইন দেখো। অনুমান নয়, log।

## সব নাম এক জায়গায় + অগ্রগতি

| জিনিস | নাম / ID | ধাপ |
| --- | --- | --- |
| Data store | `opendjds` (opendj:1389, Generic), `adds` (samba-ad:389, Active Directory) | ১ |
| PCV | `opendj-pcv` (`uid=${username}`), `ad-pcv` (`sAMAccountName=${username}`) + extended: displayName, title, departmentNumber/department, employeeNumber, isMemberOf/memberOf | ১ |
| Adapter | `id-first` (Identifier First), `opendj-form`, `ad-form` (HTML Form, Session State None) | ২ |
| Admin group | `cn=lab-admins,ou=Groups,dc=pingfed,dc=lab` / `CN=lab-admins,CN=Users,DC=pingfed,DC=lab` | ৩ |
| Rule | `isMemberOf` / `memberOf` multi-value contains (DN) → `admin`, Default to Success off | ৩ |
| Sessions | Enable Authentication Sessions ✔; per adapter: form ✔, mfa ✔, id-first off, protect off; idle 60 min, max 8 h | ৪ |
| PingOne connection | `pingone-lab` (System → External Systems → PingOne Connections) | ৫ |
| MFA adapter | `pingone-mfa` (PingOne MFA IdP Adapter 3.3), policy `lab-admin-mfa`, User Not Found = Block | ৫ |
| Risk adapter | `pingone-protect` (PingOne Protect IdP Adapter 1.0.8), rule `riskLevel` = HIGH → Fail | ৬ |
| Policy | `lab-main`: id-first → form → rule → protect → mfa → contract | ৭ |
| Policy contract | `lab-contract` (+ `role`) | ৭, ৮ |
| ATM / mapping / OIDC policy | `lab-jwt-atm`, context lab-contract, `lab-oidc` (+ claims `role`, `amr`) | ৮ |
| OAuth clients | `pflab-node-app` (3100), `pflab-node-app2` (3200), PKCE S256 required | ৯ |
| Test users | admin: rahim.uddin, tanvir.hasan (OpenDJ); karim.hossain, rafiq.islam (AD). non-admin: বাকি 8 জন | টেস্ট |

**অগ্রগতি (নিজে টিক দাও):**

- [ ] ধাপ ১: PCV দুটোর contract এ group attribute আছে
- [ ] ধাপ ২: `id-first` বানানো; HTML Form এ Input User ID Mapping
- [ ] ধাপ ৩: rule দিয়ে non-admin Fail (টেস্ট 2, 3)
- [ ] ধাপ ৪: sessions on; app1 → app2 ফর্ম ছাড়া (টেস্ট 7)
- [ ] PingOne trial + connection
- [ ] ধাপ ৫: admin এ MFA (টেস্ট 4, 5, 6)
- [ ] ধাপ ৬: risk HIGH block (টেস্ট 10)
- [ ] ধাপ ৮: ID token এ `role`, `amr`
- [ ] ধাপ ৯: দ্বিতীয় client, app2 চালু
- [ ] বসকে দেখানো: টেস্ট 2 → 4 → 7 → 12 এই ক্রমে

**সূত্র:** PingFederate 13.1 Admin API এর descriptor থেকে field এর নাম নেওয়া (`/pf-admin-api/v1/idp/adapters/descriptors`, `/authenticationSelectors/descriptors`, `/openapi.json`), 2026-10-20; pingfederate-lab এর PingFederate\_OIDC\_PKCE\_Guide.md, PingFederate\_Hands-on\_Checklist.md আর PingFederate\_Learning\_Notes.md; ল্যাবে যা আছে তা \~/Desktop/pingfed/README.md এ।
