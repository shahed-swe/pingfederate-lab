# OIDC + PKCE: নিজে নিজে সেটআপের পুরো গাইড

> PingFederate 13.1.2 · VM `192.168.0.29` · অ্যাপ `http://localhost:3000` · তারিখ ২০২৬-১০-১৫
> প্রতিটা ধাপে আছে: **কোথায়** → **কোন ঘরে কী** → **কেন** → **✔ যাচাই**। একটা ধাপ শেষ করে যাচাই না মিললে পরের ধাপে যেও না।

---

## সূচি
- [০. বড় ছবি](#০-বড়-ছবি)
- [১. শুরুর আগে যা থাকতে হবে](#১-শুরুর-আগে-যা-থাকতে-হবে)
- [২. PKCE: কী, কেন, কীভাবে](#২-pkce-কী-কেন-কীভাবে)
- [৩. Client এর ধরন বাছাই](#৩-client-এর-ধরন-বাছাই)
- [৪. ধাপে ধাপে PingFederate সেটআপ](#৪-ধাপে-ধাপে-pingfederate-সেটআপ)
- [৫. অ্যাপের দিক](#৫-অ্যাপের-দিক)
- [৬. টেস্ট](#৬-টেস্ট)
- [৭. ভুল হলে](#৭-ভুল-হলে)
- [৮. সব নাম ও মান এক জায়গায়](#৮-সব-নাম-ও-মান-এক-জায়গায়)
- [৯. অগ্রগতি চেকলিস্ট](#৯-অগ্রগতি-চেকলিস্ট)
- [১০. JWKS আর Introspection অনুশীলন](#১০-jwks-আর-introspection-অনুশীলন)

---

## ০. বড় ছবি

**OAuth বনাম OIDC বনাম SAML**

| | কী দেয় | ফরম্যাট |
|---|---|---|
| OAuth 2.0 | **Access Token** = API এর চাবি ("এই অ্যাপ এটা করতে পারবে") | JWT বা reference |
| OIDC | OAuth এর উপরে **ID Token** = "ইউজার কে" | সই করা JSON (JWT) |
| SAML | Assertion = "ইউজার কে" | সই করা XML |

**কী আবার ব্যবহার হবে, কী নতুন**

```
        ┌──────────── আগে থেকেই আছে (SAML এ যা বানিয়েছ) ─────────────┐
ব্রাউজার → lab-main policy → login-selector → opendj-form / ad-form → lab-contract
        └─────────────────────────────────────────────────────────────┘
                                                                   │
              SAML ✅:  lab-contract → SP Connection → SAML assertion → অ্যাপ
                                                                   │
              OIDC 🆕:  lab-contract → (ধাপ ৩) Grant Mapping
                                     → (ধাপ ৪) Access Token Mapping → (ধাপ ২) ATM → Access Token (JWT)
                                     → (ধাপ ৫) OIDC Policy → ID Token
                                     → (ধাপ ৬) OAuth Client = অ্যাপের পরিচয় + PKCE বাধ্যতামূলক
```

লগইন পেজ, adapter, selector কিছুই বদলাবে না। Policy Contract এর সুবিধাই এটা: একবার লগইন বানাও, যেকোনো প্রোটোকলে পাঠাও।

**পুরো প্রবাহ (Authorization Code + PKCE)**

```
1. অ্যাপ:      verifier বানায় → challenge = SHA256(verifier)
2. ব্রাউজার →  /as/authorization.oauth2?client_id&redirect_uri&scope=openid profile email
                                        &code_challenge=<challenge>&code_challenge_method=S256&login=ldap
3. PingFederate: lab-main → লগইন ফর্ম → lab-contract   (challenge মনে রাখে)
4. ব্রাউজার ←  http://localhost:3000/oidc/callback?code=XYZ&state=...
5. অ্যাপ সার্ভার → /as/token.oauth2   code + code_verifier (+ secret, confidential হলে)
6. PingFederate: SHA256(verifier) == challenge? → ID Token + Access Token
7. অ্যাপ:      /pf/JWKS দিয়ে ID Token এর সই যাচাই → /idp/userinfo.openid → profile পাতা
```

---

## ১. শুরুর আগে যা থাকতে হবে

| # | জিনিস | কোথায় দেখবে | অবস্থা |
|---|---|---|---|
| 1 | Base URL `https://192.168.0.29:9031` | System → Server → Protocol Settings → Federation Info | ✅ |
| 2 | Policy `lab-main` (selector → opendj-form / ad-form → `lab-contract`) | Authentication → Policies | ✅ |
| 3 | Policy Contract `lab-contract` (subject, username, email, displayName, title, department, employeeId, groups, directory) | Authentication → Policies → Policy Contracts | ✅ |
| 4 | Scopes `openid`, `profile`, `email` | System → OAuth Settings → Scope Management | ✅ |
| 5 | টেস্ট অ্যাপ চলছে | `http://localhost:3000/diagnostics` এ OIDC discovery OK | ✅ |

> ⚠ Admin console **একটা ট্যাবেই** খোলো। দুই ট্যাবে একসাথে Save করলে "Something's not right" (ConcurrentModificationException) আসে।

---

## ২. PKCE: কী, কেন, কীভাবে

**সমস্যা:** ধাপ ৪ এ `code` ব্রাউজারের ঠিকানা বারে আসে। browser history, extension, malware, বা মোবাইলে অন্য অ্যাপ এটা দেখে ফেলতে পারে। চোর code নিয়ে নিজেই token endpoint এ গেলে token পেয়ে যাবে।

**সমাধান: PKCE (Proof Key for Code Exchange, RFC 7636)**

```
লগইনের আগে (অ্যাপের ভেতরে):
   code_verifier  = 43 অক্ষরের র‍্যান্ডম লেখা                → অ্যাপ গোপনে রাখে, কখনো ব্রাউজারে যায় না
   code_challenge = BASE64URL( SHA256(code_verifier) )        → ব্রাউজার দিয়ে PingFederate এ যায়

token নেওয়ার সময়:
   অ্যাপ পাঠায় code + code_verifier
   PingFederate হিসাব করে SHA256(code_verifier) → মেলে? token : invalid_grant
```

চোরের কাছে code আছে, কিন্তু verifier নেই। hash থেকে verifier উল্টো বের করা যায় না, তাই চুরি করা code অকেজো।

**S256 বনাম plain**

| method | challenge | নিরাপদ? |
|---|---|---|
| `plain` | challenge = verifier নিজেই | ❌ ঠিকানা বারে যা যায় সেটাই গোপন সংখ্যা |
| `S256` | challenge = SHA256(verifier) | ✅ শুধু hash যায় |

**PingFederate এ PKCE এর দুই সুইচ**

| সুইচ | কোথায় | কী করে |
|---|---|---|
| **Disallow Plain PKCE** | System → OAuth Settings → Authorization Server Settings | পুরো সার্ভারে `plain` বাতিল, শুধু `S256` |
| **Require Proof Key for Code Exchange (PKCE)** | প্রতিটা OAuth Client এ | এই client এর PKCE ছাড়া অনুরোধ বাতিল |

> টিক না দিলেও client `code_challenge` পাঠালে PingFederate যাচাই করে। কিন্তু না পাঠালে ছেড়ে দেয়। **Require** দিলে PKCE ছাড়া কোনো অনুরোধ গ্রহণ হয় না। আসল "বাধ্যতামূলক" সুইচ এটাই।
>
> PKCE সেটিং **Access Token Manager এ নেই।** শুধু উপরের দুই জায়গায়।

---

## ৩. Client এর ধরন বাছাই

| | **ক) Confidential + PKCE** ⭐ সুপারিশ | **খ) Public + PKCE** |
|---|---|---|
| কারা | সার্ভারে চলা অ্যাপ (আমাদের Node অ্যাপ, Java/.NET ওয়েব অ্যাপ) | ব্রাউজারে চলা SPA (React/Angular), মোবাইল, desktop |
| secret | আছে, সার্ভারে নিরাপদে থাকে | **নেই**। কোড ইউজারের ডিভাইসে থাকে, secret লুকানো যায় না |
| token এর সময় প্রমাণ | secret **+** verifier (দুই স্তর) | শুধু verifier |
| Client Authentication | **Client Secret** | **None** |
| token request | `Authorization: Basic base64(id:secret)` + `code_verifier` | body তে `client_id` + `code_verifier` |
| অ্যাপের `.env` | `OIDC_CLIENT_SECRET=<secret>` | `OIDC_CLIENT_SECRET=` (খালি) |

**পরিকল্পনা:** প্রথমে **ক** দিয়ে সেটআপ ও টেস্ট করো। তারপর টেস্ট ৬ এ client টা **খ** তে বদলে দেখো, secret ছাড়াও PKCE একা কীভাবে রক্ষা করে।

অ্যাপ দুটোই সমর্থন করে: `.env` এ secret থাকলে ক, খালি থাকলে খ। `/diagnostics` এর **"OIDC client type"** লাইনে কোনটা চলছে দেখা যায়।

---

## ৪. ধাপে ধাপে PingFederate সেটআপ

ক্রম: **০ → (১ ✅) → ২ → ৩ → ৪ → ৫ → ৬**। ক্রম গুরুত্বপূর্ণ: পরের ধাপ আগেরটাকে ড্রপডাউনে খোঁজে।

### ধাপ ০: শুধু S256 অনুমতি (পুরো সার্ভার)

**কোথায়:** System → OAuth Settings → **Authorization Server Settings**

| ঘর | মান | কেন |
|---|---|---|
| **Disallow Plain PKCE** | ✔ | দুর্বল `plain` বাতিল |
| বাকি সব | যেমন আছে | |

→ নিচে **Save**

**✔ যাচাই:** ব্রাউজারে `https://192.168.0.29:9031/.well-known/openid-configuration` খুলে `code_challenge_methods_supported` খোঁজো।
- আগে: `["plain","S256"]`
- এখন: `["S256"]`

---

### ধাপ ১: Scopes ✅ (হয়ে গেছে)

**কোথায়:** System → OAuth Settings → Scope Management → Common Scopes

| Scope | Description |
|---|---|
| `openid` | (আগে থেকেই, OIDC বাধ্যতামূলক) |
| `profile` | Basic profile |
| `email` | Email address |

**কেন:** অ্যাপ `scope=openid profile email` চায়। তালিকায় না থাকলে `invalid_scope`।

---

### ধাপ ২: Access Token Manager `lab-jwt-atm`

**কোথায়:** Applications → OAuth → **Access Token Management** → **Create New Instance**

**ট্যাব ১: Type**

| ঘর | মান | কেন |
|---|---|---|
| Instance Name | `lab-jwt-atm` | |
| Instance ID | `labjwtatm` | পরে বদলানো যায় না |
| Type | **JSON Web Tokens** | token এর ভেতরের তথ্য অ্যাপ নিজে পড়তে পারে, শেখার জন্য ভালো |
| Parent Instance | None | |

> **JWT বনাম Reference:** JWT = তথ্যসহ সই করা token, API নিজে যাচাই করে। Reference = অর্থহীন লেখা, API কে PingFederate এর introspection endpoint এ জিজ্ঞেস করতে হয়, কিন্তু সাথে সাথে বাতিল করা যায়।

**ট্যাব ২: Instance Configuration**

| ঘর | মান | কেন |
|---|---|---|
| Token Lifetime | `60` (মিনিট) | |
| **Use Centralized Signing Key** | ✔ | PingFederate এর OAuth signing key দিয়ে সই; JWKS এ প্রকাশিত, অ্যাপ যাচাই করতে পারে |
| JWS Algorithm | **RS256** | |
| বাকি (JWE, symmetric key ইত্যাদি) | খালি / ডিফল্ট | এনক্রিপশন লাগবে না |

> **এই পাতার উপরের দুই টেবিল (Symmetric Keys, Certificates) খালি রাখো।**
> - **লাল বার্তা** "Either configuring an Active Signing Certificate Key ID or enabling 'Use Centralized Signing Key' is required…" = RS256 এ সই করতে key লাগে, দুই উপায়ের একটা বাছতে হবে।
> - **উপায় ১ ⭐ (আমরা এটা):** Use Centralized Signing Key ✔ → PingFederate এর OAuth/OIDC key দিয়ে সই (যেটা দিয়ে ID token ও সই হয়, `/pf/JWKS` এ প্রকাশিত)। Certificates টেবিলে কিছু লাগে না।
> - **উপায় ২:** Certificates টেবিলে সারি (Key ID + সার্ট) → নিচে **Active Signing Certificate Key ID** এ সেই Key ID। এই ATM এর নিজস্ব key; সাধারণত আলাদা JWKS Endpoint Path দিয়ে প্রকাশ করতে হয়।
> - **Symmetric Keys** = HMAC (HS256) বা JWE এর গোপন key। RS256 এ লাগে না।
> - SAML signing সার্ট (PingFed Lab Signing) OAuth এও ব্যবহার করা কাজ করে, কিন্তু ভালো অভ্যাস না: এক key এক কাজ।

**ট্যাব ৩: Session Validation:** **সব খালি**
- এগুলো token এর বৈধতা PingFederate এর লগইন session এর সাথে বাঁধে। Authentication Sessions চালু না থাকায় লাল সতর্কবার্তা দেখাবে, উপেক্ষা করো। পরে Sessions শেখার সময় দেখব।

**ট্যাব ৪: Access Token Attribute Contract** ⭐

"Extend the Contract" এ একটা একটা করে লিখে **Add**:

```
username   email   displayName   title   department   employeeId   groups   directory
```

**কেন:** access token এর ভেতরে এই ঘরগুলো থাকবে। পরের ধাপ (৪) এগুলো ভরবে, ধাপ ৫ এগুলো থেকে ID token বানাবে।

**ট্যাব ৫–৭:** Token Endpoint Attribute Contract **খালি** · Resource URIs **খালি** · Access Control **খালি**

**ট্যাব ৮: Summary** → মিলিয়ে **Save**

**✔ যাচাই:** Access Token Management তালিকায় `lab-jwt-atm`, Type JSON Web Tokens।

---

### ধাপ ৩: Policy Contract Grant Mapping

**কোথায়:** Authentication → **OAuth** → **Policy Contract Grant Mapping**

> ⚠ এটা **Policies** মেনুর ভেতরে না (সেখানে শুধু Policies, Fragments, Selectors, Policy Contracts, Sessions, Local Identity Profiles)। উপরে **AUTHENTICATION** চাপো → মূল পাতায় **OAuth** অংশে **Policy Contract Grant Mapping**। খুঁজে না পেলে উপরের 🔍 এ "Grant Mapping" লেখো।

1. ড্রপডাউনে **`lab-contract`** → **Add Mapping**
2. **Attribute Sources & User Lookup:** কিছু না → Next
3. **Contract Fulfillment:**

| Contract | Source | Value | কেন |
|---|---|---|---|
| `USER_KEY` | Authentication Policy Contract | `subject` | grant কার নামে রেকর্ড হবে (অনন্য পরিচয়) |
| `USER_NAME` | Authentication Policy Contract | `username` | মানুষের পড়ার মতো নাম |

4. **Issuance Criteria:** কিছু না → Next
5. **Summary** → **Save**

**কেন:** OAuth এ "grant" = ইউজার এই client কে অনুমতি দিয়েছে তার রেকর্ড। এই mapping না থাকলে PingFederate জানে না লগইনের ফল (`lab-contract`) থেকে কার grant বানাবে। তখন authorization এ error আসে।

**✔ যাচাই:** তালিকায় `lab-contract` এর সারি।

---

### ধাপ ৪: Access Token Mapping

**কোথায়:** Applications → OAuth → **Access Token Mappings**

1. **Context:** **Authentication Policy Contract: lab-contract** (⚠ Default না)
2. **Access Token Manager:** `lab-jwt-atm`
3. → **Add Mapping**
4. **Attribute Sources & User Lookup:** কিছু না → Next
5. **Contract Fulfillment:** সব Source = **Authentication Policy Contract**, Value একই নাম

| Contract | Source | Value |
|---|---|---|
| username | Authentication Policy Contract | username |
| email | Authentication Policy Contract | email |
| displayName | Authentication Policy Contract | displayName |
| title | Authentication Policy Contract | title |
| department | Authentication Policy Contract | department |
| employeeId | Authentication Policy Contract | employeeId |
| groups | Authentication Policy Contract | groups |
| directory | Authentication Policy Contract | directory |

6. **Issuance Criteria:** কিছু না → **Summary** → **Save**

> ⚠ **ড্রপডাউনে শুধু `Client Credentials` আর `Default` দেখালে:** ধাপ ৩ (Policy Contract Grant Mapping) এখনো Save হয়নি। Context তালিকায় কোনো contract আসে কেবল তার Grant Mapping থাকলে। আগে ধাপ ৩ শেষ করো, তারপর এই পাতা refresh করো।

**কেন context `lab-contract`:** তাহলে source হিসেবে contract এর সব attribute পাওয়া যায়। **Default** বাছলে source শুধু Persistent Grant (USER_KEY / USER_NAME), তখন email/groups আনা যায় না।

**✔ যাচাই:** তালিকায় সারি: `Authentication Policy Contract: lab-contract` → `lab-jwt-atm`।

---

### ধাপ ৫: OIDC Policy `lab-oidc`

**কোথায়:** Applications → OAuth → **OpenID Connect Policy Management** → **Add Policy**

**ট্যাব ১: Manage Policy**

| ঘর | মান | কেন |
|---|---|---|
| Policy ID | `lab-oidc` | |
| Name | `Lab OIDC Policy` | |
| Access Token Manager | `lab-jwt-atm` | ID token এর তথ্য এই ATM এর token থেকে আসবে |
| ID Token Lifetime | `5` (মিনিট) | ID token শুধু লগইনের মুহূর্তের প্রমাণ |
| **Include User Info in ID Token** | ✔ | claim গুলো ID token এর ভেতরেই। না দিলে অ্যাপকে userinfo থেকে আনতে হয় |
| Include Session Identifier in ID Token | খালি | `sid` claim, OIDC লগআউটের জন্য; Authentication Sessions লাগে |
| Include State Hash in ID Token | খালি | `s_hash` = `state` এর hash, FAPI/hybrid flow এ state বদলানো ধরতে |
| Include X.509 Thumbprint Header in ID Token | খালি | JWT header এ `x5t#S256` = signing সার্টের আঙুলছাপ; অ্যাপ `kid` দিয়েই key খোঁজে |
| ID Token Type (typ) Header Value | খালি | header এর `typ` নিজে ঠিক করা; খালি = ডিফল্ট |
| Return ID Token on Refresh Grant | খালি | refresh token দিয়ে নতুন access token নেওয়ার সময় নতুন ID token ও দেবে কি না |
| Return ID Token on Token Exchange Grant | খালি | Token Exchange (RFC 8693) এ ID token ও দেবে কি না |
| Reissue ID Token in Hybrid Flow | খালি | hybrid (`code id_token`) এ authorization এ এক ID token, token endpoint এ আবার দেবে কি না |
| Allow ID Token Introspection | খালি | introspection endpoint এ ID token যাচাই করা যাবে কি না (সাধারণত শুধু access/refresh token) |

**ট্যাব ২: Attribute Contract**
- `sub` আগে থেকেই আছে (core, বদলানো যায় না)
- ⚠ Extend তালিকায় PingFederate আগে থেকেই **OIDC এর ২১টা standard claim** বসিয়ে রাখে (address.*, birthdate, email, email_verified, family_name, gender, given_name, locale, middle_name, name, nickname, phone_number, phone_number_verified, picture, preferred_username, profile, updated_at, website, zoneinfo)
- **রাখো:** `email`, `name`, `preferred_username`
- **Delete করো:** বাকি সব (আমাদের ডিরেক্টরিতে এগুলোর মান নেই; রাখলে Contract Fulfillment এ প্রত্যেকটার জন্য কিছু বাছতে হবে)
- **Add করো:** `title`, `department`, `groups` (**Multi-Valued ✔**), `directory`
- শেষে তালিকা: `sub` + email, name, preferred_username, title, department, groups, directory

> এখানে `profile` একটা **claim** (ইউজারের profile পাতার URL), `profile` **scope** না। scope ট্যাব ১ এ বানিয়েছ।

**ট্যাব ৩: Attribute Scopes:** কোন scope চাইলে কোন claim যাবে

| Scope | Attributes |
|---|---|
| `email` | email |
| `profile` | name, preferred_username, title, department |

> `groups` আর `directory` কোনো scope এ না থাকায় **সবসময়** যাবে।

**ট্যাব ৪: Attribute Sources & User Lookup:** কিছু না

**ট্যাব ৫: Contract Fulfillment:** Source = **Access Token**

| Claim | Source | Value |
|---|---|---|
| sub | Access Token | `username` |
| email | Access Token | `email` |
| name | Access Token | `displayName` |
| preferred_username | Access Token | `username` |
| title | Access Token | `title` |
| department | Access Token | `department` |
| groups | Access Token | `groups` |
| directory | Access Token | `directory` |

**ট্যাব ৬: Issuance Criteria:** কিছু না → **Summary** → **Save**

তালিকায় ফিরে `lab-oidc` এর পাশে **Set as Default**।

**কেন Access Token থেকে:** OIDC Policy সরাসরি contract দেখে না। ATM এর token (ধাপ ৪ এ ভরা) থেকে নেয়। তাই ধাপ ২/৪ এর নামের সাথে এখানে হুবহু মিলতে হবে।

**✔ যাচাই:** তালিকায় `lab-oidc` এর পাশে **Default**।

---

### ধাপ ৬: OAuth Client `pflab-node-app` ⭐ PKCE এর মূল জায়গা

**কোথায়:** Applications → OAuth → **Clients** → **Add Client**

| ঘর | **ক) Confidential + PKCE** | **খ) Public + PKCE** | কেন |
|---|---|---|---|
| Client ID | `pflab-node-app` | একই | অ্যাপের `.env` এর `OIDC_CLIENT_ID` |
| Name | `Lab Node App (OIDC)` | একই | |
| **Client Authentication** | **Client Secret** → **Generate Secret** → ⚠ **এখনই কপি করো** | **None** | Save এর পর secret আর দেখা যায় না, শুধু বদলানো যায় |
| Secret Storage | **Internally Managed** | — | PingFederate নিজে (hash করে) রাখে; Secret Manager = বাইরের vault (CyberArk ইত্যাদি) থেকে আনে, আলাদা plugin লাগে |
| Client Secret Retention Period | **Use Global Settings** | — | secret বদলালে পুরনোটা কত মিনিট আরও চলবে (rotation এর সময় অ্যাপ বন্ধ না করে বদলানোর জন্য) |
| Require Pushed Authorization Requests | খালি | খালি | PAR পরে শিখব |
| **Redirect URIs** | `http://localhost:3000/oidc/callback` → **Add** | একই | হুবহু মিলতে হবে, না হলে PingFederate code অন্য ঠিকানায় পাঠাবে না |
| **Allowed Grant Types** | **Authorization Code** ✔, Refresh Token ✔ | Authorization Code ✔ | বাকি সব খালি (Implicit কখনো না) |
| Default Access Token Manager | `lab-jwt-atm` | একই | |
| **Require Proof Key for Code Exchange (PKCE)** | **✔** | **✔ বাধ্যতামূলক** (secret নেই, PKCE ই একমাত্র সুরক্ষা) | |
| Restrict Common Scopes | খালি | খালি | সব common scope চলবে |
| Bypass Approval Page | ঐচ্ছিক ✔ | ঐচ্ছিক ✔ | খালি রাখলে লগইনের পর "Allow/Deny" অনুমতির পাতা আসবে। একবার দেখতে চাইলে খালি রাখো |
| **OpenID Connect → Policy** | `lab-oidc` | একই | |
| ID Token Signing Algorithm | Default / RS256 | একই | JWKS দিয়ে যাচাইযোগ্য |
| বাকি | ডিফল্ট | | |

→ **Save**

> **localhost কেন ঠিক:** code নিয়ে redirect টা **ব্রাউজার** করে, PingFederate নিজে না। অ্যাপ আর ব্রাউজার একই ল্যাপটপে, তাই ব্রাউজারের কাছে `localhost:3000` ঠিক। নিয়ম: ঠিকানাটা কে খুলবে, তার দিক থেকে ভাবো।

**✔ যাচাই:** Clients তালিকায় `pflab-node-app`। খুলে দেখো Require PKCE ✔, Redirect URI ঠিক।

---

## ৫. অ্যাপের দিক

### ৫.১ `.env` হালনাগাদ
ফাইল: `pingfed-test-app\.env`

```ini
OIDC_CLIENT_ID=pflab-node-app
# ক) confidential: ধাপ ৬ এর secret
OIDC_CLIENT_SECRET=<নতুন secret>
# খ) public: = এর পরে কিছু না
# OIDC_CLIENT_SECRET=
```

> `.env` এ এখন যে secret আছে সেটা মুছে ফেলা পুরনো client এর। বদলাতেই হবে।

### ৫.২ অ্যাপ restart
`.env` শুধু চালুর সময় পড়ে, তাই বদলানোর পর restart লাগবে। Claude কে বলো, অথবা নিজে PowerShell এ:

```powershell
# পুরনোটা বন্ধ (port 3000 এ যা চলছে)
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
# নতুন করে চালু
cd C:\Users\shahe\OneDrive\Desktop\pingfed\pingfed-test-app
npm start
```

### ৫.৩ ✔ যাচাই: `http://localhost:3000/diagnostics`

| লাইন | হওয়া উচিত |
|---|---|
| OIDC discovery | OK, issuer `https://192.168.0.29:9031` |
| OIDC client type | ক: `confidential (client secret + PKCE S256)` · খ: `public (no secret, PKCE S256 only)` |

---

## ৬. টেস্ট

> ইউজার বদলাতে **Incognito** ব্যবহার করো (PingFederate session মনে রাখে)। পাসওয়ার্ড `lab-credentials.txt` এ।

### টেস্ট ১: OpenDJ দিয়ে লগইন
Home → **OIDC: OpenDJ** (`login=ldap`) → `ayesha.rahman`

**দেখবে:**
- ID token claims: `sub = ayesha.rahman`, `directory = OpenDJ`, email, name, groups
- Access token: ধাপ ২ এর ৮টা attribute
- UserInfo endpoint: একই claim

### টেস্ট ২: AD দিয়ে লগইন
Incognito → **OIDC: Active Directory** (`login=ad`) → `karim.hossain`
→ `directory = AD`, `department = IT`

### টেস্ট ৩: PKCE সত্যিই হচ্ছে কি না
profile → **Raw**:
- **"PKCE (S256)"**: `code_verifier` আর `code_challenge`
- **"Authorization request"**: URL এর ভেতরে `code_challenge=...` আর `code_challenge_method=S256`

দুই জায়গার challenge **একই** হবে। আর verifier কোনো URL এ নেই, কারণ সেটা শুধু সার্ভার থেকে token endpoint এ যায়।

### টেস্ট ৪: PKCE বাধ্যতামূলক কি না (Require PKCE)
এই ঠিকানা হুবহু খোলো। এতে `code_challenge` নেই:

```
https://192.168.0.29:9031/as/authorization.oauth2?response_type=code&client_id=pflab-node-app&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foidc%2Fcallback&scope=openid
```

**প্রত্যাশিত:** অ্যাপের error পাতা "PingFederate returned an error" এ `error = invalid_request` (PKCE লাগবে এমন বার্তা)।
**লগইন হয়ে গেলে:** ধাপ ৬ এ Require PKCE টিক দেওয়া হয়নি।

### টেস্ট ৫: plain বাতিল কি না (ধাপ ০)

```
https://192.168.0.29:9031/as/authorization.oauth2?response_type=code&client_id=pflab-node-app&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foidc%2Fcallback&scope=openid&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain
```

**প্রত্যাশিত:** `invalid_request` (plain অনুমোদিত না)।

### টেস্ট ৬ (ঐচ্ছিক): public client
1. Clients → `pflab-node-app` → Client Authentication **None** → Save
2. `.env` এ `OIDC_CLIENT_SECRET=` খালি → অ্যাপ restart
3. `/diagnostics` এ `public (no secret, PKCE S256 only)`
4. আবার টেস্ট ১ → secret ছাড়াই লগইন হবে, শুধু PKCE দিয়ে
5. Raw → PKCE (S256) এ `client type: public (PKCE only)`

শেষে চাইলে আবার **ক** তে ফিরে যাও (নতুন secret generate → `.env` → restart)।

### টেস্ট ৭ (ঐচ্ছিক): selector শাখা

| বাটন | শাখা | ফর্ম |
|---|---|---|
| OIDC: Unknown value (`login=xyz`) | No Match | OpenDJ |
| OIDC: no hint | Not in Request | OpenDJ |
| Custom request → prompt `login` | session থাকলেও আবার লগইন চায় | |

---

## ৭. ভুল হলে

| লক্ষণ | কোথায় | কারণ | সমাধান |
|---|---|---|---|
| `400 Invalid client_id` | লগইন শুরুতেই | client নেই / ID ভুল / Save হয়নি | ধাপ ৬ |
| `redirect_uri` mismatch | লগইন শুরুতেই | Redirect URI হুবহু মেলেনি (http/https, শেষে `/`) | ধাপ ৬ |
| `invalid_scope` | লগইন শুরুতেই | scope তালিকায় নেই | ধাপ ১ |
| `invalid_request`, code_challenge required | লগইন শুরুতেই | **ঠিক আছে**: Require PKCE কাজ করছে (টেস্ট ৪) | — |
| লগইনের পর error, grant mapping নিয়ে | লগইনের পর | Policy Contract Grant Mapping নেই | ধাপ ৩ |
| `invalid_grant` | token endpoint | verifier মেলেনি: মাঝপথে অ্যাপ restart হয়ে session হারিয়েছে, বা code পুরনো/একবার ব্যবহৃত | Home থেকে আবার লগইন |
| `invalid_client` / HTTP 401 | token endpoint | **ক:** secret ভুল বা `.env` বদলে restart হয়নি · **খ:** PingFederate এ এখনো Client Secret অথচ `.env` খালি | ৫.১, ৫.২ |
| `State mismatch` | callback | অন্য ট্যাব/পুরনো লিংক থেকে callback | Home থেকে আবার শুরু |
| claim খালি / নেই | profile | কোনো ধাপে নাম মেলেনি | contract → ধাপ ৪ → ধাপ ২ → ধাপ ৫ এর নাম মিলাও |
| শুধু `sub` আছে | profile | Access Token Mapping এর context Default | ধাপ ৪: context `lab-contract` |
| JWT সই যাচাই ব্যর্থ / issuer mismatch | callback | Base URL বদলেছে / Use Centralized Signing Key নেই | ধাপ ২, Base URL |
| সবসময় OpenDJ ফর্ম | লগইন পেজ | `login` Tracked HTTP Parameter নেই | Authentication → Policies → Tracked HTTP Parameters |
| "Something's not right" | admin console | দুই ট্যাবে একসাথে কাজ | এক ট্যাব, refresh |

**আরও খোঁজার জায়গা:** VM এ `C:\pingfederate\...\log\server.log` (OAuth error এর বিস্তারিত) · অ্যাপের error পাতায় পুরো JSON।

---

## ৮. সব নাম ও মান এক জায়গায়

| জিনিস | মান |
|---|---|
| Issuer / Base URL | `https://192.168.0.29:9031` |
| Discovery | `https://192.168.0.29:9031/.well-known/openid-configuration` |
| Authorization endpoint | `/as/authorization.oauth2` |
| Token endpoint | `/as/token.oauth2` |
| UserInfo | `/idp/userinfo.openid` |
| JWKS | `/pf/JWKS` |
| Scopes | `openid profile email` |
| ATM | `lab-jwt-atm` (ID `labjwtatm`), JWT, RS256, 60 মিনিট |
| ATM contract | username, email, displayName, title, department, employeeId, groups, directory |
| Grant Mapping | `lab-contract`: USER_KEY ← subject, USER_NAME ← username |
| Access Token Mapping | context `lab-contract` → `lab-jwt-atm` |
| OIDC Policy | `lab-oidc` (Default), ID token 5 মিনিট |
| Client | `pflab-node-app`, Authorization Code (+Refresh), **Require PKCE** ✔ |
| Redirect URI | `http://localhost:3000/oidc/callback` |
| PKCE | S256 only (Disallow Plain PKCE ✔) |
| টেস্ট ইউজার | OpenDJ `ayesha.rahman` · AD `karim.hossain` (পাসওয়ার্ড `lab-credentials.txt`) |

---

## ৯. অগ্রগতি চেকলিস্ট

- [ ] ধাপ ০: Disallow Plain PKCE ✔ → discovery তে শুধু `S256`
- [x] ধাপ ১: Scopes `profile`, `email`
- [ ] ধাপ ২: ATM `lab-jwt-atm` (JWT, Centralized Signing Key, RS256, ৮টা attribute)
- [ ] ধাপ ৩: Grant Mapping `lab-contract` (USER_KEY, USER_NAME)
- [ ] ধাপ ৪: Access Token Mapping (context `lab-contract` → `lab-jwt-atm`)
- [ ] ধাপ ৫: OIDC Policy `lab-oidc` → Set as Default
- [ ] ধাপ ৬: Client `pflab-node-app` (Client Secret, Redirect URI, Authorization Code, **Require PKCE** ✔)
- [ ] ৫.১–৫.৩: `.env` secret → restart → diagnostics "confidential"
- [ ] টেস্ট ১–২: OpenDJ আর AD লগইন
- [ ] টেস্ট ৩: Raw এ PKCE verifier/challenge
- [ ] টেস্ট ৪–৫: PKCE ছাড়া আর plain দুটোই `invalid_request`
- [ ] টেস্ট ৬ (ঐচ্ছিক): public client

---

## ১০. JWKS আর Introspection অনুশীলন

token পেয়ে অ্যাপ বা API কীভাবে নিশ্চিত হয় token টা আসল আর এখনো চলবে? **দুই উপায়:**

| | **JWKS (নিজে যাচাই)** | **Introspection (PingFederate কে জিজ্ঞেস)** |
|---|---|---|
| কীভাবে | PingFederate এর **public key** নামিয়ে token এর সই নিজে মেলায় | token পাঠিয়ে জিজ্ঞেস: "এটা কি active?" |
| ঠিকানা | `https://192.168.0.29:9031/pf/JWKS` (discovery এর `jwks_uri`) | `POST /as/introspect.oauth2` (discovery এর `introspection_endpoint`) |
| প্রতি অনুরোধে নেটওয়ার্ক | না (key একবার নামিয়ে cache) | হ্যাঁ, প্রতিবার |
| লগইন / প্রমাণ লাগে | না, public key সবাই পড়তে পারে | হ্যাঁ, client ID + secret (resource server) |
| কী জানে | সই ঠিক কি না, মেয়াদ (`exp`) | সই, মেয়াদ, **আর** বাতিল (revoke) হয়েছে কি না |
| কোন token | শুধু JWT | JWT আর reference (opaque) দুটোই |
| কারা ব্যবহার করে | ID token যাচাইয়ে অ্যাপ; দ্রুত API | reference token ব্যবহারকারী API; যেখানে সাথে সাথে বাতিল জানা জরুরি |

### JWKS কী
- **JWK** = JSON আকারে একটা key। **JWKS** = key এর সেট (তালিকা)।
- প্রতিটা JWT এর header এ থাকে **`kid`** (key id)। অ্যাপ JWKS থেকে একই `kid` এর key নিয়ে সই যাচাই করে।
- private key কখনো PingFederate ছাড়ে না। JWKS এ শুধু public key, তাই এটা সবাই পড়তে পারে।
- আমাদের JWKS এ ১৪টা key (২০২৬-১০-১৫):
  - প্রতিটা অ্যালগরিদমের (RS256, ES256/384/512) **২টা** key = **বর্তমান + পরেরটা**। PingFederate নিজে key ঘোরায় (rotation), পরেরটা আগেই প্রকাশ করে রাখে যাতে বদলের মুহূর্তে অ্যাপ না ভাঙে।
  - `use: enc` এর key = সই না, এনক্রিপশন। অ্যাপ PingFederate এর কাছে গোপন কিছু (যেমন request object) পাঠাতে চাইলে এগুলো দিয়ে এনক্রিপ্ট করে।
- আমাদের অ্যাপ লগইনের সময় ID token এর সই এভাবেই যাচাই করে (`jose.createRemoteJWKSet`)।

### Introspection কী (RFC 7662)
API (resource server) এর কাছে কেউ token দিলে, API সেটা PingFederate কে পাঠিয়ে জিজ্ঞেস করে। উত্তর:
```json
{ "active": true, "client_id": "pflab-node-app", "scope": "openid profile email", "exp": 1760000000,
  "username": "ayesha.rahman", "directory": "OpenDJ", ... }
```
বা শুধু `{ "active": false }` (মেয়াদ শেষ / বাতিল / জাল / চেনে না)। কেন active না, সেটা ইচ্ছা করেই বলে না, যাতে আক্রমণকারী কিছু না শেখে।

### অ্যাপে যা যোগ হয়েছে (Claude)
**Token lab** পাতা: OIDC লগইনের পর profile এ **Token lab (JWKS & introspection)** বাটন (`http://localhost:3000/tokens`)

| অংশ | কী দেখায় |
|---|---|
| 1 · JWKS | `/pf/JWKS` এর সব key (kid, kty, alg, use); **কোন key তোমার token সই করেছে** সবুজে |
| 2 · Verify locally | ID token, access token → VALID; **জাল token** (`directory` বদলে `TAMPERED`, পুরনো সই) → REJECTED |
| 3 · Introspection | access / জাল / ID / নিজে paste করা token PingFederate এ পাঠিয়ে উত্তর |

`.env` এ নতুন: `INTROSPECT_CLIENT_ID`, `INTROSPECT_CLIENT_SECRET` (খালি থাকলে অ্যাপের নিজের client দিয়ে introspect করে)। `/diagnostics` এ "Introspection client" লাইন।

### PingFederate সেটআপ (তুমি করবে): resource server client `pflab-api`

বাস্তবে API আলাদা জিনিস, তাই তার আলাদা client। এর কাজ শুধু token যাচাই, নিজে লগইন করে না।

**কোথায়:** Applications → OAuth → **Clients** → **Add Client**

| ঘর | মান | কেন |
|---|---|---|
| Client ID | `pflab-api` | |
| Name | `Lab API (Resource Server)` | |
| Client Authentication | **Client Secret** → Generate → ⚠ কপি | introspection এ প্রমাণ লাগে |
| Secret Storage | Internally Managed | |
| Redirect URIs | **খালি** | এই client ব্রাউজারে লগইন করে না |
| Allowed Grant Types | **শুধু Access Token Validation (Client is a Resource Server)** ✔ | এটাই introspection এর অনুমতি। বাকি সব খালি |
| Require PKCE | খালি | authorization code নেই, তাই লাগে না |
| OpenID Connect Policy | খালি / ডিফল্ট | ID token দেয় না |

→ **Save**

**`.env`:**
```ini
INTROSPECT_CLIENT_ID=pflab-api
INTROSPECT_CLIENT_SECRET=<pflab-api এর secret>
```
→ অ্যাপ restart → `/diagnostics` এ `Introspection client: pflab-api — resource server client`

### অনুশীলন

| # | কী করবে | প্রত্যাশা | কী শিখলে |
|---|---|---|---|
| J1 | ব্রাউজারে `https://192.168.0.29:9031/pf/JWKS` খোলো | key এর JSON | JWKS সবার জন্য খোলা |
| J2 | OIDC লগইন → Token lab → অংশ ১ | এক বা দুই key এর পাশে "ID token" / "Access token" | `kid` দিয়ে key খোঁজা |
| J3 | অংশ ২ | ID + access token VALID, জাল token **REJECTED** (signature verification failed) | একটা অক্ষর বদলালেও সই ভাঙে |
| J4 | ৫ মিনিট পর পাতা reload | ID token **INVALID: "exp" claim timestamp check failed**, access token তখনো VALID | ID token 5 মিনিট, access token 60 মিনিট (ধাপ ২, ৫) |
| I1 | `pflab-api` বানানোর **আগে** (INTROSPECT খালি): "My access token" → Introspect | দেখো কী আসে: active, না 401/অনুমতি নেই | অ্যাপের নিজের client এর কি introspect অনুমতি আছে |
| I2 | `pflab-api` বানিয়ে `.env` → restart → আবার লগইন → My access token | **active: true** + username, directory, scope, exp | API এভাবে token এর তথ্য পায় |
| I3 | Tampered access token | **active: false** | PingFederate ও জাল ধরে |
| I4 | My ID token | active: false বা error | ID token API এর জন্য না |
| I5 | `lab-oidc` → Manage Policy → **Allow ID Token Introspection** ✔ → Save → আবার লগইন → My ID token | এখন active: true | সেই অপশনের মানে |
| I6 | `pflab-api` এর grant type খুলে Save → Introspect | 401 / unauthorized_client | Access Token Validation grant ই অনুমতি |
| I7 | JWKS এর বাইরে: Paste a token এ আজেবাজে লেখা | active: false | অচেনা token সবসময় false |

> **মূল শিক্ষা:** JWKS দ্রুত, কিন্তু শুধু সই আর মেয়াদ জানে। Introspection ধীর (প্রতিবার PingFederate), কিন্তু বাতিল হওয়া token ও ধরতে পারে, আর reference token এর একমাত্র উপায়।
