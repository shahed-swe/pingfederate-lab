# PingFederate শেখার নোট

> এই ফাইলে আমার প্রতিটা প্রশ্ন আর তার উত্তর জমা থাকবে, যাতে পরে আবার পড়তে পারি।
> নিয়ম: আমি নিজে হাতে কনফিগার করি। Claude শুধু গাইড করে, নিজে কোনো পরিবর্তন করে না।
> সব পাসওয়ার্ড: `lab-credentials.txt` · ধাপের তালিকা: `PingFederate_Hands-on_Checklist.md`

## সূচি
1. [Data Store (ধাপ 2.1)](#1-data-store-ধাপ-21)
2. [Password Credential Validator — PCV (ধাপ 2.2)](#2-password-credential-validator--pcv-ধাপ-22)
3. [IdP Adapter — HTML Form (ধাপ 2.3)](#3-idp-adapter--html-form-ধাপ-23)
4. [প্রশ্ন-উত্তর লগ](#4-প্রশ্ন-উত্তর-লগ)

---

## 1. Data Store (ধাপ 2.1)

**অবস্থা:** ✅ তৈরি — `opendj-ds` (LDAP, `localhost:389`, Generic, `cn=Directory Manager`)

### Data Store কী
PingFederate থেকে ইউজার ডিরেক্টরির (OpenDJ) সাথে **সংযোগের সেটিং**: কোন host, কোন port, কোন অ্যাকাউন্ট দিয়ে লগইন। এটা নিজে কাউকে লগইন করায় না, কোন ফোল্ডারে ইউজার খুঁজবে তাও জানে না।

> **মনে রাখো:** OpenDJ সার্ভার (VM এ চলছে, ইউজার আছে) ≠ Data Store (PingFederate এর সংযোগ সেটিং)। রিসেটে শুধু Data Store মোছা হয়েছিল, OpenDJ এর কিছু হয়নি।

### যে সেটিং দিয়েছি

| সেটিং | মান | কেন |
|---|---|---|
| Hostname(s) | `localhost:389` → **Add** চাপতে হয় | OpenDJ আর PingFederate একই VM এ। Add না চাপলে Test Connection বন্ধ থাকে |
| Tags | খালি | বিভিন্ন region এর জন্য আলাদা সার্ভার থাকলে লাগে |
| Connection Security | None | ল্যাবে ঠিক আছে; বাস্তবে LDAPS (636) উচিত |
| Use DNS SRV Record | খালি | AD তে DNS দিয়ে domain controller খোঁজার জন্য |
| Follow LDAP Referrals | খালি | ডাটা একাধিক LDAP সার্ভারে ভাগ থাকলে লাগে |
| LDAP Type | **Generic** | নিচে ব্যাখ্যা |
| Authentication Method | Simple | DN আর পাসওয়ার্ড দিয়ে লগইন |
| Credential Storage | Internally Managed | পাসওয়ার্ড PingFederate নিজে এনক্রিপ্ট করে রাখে। Secret Manager লাগে CyberArk/Vault থাকলে |
| User DN / Password | `cn=Directory Manager` / (lab-credentials.txt) | |
| Test Connection | ড্রপডাউনে host বাছাই করে চাপো | সফল হলে তারপর Next → Save |

### LDAP Type: Generic কেন
LDAP একটা স্ট্যান্ডার্ড, কিন্তু প্রত্যেক কোম্পানির কিছু বাড়তি নিয়ম আছে। LDAP Type বললে PingFederate সেগুলো মাথায় রাখে:

| বিষয় | উদাহরণ |
|---|---|
| ডিফল্ট attribute এর নাম | AD: `sAMAccountName`; OpenDJ: `uid`/`cn` |
| গ্রুপ খোঁজা | AD: `memberOf` + nested group এর বিশেষ নিয়ম; OpenDJ: `isMemberOf` |
| বাইনারি attribute | AD এর `objectGUID`, `objectSid` |
| পাসওয়ার্ড error বোঝা | AD error 49 এর সাথে sub-code পাঠায় (`52e`, `775`…) |
| পাসওয়ার্ড policy বার্তা | PingDirectory বিস্তারিত বার্তা দেয় |

- অপশন: Active Directory, PingDirectory, Oracle Directory Server, Oracle Unified Directory, UnboundID, Generic।
- **OpenDJ তালিকায় নেই**, তাই Generic = "স্ট্যান্ডার্ড LDAP v3, কোনো বাড়তি ধারণা না করা"।
- ভুল type (যেমন OpenDJ তে Active Directory) দিলে লগইন হয়ে যায়, কিন্তু গ্রুপ বা কিছু attribute চুপচাপ খালি আসে — ধরা কঠিন।
- **নিয়ম:** যে কোম্পানির LDAP, সেই type। তালিকায় না থাকলে (OpenDJ, OpenLDAP, 389 Directory) → Generic।
- Generic এ নিজে খেয়াল রাখতে হয়: Filter `cn=${username}`, আর গ্রুপের জন্য `isMemberOf` (OpenDJ এ `memberOf` নেই)।

### আমাদের OpenDJ এর গঠন

```
dc=pingfed,dc=com                  ← base DN (naming context)
└── ou=limbosoft                   ← ইউজারদের ফোল্ডার
    ├── cn=ayesha.rahman  cn=tanvir.ahmed  cn=nusrat.jahan  cn=rafiq.islam  cn=test.user
    └── cn=lab-admins  cn=lab-users    (গ্রুপ)
```

- ইউজারের পুরো DN: `cn=ayesha.rahman,ou=limbosoft,dc=pingfed,dc=com`
- **Data Store এ `ou=limbosoft` বলার জায়গা নেই, দরকারও নেই।** এটা বলতে হয়:
  - **PCV** → Search Base
  - **Adapter** → Attribute Source এর Base DN

---

## 2. Password Credential Validator — PCV (ধাপ 2.2)

**অবস্থা:** ✅ তৈরি — `opendj-pcv` (ID `opendjpcv`, LDAP Username Password Credential Validator)

> তালিকায় Action কলামে শুধু **Delete**, "Check Usage" নেই — কারণ এখনো কেউ এই PCV ব্যবহার করছে না। Adapter বানালে Check Usage আসবে।

### PCV কী
PCV শুধু একটা প্রশ্নের উত্তর দেয়: **"এই username আর password কি ঠিক?"** লগইন পেজ দেখায় না (সেটা Adapter এর কাজ)। ৫ ধরনের PCV এর পার্থক্য শুধু **কাকে জিজ্ঞেস করে যাচাই হয়**।

### ৫ ধরনের PCV

| PCV | পাসওয়ার্ড কোথায় যাচাই হয় | কখন বাছবে | আমার ল্যাবে |
|---|---|---|---|
| **LDAP Username Password** | AD, OpenDJ, PingDirectory | কোম্পানির সাধারণ ইউজার (সবচেয়ে বেশি ব্যবহার) | ✅ এখন এটা |
| **Simple Username Password** | PingFederate এর ভেতরের ছোট তালিকা | টেস্ট, জরুরি অ্যাকাউন্ট; আসল ইউজারের জন্য না | ✅ পরে (পর্ব ৫) |
| **RADIUS Username Password** | বাইরের RADIUS সার্ভার (NPS, OTP/টোকেন সার্ভার) | VPN/Wi-Fi এর পুরনো সিস্টেম; LDAP পাসওয়ার্ডের পর OTP (দ্বিতীয় ধাপ) | ⚪ NPS সরানো হয়েছে |
| **PingID PCV (integrated RADIUS)** | PingFederate নিজেই RADIUS সার্ভার হয়; delegate PCV + PingID MFA | VPN/Citrix এ PingID MFA। ব্রাউজার লগইনে না (সেখানে PingID Adapter) | ❌ PingID লাগবে |
| **PingOne Password** | PingOne ক্লাউড ডিরেক্টরি | ক্লাউড/hybrid, LDAP থেকে PingOne এ migration | ❌ PingOne লাগবে |

### LDAP PCV কীভাবে কাজ করে
1. Data Store এর অ্যাকাউন্ট দিয়ে ইউজারকে **খোঁজে** (search): Search Base + Filter
2. ঠিক একজন পেলে, সেই ইউজারের DN আর টাইপ করা পাসওয়ার্ড দিয়ে **লগইন (bind)** করে দেখে
3. bind সফল → পাসওয়ার্ড ঠিক; ব্যর্থ → **LDAP error 49** (invalid credentials)

> পাসওয়ার্ড কখনো ডিরেক্টরি থেকে পড়া হয় না — শুধু ডিরেক্টরিই বলতে পারে bind সফল কি না।

### পাতা ১: Type

| ঘর | মান | নোট |
|---|---|---|
| Instance Name | `opendj-pcv` | |
| Instance ID | `opendjpcv` | ID তে শুধু অক্ষর আর সংখ্যা, `-` চলে না |
| Type | LDAP Username Password Credential Validator | |
| Parent Instance | None | আগের PCV এর সেটিং টেমপ্লেট হিসেবে কপি করতে চাইলে |

### পাতা ২: Instance Configuration — মূল ঘর

| ঘর | মান | মানে |
|---|---|---|
| LDAP Datastore | `opendj-ds` | কোন সার্ভারে খুঁজবে |
| Search Base | `ou=limbosoft,dc=pingfed,dc=com` | কোন ফোল্ডার থেকে খোঁজা শুরু |
| Search Filter | `cn=${username}` | ফর্মে টাইপ করা নাম `${username}` এর জায়গায় বসে |
| Scope of Search | **Subtree** | নিচের সব স্তরে খোঁজে |
| Case-Sensitive Matching | নিজের ইচ্ছা (নিচে দেখো) | |

#### Search Base আর Scope কেন গুরুত্বপূর্ণ (OpenDJ এ যাচাই করা)

| Search Base | Scope | `ayesha.rahman` পাওয়া গেল? |
|---|---|---|
| `dc=pingfed,dc=com` | One Level | ❌ ০ জন |
| `dc=pingfed,dc=com` | Subtree | ✅ |
| `ou=limbosoft,dc=pingfed,dc=com` | Subtree | ✅ (সবচেয়ে ভালো) |

- **One Level** = শুধু ঠিক নিচের স্তর। `dc=pingfed,dc=com` এর নিচে আছে শুধু `ou=limbosoft`, ইউজাররা আরও এক স্তর নিচে → কাউকে পায় না → লগইনে "ভুল username বা password", যদিও পাসওয়ার্ড ঠিক। **খুব সাধারণ ভুল।**
- Search Base `ou=limbosoft,...` দিলে খোঁজা দ্রুত, আর অন্য ফোল্ডারের এন্ট্রি (সার্ভিস অ্যাকাউন্ট) ভুল করে ধরা পড়ে না।

### পাতা ২: Show Advanced Fields

| ঘর | মান | মানে |
|---|---|---|
| Display Name Attribute | `displayName` | দেখানোর নাম ("Ayesha Rahman") |
| Mail Attribute | `mail` | পাসওয়ার্ড রিসেট/নোটিফিকেশনের email |
| Trim Username Spaces For Search | ✔ | নামের আগে-পরে ভুল space কেটে দেয় |
| Username Attribute | খালি | ফেরত দেওয়া username অন্য attribute থেকে নিতে চাইলে |
| SMS / PingID Username / Mail Search Filter / Mail Verified / Account Disabled Attribute | খালি | পাসওয়ার্ড রিসেট, SMS, PingID এর জন্য |
| Enable PingDirectory Detailed Password Policy… | বন্ধ | শুধু PingDirectory |
| Expect Password Expired Control | বন্ধ | পাসওয়ার্ডের মেয়াদ শেষের বিশেষ বার্তা বোঝার জন্য |

### পাতা ২: Authentication Error Overrides (ঐচ্ছিক)

**কী:** লগইন ব্যর্থ হলে LDAP একটা error বার্তা পাঠায়। ডিফল্টে PingFederate প্রায় সবসময় "username বা password ভুল" দেখায়। এই টেবিলে বলা যায়: *"বার্তায় অমুক লেখা থাকলে আসল কারণ অমুক"* → ইউজার সঠিক বার্তা পায় (যেমন "অ্যাকাউন্ট লক")।

**তিনটা কলাম**

| কলাম | কাজ | উদাহরণ |
|---|---|---|
| Match Expression | LDAP error বার্তার সাথে মেলানোর regex | `.*data 775.*` |
| Error | মিললে কোন ধরনের সমস্যা ধরবে | Account Locked |
| Message Properties Key | শুধু "Use Message Properties Key" বাছলে; বাকি সবক্ষেত্রে **খালি** | `lab.account.blocked` |

**একটা সারি যোগ করার নিয়ম**
1. **Add a new row to 'Authentication Error Overrides'**
2. Match Expression লেখো
3. Error বাছো
4. Message Properties Key সাধারণত খালি
5. সারির ডানের **Update** চাপো (না চাপলে সেভ হয় না)
6. ⚠ সারি বাতিল করতে সারির **Cancel**, পাতার নিচের Cancel না (ওটা পুরো PCV বাতিল করে)

**Regex:** `.*` = "যেকোনো লেখা"। `.*data 775.*` = বার্তার যেকোনো জায়গায় `data 775` থাকলে মিলবে।

**প্রতিটা অপশন (AD এর `data XXX` কোড ধরে)**

| # | Error | Match Expression | মানে |
|---|---|---|---|
| 1 | User Not Found | `.*data 525.*` | এই নামে ইউজার নেই |
| 2 | Invalid Credentials | `.*data 52e.*` | ভুল পাসওয়ার্ড |
| 3 | Not Permitted To Logon At This Time | `.*data 530.*` | নির্দিষ্ট সময় ছাড়া লগইন নিষেধ |
| 4 | Not Permitted To Logon At This Workstation | `.*data 531.*` | নির্দিষ্ট কম্পিউটার ছাড়া নিষেধ |
| 5 | Password Expired | `.*data 532.*` | পাসওয়ার্ডের মেয়াদ শেষ |
| 6 | Account Disabled | `.*data 533.*` | admin অ্যাকাউন্ট বন্ধ করেছে |
| 7 | Account Expired | `.*data 701.*` | অ্যাকাউন্টের মেয়াদ শেষ |
| 8 | User Must Reset Password | `.*data 773.*` | প্রথম লগইনে পাসওয়ার্ড বদলাতে হবে |
| 9 | Account Locked | `.*data 775.*` | অনেকবার ভুলে লক |
| 10 | Password Policy Violated | `.*CONSTRAINT_ATT_TYPE.*` বা `.*0000052D.*` | নতুন পাসওয়ার্ড নিয়ম মানেনি |
| 11 | Please Try Again Later | `.*(busy\|unavailable\|timeout).*` | সার্ভারে সাময়িক সমস্যা |
| 12 | Attribute Conflict | `.*ATTRIBUTE_OR_VALUE_EXISTS.*` | একই মান আগে থেকেই আছে (প্রোফাইল আপডেট) |
| 13 | Attribute Value Invalid | `.*INVALID_ATTRIBUTE_SYNTAX.*` | ভুল ফরম্যাটের মান |
| 14 | Invalid Telephone Number | `.*telephoneNumber.*` | ফোন নম্বর ভুল ফরম্যাট |
| 15 | User Already Exists | `.*ENTRY_EXISTS.*` | রেজিস্ট্রেশনে ইউজার আগে থেকেই আছে |
| 16 | Use Message Properties Key | যেকোনো প্যাটার্ন | নিজের বার্তা (নিচে) |

- **ক্রম গুরুত্বপূর্ণ:** নির্দিষ্ট প্যাটার্ন উপরে, সাধারণ (`.*`) সবার নিচে।
- 12–15 মূলত রেজিস্ট্রেশন বা প্রোফাইল আপডেটে আসে, সাধারণ লগইনে না।
- **User Not Found** এও ইউজার সাধারণত একই "ভুল username বা password" দেখে — ইচ্ছাকৃত নিরাপত্তা। "এই নামে কেউ নেই" বললে আক্রমণকারী বুঝে যায় কোন username আসল। আলাদা বার্তা বেশি দরকারি Account Locked, Password Expired, Account Disabled এ।

**Use Message Properties Key কীভাবে**
1. Error → **Use Message Properties Key**
2. Key ঘরে একটা নাম: `lab.account.blocked`
3. সার্ভারে `<pingfederate>\server\default\conf\language-packs\` এর ফাইলে লাইন যোগ: `lab.account.blocked=Your account is blocked. Call IT: 1234`
4. PingFederate restart

**⚠ OpenDJ এ এগুলো মিলবে না:** প্যাটার্নগুলো Active Directory র বার্তার জন্য। OpenDJ `data 775` জাতীয় কোড পাঠায় না; নিরাপত্তার জন্য প্রায় সব ব্যর্থতায় শুধু সাধারণ "invalid credentials" পাঠায়। সারি যোগ করা আর সেভ করা যাবে (প্র্যাকটিস), কিন্তু লগইনে কাজ করতে দেখবে না — এটা ভুল না।

**ফিচারটা কাজ করে কি না টেস্ট**
1. সবার নিচে: Match `.*` → Error **Account Locked** → Update
2. পর্ব ৪ এর টেস্টে ইচ্ছা করে ভুল পাসওয়ার্ড দাও
3. "অ্যাকাউন্ট লক" বার্তা দেখালে override কাজ করছে
4. ⚠ টেস্ট শেষে এই সারি **মুছে দাও**

#### Password Policy Violated কখন কাজ করে

**পাসওয়ার্ড বদলানোর সময়, সাধারণ লগইনে না।** ইউজার নতুন পাসওয়ার্ড দিল, আর ডিরেক্টরি নিয়ম না মানায় ফিরিয়ে দিল:
- খুব ছোট
- যথেষ্ট জটিল না (বড় হাতের অক্ষর, সংখ্যা বা চিহ্ন নেই)
- আগের পাসওয়ার্ডের মতো (password history)
- খুব তাড়াতাড়ি আবার বদলানো (minimum password age)

**PingFederate এ পাসওয়ার্ড বদলানোর পথ** (একটাও চালু না থাকলে এই override কখনো কাজে আসে না):

| পথ | কোথায় চালু করে | কী হয় |
|---|---|---|
| Change Password | HTML Form Adapter → **Allow Password Changes** ✔ | লগইন পেজে "Change Password" লিংক; পুরনো + নতুন পাসওয়ার্ড |
| মেয়াদ শেষ হওয়া পাসওয়ার্ড | একই adapter; ডিরেক্টরি জানায় মেয়াদ শেষ | লগইনে জোর করে নতুন পাসওয়ার্ড চায় |
| Password Reset | Adapter → **Password Reset Type** (Email link, OTP…) | email/OTP যাচাইয়ের পর নতুন পাসওয়ার্ড |

তিনটাতেই PingFederate নতুন পাসওয়ার্ড PCV দিয়ে ডিরেক্টরিতে লেখার চেষ্টা করে → ডিরেক্টরি রাজি না হলে error → "Password Policy Violated" মেলে।

**কোন error আসে**
- **Active Directory:** result **19 (constraintViolation)**, বার্তায় `0000052D` → প্যাটার্ন `.*0000052D.*`
- **OpenDJ:** এটাও result **19 (constraintViolation)**, সাথে কারণ লেখা বার্তা। লগইন ব্যর্থতায় OpenDJ কারণ লুকায়, কিন্তু পাসওয়ার্ড বদলানোর error এ সাধারণত বিস্তারিত বলে → **এই override OpenDJ তে কাজ করার সম্ভাবনা আছে** (আসল বার্তা টেস্ট করে দেখতে হবে)।

**OpenDJ তে টেস্ট (adapter বানানোর পর)**
1. OpenDJ Control Panel → Configuration → Password Policy → "Default Password Policy" তে password validator (যেমন Length-Based, কমপক্ষে ৮ অক্ষর) চালু আছে কি না দেখো / করো
2. Adapter এ **Allow Password Changes** ✔
3. PCV তে override: Match `.*` বা নির্দিষ্ট লেখা → **Password Policy Violated**
4. লগইন পেজের **Change Password** দিয়ে `test.user` এর নতুন পাসওয়ার্ড দাও `abc`
5. নিয়ম ভাঙার বার্তা দেখালে কাজ করছে → VM এর `server.log` থেকে OpenDJ এর আসল বার্তা দেখে Match Expression নির্দিষ্ট করো

**মনে রাখো**

| পরিস্থিতি | Error |
|---|---|
| লগইনে ভুল পাসওয়ার্ড | Invalid Credentials |
| নতুন পাসওয়ার্ড নিয়ম মানছে না | Password Policy Violated |
| মেয়াদ শেষ, লগইনে বদলাতে বলছে | Password Expired |

**Case-Sensitive Matching:** টিক থাকলে Match Expression মেলানোর সময় বড়-ছোট হাতের অক্ষর আলাদা (`data 52e` ≠ `DATA 52E`)। AD কোড ছোট হাতে আসে, তাই টিক থাকলেও চলে; নিরাপদ থাকতে টিক তুলে দাও।

### পাতা ৩: Extended Contract

**কী:** পাসওয়ার্ড ঠিক হলে PCV শুধু "হ্যাঁ" বলে না, ইউজারের কিছু তথ্যও ফেরত দেয়। সেই তালিকা = contract।
- **Core Contract** (বদলানো যায় না): `DN`, `givenName`, `mail`, `username`
- **Extend the Contract:** আরও LDAP attribute এর নাম লিখে **Add**

**বাধ্যতামূলক?** না। সরাসরি Next চাপলেও লগইন চলে।

**যোগ করব কেন**
1. HTML Form adapter এর Extended Contract এ **একই নামে** attribute থাকলে adapter সেটা PCV থেকে নিজেই ভরে নেয় → adapter এ আলাদা LDAP লুকআপ লাগে না
2. PCV লগইনের সময়ই ইউজারকে খোঁজে, তথ্যও একসাথে নেয় → কম LDAP অনুরোধ
3. পরের কাজে: গ্রুপ দেখে নিয়ম, অ্যাপে নাম/পদ দেখানো

**আমাদের ইউজারদের জন্য**

| Attribute | মান (ayesha.rahman) | কাজে লাগবে |
|---|---|---|
| `displayName` | Ayesha Rahman | অ্যাপে পুরো নাম |
| `sn` | Rahman | পদবি |
| `title` | System Administrator | পদ |
| `departmentNumber` | IT | বিভাগ অনুযায়ী নিয়ম |
| `employeeNumber` | E1001 | স্থায়ী কর্মী আইডি |
| `isMemberOf` | cn=lab-admins,…; cn=lab-users,… | **গ্রুপ দেখে access নিয়ম** |

**সাবধান**
- নাম হুবহু LDAP attribute এর নাম (`department` না, `departmentNumber`)
- ইউজারের attribute না থাকলে মান খালি, error না (`test.user` এর `isMemberOf` খালি)
- `isMemberOf` OpenDJ এর operational attribute — নাম ধরে চাইলে তবেই দেয়; লগইনের পর টেস্ট অ্যাপে দেখে নিশ্চিত হও
- এখানে যোগ করলেই অ্যাপ পায় না: **PCV → Adapter → Policy Contract → SP Connection → অ্যাপ** — প্রতিটা ধাপে যোগ আর map করতে হয়

**আমি যা যোগ করেছি:** `displayName`, `employeeNumber`, `isMemberOf`, `sn`, `title` ✅ (বানান হুবহু LDAP নামের সাথে মেলে)। `departmentNumber` বাদ — ঐচ্ছিক, বিভাগ অনুযায়ী নিয়ম বানাতে চাইলে পরে যোগ করা যায়।

### PCV "কিছু দেখায় না" — তাহলে attribute কেন?
"কিছু দেখায় না" = PCV এর কোনো স্ক্রিন/পেজ নেই, ইউজার একে দেখে না। কিন্তু PCV **তথ্য ফেরত দেয় — ইউজারকে না, যে তাকে ডেকেছে তাকে।**

1. Adapter লগইন পেজ দেখায়, ইউজার username/password দেয়
2. Adapter PCV কে ডাকে
3. PCV OpenDJ তে ইউজারকে খোঁজে → ইউজারের পুরো এন্ট্রি তখন তার হাতে
4. PCV পাসওয়ার্ড যাচাই করে Adapter কে ফেরত দেয়: "ঠিক আছে, আর এই নাও তার তথ্য"
5. Adapter তথ্য সামনে পাঠায় → Policy → অ্যাপ

Extended Contract = "খোঁজার সময় এন্ট্রি হাতেই পাচ্ছ, এই তথ্যগুলোও তুলে এনো" এর তালিকা।

**উদাহরণ:** ব্যাংকের পেছনের অফিসের কর্মী (PCV) গ্রাহকের সাথে কথা বলেন না, কাউন্টার (Adapter) চেক পাঠায়। তিনি ফাইল খুলে সই মেলান, আর ফাইল খোলা থাকায় নাম-ঠিকানাও লিখে পাঠান।

**এখানে কেন, adapter এ কেন না**
- একই খোঁজে তথ্য চলে আসে → adapter কে আবার OpenDJ এ খুঁজতে হয় না (Attribute Source লাগে না)
- adapter ছাড়াও PCV ব্যবহার হয়: OAuth **Resource Owner Password** grant, WS-Trust STS — সেখানে লগইন পেজ নেই, PingFederate সরাসরি PCV ডাকে; token এ ইউজারের তথ্যের সহজ উৎস PCV এর attribute

| | কাজ |
|---|---|
| PCV | ইউজারকে কিছু দেখায় না; পাসওয়ার্ড যাচাই + যে ডেকেছে তাকে তথ্য ফেরত |
| Adapter | ইউজারকে পেজ দেখায়; PCV এর তথ্য সামনে পাঠায় |
| Extended Contract | "যাচাইয়ের সময় এগুলোও তুলে আনো" |

### পাতা ৪ এর আগে Summary তে যা মিলিয়ে নেব
- LDAP Datastore: `opendj-ds`
- Search Base: `ou=limbosoft,dc=pingfed,dc=com`
- Search Filter: `cn=${username}`
- Scope of Search: Subtree
- Extended Contract: উপরের attribute গুলো

### পাতা ৪: Summary → Save
- Save এর সময় PingFederate পাসওয়ার্ড টেস্ট করে না। আসল পরীক্ষা লগইনের সময়।
- Search Base/Filter/Scope ভুল হলে লগইনে "username বা password ভুল" আসবে, যদিও পাসওয়ার্ড ঠিক।
- টেস্ট ইউজার: `ayesha.rahman` (পাসওয়ার্ড `lab-credentials.txt` এ)।

---

## 3. IdP Adapter — HTML Form (ধাপ 2.3)

**অবস্থা:** ✅ `opendj-form` তৈরি · ⏳ `ad-form` চলছে

### Adapter কী, কেন
PCV শুধু পাসওয়ার্ড যাচাই করে, ইউজারকে কিছু দেখায় না। **Adapter** ইউজারকে লগইন পেজ দেখায়, username/password PCV কে পাঠায়, আর লগইনের পর ইউজারের তথ্য বের করে দেয়।

```
ইউজার → [Adapter: লগইন পেজ] → [PCV: পাসওয়ার্ড ঠিক?] → [Data Store] → OpenDJ
```

**কোথায়:** Authentication → Integration → **IdP Adapters** → Create New Instance

### ট্যাব ধরে

| ট্যাব | কী করব |
|---|---|
| 1. Type | Name `opendj-form`, ID `opendjform`, Type **HTML Form IdP Adapter**, Parent None |
| 2. IdP Adapter | Credential Validators → নতুন সারি → `opendj-pcv` → **Update**; Challenge Retries `5`; Session State **Globally**; Remember My Username ঐচ্ছিক; বাকি সব ডিফল্ট |
| 3. Extended Contract | PCV এর **হুবহু একই নাম**: `mail`, `displayName`, `isMemberOf`, `sn`, `title`, `employeeNumber` |
| 4. Adapter Attributes | `username` এ **Pseudonym** ✔ (ইউজারের স্থায়ী পরিচয়) |
| 5. Adapter Contract Mapping | এখন কিছু না, Next (ডিফল্ট source = Adapter) |
| 6. Summary | Save |

### ট্যাব ১: Type — বিস্তারিত

| ঘর | মান | কেন |
|---|---|---|
| Instance Name | `opendj-form` | তালিকায় দেখানোর নাম |
| Instance ID | `opendjform` | ভেতরের স্থায়ী আইডি; শুধু অক্ষর-সংখ্যা; পরে বদলানো যায় না |
| Type | HTML Form IdP Adapter | username/password পেজ দেখায় |
| Parent Instance | None | আগের adapter কে টেমপ্লেট হিসেবে নিতে চাইলে |

Type ড্রপডাউনের সব adapter এর বিস্তারিত: নিচের অংশে।

### Type ড্রপডাউনের ১৭টা adapter

> ⚠ প্রথম চেষ্টায় Instance ID ভুল লিখেছিলাম `openfjform` — সঠিক `opendjform`। ID পরে বদলানো যায় না, Next এর আগে মিলিয়ে নাও।

**ক) মূল লগইন — "তুমি কে?"**

| Adapter | কাজ | কখন | লাগে |
|---|---|---|---|
| **HTML Form** ⭐ | ব্রাউজারে username/password পেজ, PCV দিয়ে যাচাই; পাসওয়ার্ড বদল/রিসেট, Remember username | প্রায় সব জায়গায় | PCV |
| HTTP Basic | ব্রাউজারের নিজস্ব পপআপ, পেছনে PCV | পুরনো ক্লায়েন্ট/স্ক্রিপ্ট, দ্রুত টেস্ট; ডিজাইন বা লগআউট নেই | PCV |
| Kerberos | ডোমেইন কম্পিউটার থেকে পেজ ছাড়া স্বয়ংক্রিয় লগইন (IWA) | অফিসের ভেতরে; আগে Kerberos, ব্যর্থ হলে HTML Form | AD, SPN, ব্রাউজার সেটিং |
| X.509 Certificate | স্মার্ট কার্ড / CAC-PIV / ডিভাইস সার্টিফিকেট দিয়ে লগইন | উচ্চ নিরাপত্তা, পরিচিত ডিভাইস | ক্লায়েন্ট সার্ট + Trusted CA |
| Mac Platform SSO | পরিচালিত Mac এ Apple Platform SSO (Kerberos এর মতো) | Mac বেশি এমন কোম্পানি | MDM |

**খ) প্রবাহ নিয়ন্ত্রণ**

| Adapter | কাজ | কখন |
|---|---|---|
| Identifier First | আগে শুধু username/email, তারপর policy পরের ধাপ ঠিক করে | domain অনুযায়ী আলাদা IdP, MFA আগে জানা (Google/Microsoft এর মতো) |
| Composite | কয়েকটা adapter Required/Sufficient দিয়ে জোড়া | পুরনো পদ্ধতি; এখন Policy র Success/Fail শাখা ভালো |
| Passthrough | নিজে যাচাই করে না, আগের তথ্য সামনে পাঠায় | policy র সাহায্যকারী; ⚠ একা ব্যবহার করলে যাচাই ছাড়া ঢুকে যায় |

**গ) বাড়তি যাচাই (MFA) — PingOne/PingID লাগে**

| Adapter | কাজ |
|---|---|
| PingID | পাসওয়ার্ডের পর মোবাইল push / OTP / fingerprint |
| PingOne MFA | SMS, email OTP, authenticator অ্যাপ, FIDO key |
| PingOne MFA Remember Me Verifier | MFA এর **আগে**: ডিভাইস বিশ্বস্ত হলে MFA বাদ |
| PingOne MFA Remember Me Manager | MFA এর **পরে**: ডিভাইসকে বিশ্বস্ত হিসেবে মনে রাখে |

**ঘ) ঝুঁকি আর পরিচয় — PingOne লাগে**

| Adapter | কাজ | কখন |
|---|---|---|
| PingOne Protect | ঝুঁকি মাপে (নতুন ডিভাইস, অস্বাভাবিক জায়গা, অসম্ভব ভ্রমণ, bot) → Low/Medium/High | ঝুঁকি অনুযায়ী policy পথ |
| PingOne Verify | সরকারি ID ছবি + selfie মিলিয়ে পরিচয় প্রমাণ | নতুন গ্রাহক (KYC), MFA হারালে |
| PingOne DaVinci | DaVinci তে no-code বানানো প্রবাহ চালায় | জটিল, ঘনঘন বদলায় এমন প্রবাহ |

**ঙ) আগে থেকে থাকা অ্যাপের সাথে সংযোগ**

| Adapter | কাজ | কখন |
|---|---|---|
| Reference ID | বাইরের অ্যাপ লগইন করিয়ে server-to-server তথ্য দেয় → reference ID → ব্রাউজার PingFederate এ → SSO চলে | নিজস্ব পুরনো পোর্টাল থেকে অন্য অ্যাপে SSO |
| OpenToken | একই উদ্দেশ্য, পুরনো পদ্ধতি: অ্যাপ এনক্রিপ্ট করা token বানায় (Java/.NET integration kit) | পুরনো সিস্টেমে; নতুন কাজে Reference ID / OIDC |

**আমাদের ল্যাবে:** ✅ HTML Form, HTTP Basic, Identifier First, Composite, Passthrough, X.509 (lab CA দিয়ে) · ⚪ Reference ID/OpenToken (অ্যাপ লাগবে) · ❌ Kerberos, Mac, PingID/PingOne এর সব।

**মনে রাখো:** adapter = "ইউজার কীভাবে প্রমাণ দেবে" — পাসওয়ার্ড, Windows লগইন, সার্টিফিকেট, মোবাইল, মুখের ছবি, বা অন্য অ্যাপের প্রমাণ।

**শেখার ক্রম:** HTML Form → HTTP Basic → Identifier First → X.509 → Passthrough/Reference ID (Composite তুলনার জন্য)।

### Cloud ছাড়া adapter — আমার ল্যাবে কোনটা সম্ভব

> ⚠ **VM এ এখন Active Directory নেই** (৩০ সেপ্টেম্বরের পরীক্ষা: Domain = WORKGROUP, AD-Domain-Services = Available/install করা না, port 88 বন্ধ)। Windows Server এ AD install করার সুযোগ থাকে, নিজে থেকে চালু থাকে না।
>
> নিজে যাচাই (VM এর PowerShell):
> ```powershell
> (Get-CimInstance Win32_ComputerSystem).Domain     # WORKGROUP = কোনো ডোমেইন নেই
> Get-WindowsFeature AD-Domain-Services             # Installed = আছে, Available = নেই
> Get-Service NTDS -ErrorAction SilentlyContinue    # কিছু না এলে AD চলছে না
> ```

| Adapter | সম্ভব? | কী লাগবে |
|---|---|---|
| HTML Form | ✅ এখনই | PCV (আছে) |
| HTTP Basic | ✅ | একই PCV |
| Identifier First | ✅ | selector/rule |
| Composite | ✅ | দুইটা adapter |
| Passthrough | ✅ | policy তে সাহায্যকারী |
| X.509 Certificate | ✅ বেশি কাজ | lab CA দিয়ে ইউজার সার্টিফিকেট, Trusted CA, ব্রাউজারে import, PingFederate এ ক্লায়েন্ট সার্টিফিকেটের আলাদা HTTPS port |
| Reference ID | ✅ | লগইন করানো একটা অ্যাপ (Node টেস্ট অ্যাপে যোগ করা যায়) |
| OpenToken | ⚪ কঠিন | Java/.NET integration kit; Node এর অফিসিয়াল kit নেই |
| Kerberos | ✅ AD বসানো হয়েছে (২০২৬-১০-০৫) | `svc-pfkerb` + SPN, Realm পাতা (3c), ডোমেইন কম্পিউটার |
| Mac Platform SSO | ❌ | Mac + MDM |

**Kerberos এর জন্য**
1. AD ডোমেইন — (ক) এই VM কে DC: AD port 389 চায় → OpenDJ কে অন্য port (1389) এ, `opendj-ds` hostname বদল, restart, ফেরানো কঠিন; (খ) আলাদা VM কে DC: পরিষ্কার
2. Service account + SPN `HTTP/<PingFederate host>`
3. ডোমেইনে যুক্ত কম্পিউটার + ব্রাউজার (ল্যাপটপ ডোমেইনে নেই → VM থেকে টেস্ট)
4. ব্রাউজারে Local Intranet এ PingFederate এর ঠিকানা; IP না, host নাম

**ক্রম:** HTML Form → HTTP Basic → Composite → Identifier First → Passthrough → X.509 → Reference ID → (AD এর পর) Kerberos

### শেখার ক্রম আর এখনকার অবস্থা (AD এর পরে হালনাগাদ)

| # | Adapter | কী শিখব | লাগবে | অবস্থা |
|---|---|---|---|---|
| 1 | HTML Form | লগইন পেজ, PCV, session, attribute | `opendj-pcv` / `ad-pcv` | ⏳ এখন |
| 2 | HTTP Basic | পপআপ লগইন, তুলনা | একই PCV | ⬜ |
| 3 | Composite | Required/Sufficient জোড়া | দুইটা adapter | ⬜ |
| 4 | Identifier First | আগে username, তারপর ডিরেক্টরি বাছাই | selector/rule | ⬜ |
| 5 | Passthrough | policy র সাহায্যকারী | policy | ⬜ |
| 6 | Kerberos | পাসওয়ার্ড ছাড়া Windows লগইন | AD ✅, svc-pfkerb + SPN, Realm, ডোমেইন কম্পিউটার | ⬜ এখন সম্ভব |
| 7 | X.509 Certificate | সার্টিফিকেট লগইন | lab CA, ইউজার সার্ট, ক্লায়েন্ট-সার্ট HTTPS port | ⬜ |
| 8 | Reference ID | নিজের অ্যাপ থেকে SSO হস্তান্তর | Node অ্যাপে কোড | ⬜ |

**HTML Form কয়টা?**
- **ক (সুপারিশ):** দুইটা — `opendj-form` (শুধু opendj-pcv), `ad-form` (শুধু ad-pcv) → পরিষ্কার attribute; Composite/Identifier First শেখার জন্য দুইটা লাগে
- **খ:** একটা adapter এ দুই PCV → প্রথমটায় না মিললে দ্বিতীয়টায়; এক পেজে দুই ডিরেক্টরি, কিন্তু attribute নাম আলাদা (`isMemberOf`/`memberOf`) → map জটিল, কোন ডিরেক্টরি বোঝা কঠিন

### ট্যাব ২: IdP Adapter — প্রতিটা ঘর (⭐ = বদলাব)

**ক) Credential Validators ⭐:** নতুন সারি → `opendj-pcv` → Update (একাধিক PCV দেওয়া যায়, উপর থেকে ক্রমে চেষ্টা)

**খ) লগইন আর session**

| ঘর | ডিফল্ট | আমার মান | মানে |
|---|---|---|---|
| Challenge Retries ⭐ | 5 | 3 | কতবার ভুলে সাময়িক আটকাবে |
| Session State ⭐ | None | **Globally** | None = প্রতিবার পেজ · Per Adapter = নিজের session · Globally = একবার লগইনে অন্য adapter/অ্যাপেও চলে |
| Session Timeout | 60 | 60 | নিষ্ক্রিয় থাকলে কত মিনিটে শেষ |
| Session Max Timeout | 480 | 480 | সর্বোচ্চ কত মিনিট |
| Enable 'Remember My Username' ⭐ | ✗ | ✔ | cookie তে নাম মনে রাখে |
| 'Remember My Username' Lifetime | 30 | 30 | দিন |
| Enable 'This is My Device' | ✗ | ✗ | বিশ্বস্ত ডিভাইসে লম্বা session (পরে) |
| Track Authentication Time | ✔ | ✔ | লগইনের সময় মনে রাখে (OIDC `max_age`) |

**গ) পাসওয়ার্ড বদল/রিসেট — এখন বন্ধ:** Allow Password Changes (Change Password লিংক) · Password Management System (বাইরের URL) · Change Password Email Notification / Show Password Expiring Warning · Password Reset Type (None/Email/OTP/PingID/SMS) · Account Unlock / Username Recovery · Notification Publisher / Local Identity Profile

**ঘ) Template — ডিফল্ট:** Login Template `html.form.login.template.html` (VM: `pingfederate\server\default\conf\template\`, বদলে লোগো/রং) · Logout Path / Redirect / Template · বাকি `...Template` = পাসওয়ার্ড/রিসেট/বার্তার পাতা

**ঙ) নিরাপত্তা:** CAPTCHA (provider লাগে) · Fail Authentication on Account Lockout · Allow Username Edits During Chaining (Identifier First এর সাথে)

**ট্যাব ২ এ আমার কাজ:** PCV `opendj-pcv`, Retries 3, Session **Globally**, Remember My Username ✔ → Next

**আমার ট্যাব ২ এর পর্যালোচনা:** Retries 3 ✅, Globally ✅, Remember Username ✅ — কিন্তু **Credential Validators টেবিল খালি ছিল** ⚠ → Add a new row → `opendj-pcv` → **Update** না করলে adapter পাসওয়ার্ডই যাচাই করতে পারে না।

**স্ক্রিনে বাড়তি যে ঘর পেলাম**

| ঘর | মানে |
|---|---|
| Change Password Policy Contract | পাসওয়ার্ড বদলের আগে একটা policy দিয়ে আবার যাচাই (যেমন MFA) |
| Password Reset Type → Authentication Policy | "ভুলে গেছি" তে পরিচয় প্রমাণ পুরো policy দিয়ে; সাথে Password Reset Policy Contract |
| Email One-Time Link / Email OTP / Text Message / PingID | রিসেটের অন্য উপায় |
| Revoke Sessions After Password Change Or Reset | পাসওয়ার্ড বদলে অন্য সব session বাতিল (unique user key লাগে) |
| Change Password Notification | বদলের পর email (PCV এর `mail`, `givenName` + Notification Publisher লাগে) |

**এই ফিচারগুলোর পূর্বশর্ত (আলাদা করে configure করতে হয়)**

| ফিচার | আগে যা লাগবে | কোথায় |
|---|---|---|
| Change Password Policy Contract | Allow Password Changes ✔ + Policy Contract + সেই contract এ শেষ হওয়া Policy | Policies |
| Reset: Email Link / Email OTP | Notification Publisher (SMTP) + PCV Mail Attribute + ইউজারের email + ডিরেক্টরিতে লেখার অধিকার | System → Monitoring & Notifications → Notification Publishers |
| Reset: Text Message | SMS Provider (Twilio জাতীয়) + PCV SMS Attribute (`mobile`) | Manage SMS Provider Settings |
| Reset: PingID | PingID অ্যাকাউন্ট | ❌ |
| Reset: Authentication Policy | Password Reset Policy Contract + Policy | Policies |
| Revoke Sessions After Change/Reset | ট্যাব ৪ এ Unique User Key Attribute + Authentication Sessions | adapter ট্যাব ৪; Policies → Sessions |
| Change Password Notification | Allow Password Changes + Notification Publisher + PCV `mail`/`givenName` | Notification Publishers |
| Account Unlock | কোনো Password Reset Type চালু | |

**লুকানো শর্ত — লেখার অধিকার:** OpenDJ (`cn=Directory Manager`) → চলবে। AD (`svc-pingfed` শুধু পড়ে) → (১) `LabUsers` এ "Reset password" delegation, (২) **AD পাসওয়ার্ড লেখা শুধু LDAPS (636)** → DC তে সার্টিফিকেট (AD CS বা lab CA)।

**ল্যাবে:** Change Password (OpenDJ) ✅ · Email OTP/Link ✅ (smtp4dev/MailHog জাতীয় টেস্ট SMTP) · Policy দিয়ে রিসেট ✅ · AD রিসেট ✅ (LDAPS + delegation এর পর) · SMS ⚪ · PingID ❌

**সিদ্ধান্ত:** "পাসওয়ার্ড ব্যবস্থাপনা" আলাদা অধ্যায় — adapter, policy, contract আর অ্যাপে লগইন চলার পরে। এখন সব বন্ধ।

**নিচের Manage… বাটন** = অন্য পাতার শর্টকাট; adapter বানানোর মাঝে চাপলে অসম্পূর্ণ কাজ হারানোর ঝুঁকি।

**Session State এর বর্ণনা:** adapter এর নিজের session এর বদলে **PingFederate Authentication Session** (Authentication → Policies → Sessions) ভালো — policy র পরে দেখব।

**Show Advanced Fields:** Template, CAPTCHA, Allow Username Edits, OTP ইত্যাদি — ডিফল্ট।

### ট্যাব ৩: Extended Contract — কী দেব

**Core (বদলানো যায় না):** `username` = টাইপ করা নাম · `policy.action` = লগইন পেজ থেকে চাওয়া বিশেষ কাজ (Forgot Password, Register) → policy তে শাখা ভাগ; সাধারণ লগইনে খালি

**Extend (PCV এর হুবহু নাম):**

| Attribute | PCV এর কোথা থেকে | উদাহরণ |
|---|---|---|
| `mail` | Core | ayesha.rahman@pingfed.lab |
| `givenName` | Core | Ayesha |
| `displayName` | Extended | Ayesha Rahman |
| `sn` | Extended | Rahman |
| `title` | Extended | System Administrator |
| `employeeNumber` | Extended | E1001 |
| `isMemberOf` | Extended | cn=lab-admins,…; cn=lab-users,… |

**সাবধান:** বানান হুবহু (ভুল হলে নীরবে খালি) · PCV যা দেয় না তা দিও না (`department` ✗) · লগইন টেস্টে খালি এলে ট্যাব ৫ এ LDAP Attribute Source

### ট্যাব ৪: Adapter Attributes — কী আর কেন

| ঘর | মান | কী / কেন |
|---|---|---|
| **Unique User Key Attribute** | `username` | session এর সাথে "কোন ইউজার" এর চিহ্ন → পাসওয়ার্ড বদলে ওই ইউজারের সব session বাতিল (Revoke Sessions), ইউজার-ভিত্তিক session হিসাব। অনন্য আর অপরিবর্তনীয় হতে হবে (displayName না) |
| **Pseudonym** | শুধু `username` ✔ | অ্যাপকে আসল নামের বদলে স্থায়ী কিন্তু অর্থহীন আইডি (hash)। একই অ্যাপে প্রতিবার একই, আলাদা অ্যাপে আলাদা → গোপনীয়তা। মান বদলালে আইডি বদলায় → তাই username (Module 6: Pseudonym and Transient Identity) |
| **Mask Log Values** | সব খালি | টিক দিলে log এ `****`; production এ mail/employeeNumber এর মতো ব্যক্তিগত তথ্য mask। ল্যাবে ভুল খুঁজতে আসল মান দরকার |
| Mask All OGNL-Expression Generated Log Values | খালি | OGNL দিয়ে বানানো মানও লুকায় (Module 9) |

**ট্যাব ৪:** `username` → Pseudonym ✔; **Mask Log Values** = log এ `****` (সংবেদনশীল তথ্য)

### ট্যাব ৫: Adapter Contract Mapping — এখন কিছু না, শুধু Next

"By default, the adapter contract is fulfilled by the adapter itself" → প্রতিটা attribute adapter নিজে ভরে (PCV থেকে, নাম মিলিয়ে রেখেছি)।

**Configure Adapter Contract এর ভেতরের wizard**

| ট্যাব | কাজ | কখন |
|---|---|---|
| Attribute Sources & User Lookup | বাড়তি উৎস: LDAP / JDBC / custom, নিজের Base DN + Filter | PCV যা দেয় না; অন্য ডিরেক্টরি থেকে আনা |
| Adapter Contract Fulfillment | প্রতিটা attribute এর উৎস: Adapter / LDAP / Text / Expression (OGNL) | নাম/মান বদলানো, অন্য উৎস |
| Issuance Criteria | শর্ত না মিললে adapter ব্যর্থ | যেমন `lab-users` এ না থাকলে আটকানো |
| Summary | মিলিয়ে দেখা | |

**কেন এখন না:** সব PCV থেকে আসছে; নাম/শর্ত Policy বা SP Connection এ ভালো (adapter সব অ্যাপের জন্য একই থাকে); খালি এলে পরে ফিরব।

**পরের পরীক্ষা:** (১) `title` → Text `Lab User` · (২) Issuance Criteria: শুধু `lab-admins` (ayesha ঢুকবে, tanvir আটকাবে) · (৩) OpenDJ লগইন + AD থেকে একটা তথ্য

**Summary তে মিলাও:** PCV `opendj-pcv` · Session Globally · ৭টা extended attribute · Pseudonym + Unique User Key `username` → **Save**

### Configure Adapter Contract এর ভেতরে — আসলে কী করা যায়

"দরকার নেই" = বাধ্যতামূলক না; কিন্তু শেখার মতো অনেক কিছু আছে।

**উপায় ক — কিছু না বদলে বের হওয়া:** Next → Next → Next → Done। ⚠ ভেতরের wizard এর **Cancel** এড়াও (পুরো adapter বাতিল হতে পারে)।

**উপায় খ — Attribute Source যোগ (বাস্তব উদাহরণ):** OpenDJ ইউজারদের `departmentNumber`, `telephoneNumber` আছে কিন্তু PCV তে নেই → LDAP লুকআপে সরাসরি আনা।

1. **Attribute Sources & User Lookup → Add Attribute Source**
   - Data Store: ID `opendjlookup`, Description `OpenDJ extra attributes`, Active Data Store `opendj-ds`
   - LDAP Directory Search: Base DN `ou=limbosoft,dc=pingfed,dc=com`, Scope Subtree, Attributes to return: `departmentNumber`, `telephoneNumber` (+ `title` পরীক্ষার জন্য)
   - LDAP Filter: `cn=${username}` (adapter এর username — PCV থেকে আলাদা দ্বিতীয় খোঁজ)
   - Summary → Done
2. **Adapter Contract Fulfillment:** প্রতিটা attribute এর **Source** (Adapter / LDAP (opendjlookup) / Text / Expression / No Mapping) + **Value**
   - ⚠ contract এ না থাকা attribute (departmentNumber, telephoneNumber) এখানে বসানো যায় না → Save এর পর Edit করে ট্যাব ৩ এ যোগ, তারপর Source = LDAP
   - এখনই পরীক্ষা: `title` → Source LDAP (opendjlookup), Value `title` → মান একই, পথ আলাদা
3. **Issuance Criteria:** উদাহরণ — Source Adapter, `isMemberOf`, Condition **multi-value contains DN**, Value `cn=lab-users,ou=limbosoft,dc=pingfed,dc=com` → শুধু lab-users ঢোকে (পরে)
4. **Summary → Done** → মূল wizard → Next → Summary → Save

**LDAP Filter পাতা:** `cn=${username}` ✅। নিচের **Values** = filter এ ব্যবহারযোগ্য variable (adapter contract এর প্রতিটা attribute `${...}`) — শুধু রেফারেন্স। যেমন `mail=${mail}`, `(&(cn=${username})(objectClass=inetOrgPerson))`। প্রতিটা দুইবার দেখানো = UI এর দেখানোর ধরন, সমস্যা না।

**পরামর্শ:** আগে উপায় ক (Save, লগইন যাচাই), তারপর Edit করে উপায় খ — একবারে একটা পরিবর্তন।

### দ্বিতীয় adapter: `ad-form` (AD)

| ট্যাব | মান | `opendj-form` থেকে পার্থক্য |
|---|---|---|
| 1 Type | Name `ad-form`, ID `adform`, HTML Form IdP Adapter | |
| 2 IdP Adapter | PCV **`ad-pcv`** (Update!), Retries 3, Session **Per Adapter**, Remember Username ✔ | Session State |
| 3 Extended Contract | `mail`, `givenName`, `displayName`, `sn`, `title`, `department`, `employeeID`, `memberOf`, `sAMAccountName`, `userPrincipalName` | AD এর নাম (isMemberOf→memberOf, employeeNumber→employeeID, departmentNumber→department) |
| 4 Adapter Attributes | Unique User Key `username`, Pseudonym `username` | একই |
| 5 Contract Mapping | কিছু না (ঐচ্ছিক: AD Attribute Source, filter `sAMAccountName=${username}`) | |
| 6 Summary | Save | |

**Session State: Globally বনাম Per Adapter**
- **Globally** = HTML Form adapter গুলোর session ভাগ → `opendj-form` এ ayesha লগইন করলে `ad-form` লগইন পেজ না দেখিয়েই ঢুকিয়ে দিতে পারে → কোন ডিরেক্টরি বোঝা যায় না
- **Per Adapter** = প্রতিটা adapter নিজের session → দুই ডিরেক্টরি আলাদা
- পরে: `opendj-form` ও Per Adapter, বা policy র Authentication Sessions দিয়ে কেন্দ্রীয় নিয়ন্ত্রণ। পরীক্ষা: দুটো Globally বনাম Per Adapter — ফলের পার্থক্য দেখা

**পরের ধাপ:** Policy Contract → Authentication Policy (দুই adapter জোড়া)

### নাম মেলানো কেন
adapter আর PCV এর attribute এর নাম মিললে HTML Form adapter মান সরাসরি PCV থেকে নেয় → আলাদা LDAP লুকআপ (Attribute Source) লাগে না। লগইন টেস্টে কোনো মান খালি এলে তখন ট্যাব ৫ এ LDAP Attribute Source যোগ করব (চেকলিস্টের পথ)।

### Adapter এর ভেতরেও তথ্য আনা যায় (ট্যাব ৫: Adapter Contract Mapping)

**Configure Adapter Contract** এ তিন অংশ:

| অংশ | কাজ |
|---|---|
| Attribute Sources & User Lookup | এক বা একাধিক উৎস (LDAP, JDBC, custom), নিজের Base DN/Filter সহ |
| Adapter Contract Fulfillment | প্রতিটা attribute কোথা থেকে: Adapter (PCV থেকে), LDAP উৎস, Text, Expression (OGNL) |
| Issuance Criteria | শর্ত না মিললে লগইন আটকানো (যেমন `lab-users` এ না থাকলে) |

**PCV বনাম Adapter**

| | PCV Extended Contract | Adapter Attribute Source |
|---|---|---|
| বাড়তি LDAP অনুরোধ | লাগে না | লাগে |
| কোথা থেকে | শুধু PCV এর ডিরেক্টরি | যেকোনো data store (অন্য LDAP, HR DB) |
| খোঁজার নিয়ম | PCV এর Search Base/Filter | নিজের Base DN/Filter |
| নাম বদলানো (`mail` → `email`) | না | হ্যাঁ |
| মান বদলানো / হিসাব | না | হ্যাঁ (Text, OGNL) |
| শর্তে আটকানো | না | হ্যাঁ (Issuance Criteria) |
| adapter ছাড়া (OAuth ROPC, STS) | কাজ করে | না |

**কখন কোনটা**
- একই ডিরেক্টরি থেকে সাধারণ তথ্য → **PCV** (সহজ, দ্রুত) — এখন এটা
- নাম/মান বদলানো, অন্য উৎস, শর্তে আটকানো → **Adapter**
- দুটো একসাথেও চলে

**তৃতীয় জায়গা:** Authentication Policy র Success শাখার **Contract Mapping** এও একই সুবিধা।

```
PCV (Extended Contract) → Adapter (Contract Mapping) → Policy (Contract Mapping) → অ্যাপ
```

নিয়ম: যত আগে সম্ভব তত সহজে আনো; অ্যাপ-নির্দিষ্ট পরিবর্তন শেষের দিকে (Policy/SP Connection) → adapter সব অ্যাপের জন্য একই থাকে।

**ছোট পরীক্ষা:** ট্যাব ৫ এ `title` এর source **Text** = `Lab User` → লগইনের পর সবার title "Lab User" → Fulfillment বোঝা যাবে → তারপর আবার Adapter এ ফেরাও।

### যাচাই
- IdP Adapters তালিকায় `opendj-form`
- PCV পাতায় `opendj-pcv` এর পাশে **Check Usage** দেখা যাবে

---

## 3a. Active Directory সেটআপ — অগ্রগতি আর নেটওয়ার্কের ঘটনা (২০২৬-১০-০৫)

**সিদ্ধান্ত:** AD বসবে এই VM এ, ডোমেইন `pingfed.lab` (NetBIOS `PINGFED`)। Data store এর port আমি নিজে বদলাব।

| ধাপ | অবস্থা |
|---|---|
| OpenDJ কনফিগ ব্যাকআপ (VM: `C:\lab-backups\opendj-config-20261005-1223.ldif`) | ✅ |
| OpenDJ LDAP port 389 → **1389** (AD এর জন্য 389 খালি) | ✅ |
| VM এর IP স্থির: `192.168.0.29/24`, gateway/DNS `192.168.0.1` | ✅ |
| PingFederate data store `opendj-ds` → `localhost:1389` | ✅ (আমি করেছি) |
| লোকাল Administrator এর পাসওয়ার্ড সেট (খালি ছিল — ডোমেইন তৈরিতে লাগে) | ✅ |
| AD + DNS role install, ডোমেইন `pingfed.lab` তৈরি, restart | ✅ |
| SYSVOL প্রস্তুত, domain controller খুঁজে পাওয়া যায় (dcdiag পাস) | ✅ |
| Firewall নিয়ম: 9999, 9031, 1389, 4444 | ✅ |

### কী ভুল হয়েছিল, কীভাবে ঠিক হলো
1. **IP মুছতেই সংযোগ কাটা:** রিমোট স্ক্রিপ্টে পুরনো IP মুছতেই সংযোগ কেটে যায়, নতুন IP আর বসেনি → VM পেল **169.254.x.x** (APIPA: Windows এর জরুরি ঠিকানা, gateway থাকে না)। শিক্ষা: রিমোট থেকে নেটওয়ার্ক বদলাতে হলে পুরো কাজ VM এর ভেতরে একবারে চালাতে হয়।
2. **সাধারণ অধিকারের জানালা:** `netsh` এ "requires elevation" → সিস্টেম সেটিং বদলাতে **Run as administrator** লাগে; `ipconfig` এর মতো দেখার কমান্ডে লাগে না।
3. **ping এ "General failure":** VM এর সঠিক IP/রাস্তা না থাকলে Windows প্যাকেট পাঠাতেই পারে না।
4. **আসল কারণ — VMware এর নেটওয়ার্ক মোড NAT:** VM ফাইলে `ethernet0.connectionType = "nat"` ছিল।

| VMware মোড | VM কোন নেটওয়ার্কে |
|---|---|
| **Bridged** | ল্যাপটপের মতোই router এর নেটওয়ার্কে (`192.168.0.x`) — আমাদের দরকার এটা |
| NAT | VMware এর আলাদা নেটওয়ার্ক (`192.168.67.x`, VMnet8) |

NAT নেটওয়ার্কে `192.168.0.29` দেওয়ায় VM কারও সাথে কথা বলতে পারছিল না ("Unidentified network", NoTraffic)। VMware → VM Settings → Network Adapter → **Bridged** (Configure Adapters এ শুধু আসল কার্ড) করার পর সব ঠিক: প্রোফাইল Private, internet আছে, PingFederate heartbeat OK, OpenDJ 1389 এ ayesha লগইন হয়।

5. **নতুন টুল:** `vmrun` (VMware Workstation এর সাথে আসে, `F:\InstallSoftwaremrun.exe`) দিয়ে নেটওয়ার্ক ছাড়াই VMware Tools এর মাধ্যমে VM এর ভেতরে কমান্ড চালানো যায়।

### AD তৈরির পরে যা যা ঘটল (শিক্ষা)
1. **খালি Administrator পাসওয়ার্ড:** নতুন ডোমেইনে লোকাল Administrator ই ডোমেইনের Administrator হয়, তাই খালি পাসওয়ার্ডে `Test-ADDSForestInstallation` ব্যর্থ হয়। পাসওয়ার্ড দেওয়ার পর Success।
2. **কাজটা VM এর ভেতরে scheduled task (SYSTEM) হিসেবে চালানো হয়েছে** — restart এ সংযোগ কাটলেও কাজ শেষ হয়।
3. **ইউজার বদল:** লোকাল `shahed` → ডোমেইন ইউজার `PINGFED\shahed` (পাসওয়ার্ড একই)।
4. **SYSVOL প্রস্তুত হয়নি:** restart এর পর DFSR সার্ভিস AD এর আগেই চালু হয়ে domain controller পায়নি (event 1202) → `SysvolReady = 0`, SYSVOL/NETLOGON share নেই → domain controller নিজেকে ঘোষণা করেনি (`nltest /dsgetdc` → 1355)। **DFSR restart** করতেই SYSVOL প্রস্তুত (event 4602)।
5. **Firewall:** প্রোফাইল Private → **DomainAuthenticated** হলো; এই VM এ firewall শুধু Domain প্রোফাইলে চালু → 9999/9031/1389 আটকে গেল। "PingFed Lab" গ্রুপে অনুমতির নিয়ম যোগ করে ঠিক।
6. **dcdiag এর DFSREvent / SystemLog failed:** গত ২৪ ঘণ্টার পুরনো error (উপরের ৪ নম্বর আর restart এর সময়ের) — এখন চলমান সমস্যা না।

**দরকারি যাচাই কমান্ড (VM এ)**
```powershell
nltest /dsgetdc:pingfed.lab                       # domain controller খুঁজে পাওয়া যায়?
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\Netlogon\Parameters).SysvolReady   # 1 হওয়া চাই
Get-SmbShare SYSVOL, NETLOGON
dcdiag /s:localhost                               # পুরো স্বাস্থ্য পরীক্ষা
Get-ADDomain -Server localhost
```

### AD তে ইউজার — কী বানানো হয়েছে আর নিজে কীভাবে বানাব

**বানানো হয়েছে (২০২৬-১০-০৫):** OU `LabUsers` তে karim.hossain, sadia.akter, imran.khan, farhana.begum, ad.tester; গ্রুপ `AD-Lab-Admins`, `AD-Lab-Users`; OU `ServiceAccounts` তে `svc-pingfed` (PingFederate এর LDAP bind এর জন্য)। পাসওয়ার্ড `lab-credentials.txt` এর **3b** অংশে। সবার LDAP লগইন যাচাই করা।

**AD vs OpenDJ এ ইউজারের নাম**

| বিষয় | OpenDJ | Active Directory |
|---|---|---|
| লগইন নাম | `cn` / `uid` (ayesha.rahman) | `sAMAccountName` (karim.hossain) বা UPN `karim.hossain@pingfed.lab` |
| DN | `cn=ayesha.rahman,ou=limbosoft,dc=pingfed,dc=com` | `CN=Karim Hossain,OU=LabUsers,DC=pingfed,DC=lab` (CN = পুরো নাম) |
| গ্রুপ attribute | `isMemberOf` | `memberOf` |
| PCV Search Filter | `cn=${username}` | `sAMAccountName=${username}` |
| পাসওয়ার্ড নিয়ম | ল্যাবে ঢিলা | জটিলতা বাধ্যতামূলক, ইউজারের নাম থাকতে পারবে না |

**নিজে ইউজার বানানোর ৪টা উপায় (সব VM এ, `PINGFED\shahed` দিয়ে লগইন করে)**

1. **Active Directory Users and Computers (ADUC)** — সবচেয়ে পরিচিত
   - Start → `dsa.msc` (বা Server Manager → Tools → Active Directory Users and Computers)
   - বাম পাশে `pingfed.lab` → `LabUsers` এ right-click → **New → User**
   - First name, Last name, **User logon name** (যেমন `nadia.islam`) → Next
   - পাসওয়ার্ড দুইবার; "User must change password at next logon" টিক তুলে দাও; "Password never expires" টিক দাও → Next → Finish
   - email/title/department: ইউজারে ডাবল-ক্লিক → **General** (E-mail), **Organization** (Title, Department) ট্যাব
   - গ্রুপে যোগ: ইউজারে right-click → **Add to a group** → `AD-Lab-Users` → Check Names → OK
   - সব attribute দেখতে: View → **Advanced Features** চালু → ইউজার → **Attribute Editor** ট্যাব
2. **Active Directory Administrative Center (ADAC)** — নতুন ধাঁচের UI
   - Start → `dsac.exe` → `pingfed (local)` → `LabUsers` → ডান পাশে **New → User**
   - এক পাতাতেই নাম, পাসওয়ার্ড, email, গ্রুপ, Organization; নিচে **Windows PowerShell History** তে সমতুল্য কমান্ড দেখা যায় (শেখার জন্য দারুণ)
3. **PowerShell** (Administrator)
   ```powershell
   New-ADUser -Name 'Nadia Islam' -SamAccountName 'nadia.islam' `
     -UserPrincipalName 'nadia.islam@pingfed.lab' -GivenName 'Nadia' -Surname 'Islam' `
     -DisplayName 'Nadia Islam' -EmailAddress 'nadia.islam@pingfed.lab' `
     -Title 'Analyst' -Department 'IT' -Path 'OU=LabUsers,DC=pingfed,DC=lab' `
     -AccountPassword (Read-Host -AsSecureString 'Password') -Enabled $true -PasswordNeverExpires $true
   Add-ADGroupMember -Identity 'AD-Lab-Users' -Members 'nadia.islam'
   Get-ADUser nadia.islam -Properties mail, memberOf     # যাচাই
   ```
4. **Command Prompt** (দ্রুত, কম তথ্য)
   ```
   net user nadia.islam * /add /domain
   net group "AD-Lab-Users" nadia.islam /add /domain
   ```
   (`*` দিলে পাসওয়ার্ড চাইবে; এভাবে ইউজার যায় ডিফল্ট `CN=Users` ফোল্ডারে, `LabUsers` এ না)

**সাধারণ ভুল:** পাসওয়ার্ডে নামের অংশ (যেমন "Nadia") রাখলে AD ফিরিয়ে দেয় — "does not meet the password policy requirements"।

### "Something's not right..." পাতা (admin console)
- **কারণ (server.log):** `ApplicationRuntimeException` ← `ConcurrentModificationException` — পুরনো (Tapestry) admin পাতার সাময়িক গোলমাল; একই session একসাথে দুই দিক থেকে বদলালে হয়। এক মিনিটে দুইবার লগইন + দুইটা ট্যাব খোলা ছিল।
- **কনফিগের ক্ষতি নেই** — শুধু পাতা দেখানোর সময়ের error।
- **ঠিক করা:** একটা ছাড়া সব ট্যাব বন্ধ → পাতার **restart** লিংক → দরকারে Sign Out, ব্রাউজার বন্ধ করে আবার লগইন।
- **log কোথায়:** `C:\Users\shahed\Desktop\pingfederate-13.1.2\pingfederate-13.1.2\pingfederate\log\` — `server.log` (error), `admin.log` (কে কখন কী করল)।
- **শিক্ষা:** admin console একটাই ট্যাবে খোলা রাখো।

### সাবধানতা
- স্থির IP `192.168.0.29` router এর DHCP অন্য কোনো ডিভাইসকে দিয়ে দিতে পারে → router এ এই IP **reserve** করে রাখা ভালো।

---

## 3b. AD এর Data Store (দ্বিতীয় data store)

**অবস্থা:** ⏳ পরের কাজ — নতুন data store (নাম `ad-ds`); OpenDJ এর `opendj-ds` যেমন আছে থাকবে।

**কোথায়:** System → Data & Credential Stores → Data Stores → Add New Data Store → Type **Directory (LDAP)**

| ঘর | মান | কেন / OpenDJ থেকে পার্থক্য |
|---|---|---|
| Hostname(s) | `localhost:389` → **Add** | AD একই VM এ, port 389 (OpenDJ এখন 1389) |
| Connection Security | None | LDAPS (636) এর জন্য AD তে সার্টিফিকেট লাগে — এখনো নেই |
| Use DNS SRV Record | খালি | (নিচে) |
| Follow LDAP Referrals | খালি | |
| **LDAP Type** | **Active Directory** | OpenDJ এ Generic; এখানে AD → `memberOf`, `objectGUID`, AD error কোড বোঝে |
| Authentication Method | Simple | |
| Credential Storage | Internally Managed | |
| **User DN** | `svc-pingfed@pingfed.lab` | AD তে UPN দিয়েও bind হয়; পুরো DN: `CN=svc-pingfed,OU=ServiceAccounts,DC=pingfed,DC=lab` |
| Password | `svc-pingfed` এর (credentials 3b) | |

তারপর ড্রপডাউনে host → **Test Connection** → Next → Summary → Save।

**কেন Administrator না, `svc-pingfed`:** সবচেয়ে কম অধিকারের নিয়ম। সাধারণ ডোমেইন ইউজার ডিরেক্টরি পড়তে পারে (খোঁজা, email, গ্রুপ), বদলাতে পারে না — PingFederate এর জন্য যথেষ্ট; পাসওয়ার্ড ফাঁস হলে ক্ষতি সীমিত। (OpenDJ এ root `cn=Directory Manager` দিয়েছিলাম কারণ আলাদা অ্যাকাউন্ট ছিল না।)

**DNS SRV Record:** টিক দিলে hostname এ `pingfed.lab` (ডোমেইন) দাও → PingFederate DNS এর SRV record থেকে domain controller খুঁজে নেয়; অনেক DC থাকলে একটা বন্ধ হলে আরেকটায় যায়। আমাদের একটা DC — এখন দরকার নেই, পরে পরীক্ষা করা যায়।

**Test Connection ব্যর্থ হলে:** Invalid credentials / 49 → DN বা পাসওয়ার্ড ভুল · Connection refused / timeout → hostname/port ভুল।

### AD PCV — `ad-pcv` (ধাপে ধাপে)

**কোথায়:** System → Data & Credential Stores → Password Credential Validators → Create New Instance

**পাতা ১:** Name `ad-pcv`, ID `adpcv`, Type LDAP Username Password Credential Validator, Parent None

**পাতা ২: Instance Configuration**

| ঘর | মান | OpenDJ থেকে পার্থক্য |
|---|---|---|
| LDAP Datastore | AD এর data store (`ad-ds`) | |
| Search Base | `OU=LabUsers,DC=pingfed,DC=lab` | |
| Search Filter | `sAMAccountName=${username}` | OpenDJ: `cn=${username}`; AD তে `cn` = পুরো নাম ("Karim Hossain") |
| Scope | Subtree | |
| Case-Sensitive Matching | **বন্ধ** | AD case-insensitive |

Filter এর বিকল্প: `userPrincipalName=${username}` (লগইন `karim.hossain@pingfed.lab`) · `(|(sAMAccountName=${username})(userPrincipalName=${username}))` (দুইভাবেই)

**Authentication Error Overrides — AD তে আসলেই কাজ করে** (AD error 49 এর সাথে `data XXX` পাঠায়):

| Match Expression | Error |
|---|---|
| `.*data 775.*` | Account Locked |
| `.*data 533.*` | Account Disabled |
| `.*data 532.*` | Password Expired |
| `.*data 773.*` | User Must Reset Password |

**Advanced:** Display Name `displayName`, Mail `mail`, Trim Username Spaces ✔

**পাতা ৩: Extended Contract**

| AD attribute | উদাহরণ (karim.hossain) | OpenDJ সমতুল্য |
|---|---|---|
| `displayName` | Karim Hossain | displayName |
| `sn` | Hossain | sn |
| `title` | Network Engineer | title |
| `department` | IT | departmentNumber |
| `employeeID` | A2001 | employeeNumber |
| `memberOf` | CN=AD-Lab-Admins,OU=LabUsers,… | **isMemberOf** |
| `sAMAccountName` | karim.hossain | — |
| `userPrincipalName` | karim.hossain@pingfed.lab | — |

> একই তথ্যের নাম দুই ডিরেক্টরিতে আলাদা → Policy Contract এ মিলিয়ে map করতে হবে (Contract এর আসল গুরুত্ব)।

**পরে টেস্ট (adapter এর পর)**

| টেস্ট | কীভাবে | দেখবে |
|---|---|---|
| ভুল পাসওয়ার্ড | sadia.akter | সাধারণ বার্তা (52e) |
| Account Disabled | ADUC → `ad.tester` → Disable Account → সঠিক পাসওয়ার্ড | 533 override এর বার্তা |
| User Must Reset | ADUC → Account ট্যাব → "User must change password at next logon" | 773 এর বার্তা |
| Account Locked | AD তে ডিফল্ট lockout threshold = 0 (লক হয় না) → Group Policy তে চালু করতে হবে | পরে |

টেস্ট শেষে `ad.tester` আবার Enable।

---

## 3c. Active Directory Domains / Kerberos Realms

**Realm = Kerberos এর "ডোমেইন"** — কোন ইউজার আর সার্ভিস একই টিকিট অফিস (**KDC**) কে বিশ্বাস করে তার এলাকা। প্রতিটা AD ডোমেইনই একটা Kerberos realm: `pingfed.lab` → realm **`PINGFED.LAB`** (বড় হাতে), KDC = `WIN-60PG2A911IE`, port 88।

**PingFederate কী করে (Kerberos লগইন — পাসওয়ার্ড ছাড়া)**
1. ইউজার ডোমেইন কম্পিউটারে লগইন → KDC থেকে মূল টিকিট
2. ব্রাউজার PingFederate এ → PingFederate বলে "Negotiate"
3. ব্রাউজার KDC এর কাছে PingFederate এর জন্য সার্ভিস টিকিট চায়
4. টিকিট এনক্রিপ্ট করা PingFederate এর service account এর পাসওয়ার্ড দিয়ে
5. PingFederate সেই পাসওয়ার্ড জানে (এই পাতায় দেওয়া) → টিকিট খুলে ইউজার চেনে

**LDAP Data Store বনাম Kerberos Realm**

| | LDAP Data Store | AD Domain / Kerberos Realm |
|---|---|---|
| কাজ | খোঁজা, পাসওয়ার্ড যাচাই, তথ্য আনা | Kerberos টিকিট যাচাই |
| কে ব্যবহার করে | PCV, attribute lookup | Kerberos Adapter, Kerberos Token Processor |
| ইউজার দেয় | username + password | কিছু না (Windows লগইনের টিকিট) |
| Port | 389 / 636 | 88 |
| Account | পড়তে পারা অ্যাকাউন্ট (`svc-pingfed`) | যার নামে **SPN** নিবন্ধিত |

> AD PCV এর জন্য এই পাতা লাগে না — শুধু Kerberos adapter এর জন্য।

**Add Domain/Realm এর ঘর**

| ঘর | মানে | আমাদের (পরে) |
|---|---|---|
| Connection Type | Direct / Through PingOne LDAP Gateway / Local Validation (DC এর সাথে যোগাযোগ ছাড়া, শুধু key দিয়ে) | Direct |
| Domain/Realm Name | | `pingfed.lab` |
| Username / Password | SPN থাকা service account | `svc-pfkerb` (বানাতে হবে) |
| Retain Previous Keys on Password Change | পাসওয়ার্ড বদলের পরও পুরনো টিকিট খোলা যায় | ✔ |
| Domain Controller / KDC Host Names | | `WIN-60PG2A911IE.pingfed.lab` |
| Test Domain/Realm Connectivity | যাচাই | |

**Kerberos adapter এর আগে যা লাগবে**
1. `svc-pfkerb` + SPN `HTTP/WIN-60PG2A911IE.pingfed.lab`
2. এই পাতায় realm
3. Kerberos Adapter → realm বাছাই
4. Policy: আগে Kerberos, ব্যর্থ হলে HTML Form
5. ডোমেইন কম্পিউটার থেকে, ব্রাউজারে PingFederate এর **নাম** দিয়ে (IP না)

---

## 3d. Adapter এর পরে — পথ আর Policy Contract

| # | ধাপ | কী | অবস্থা |
|---|---|---|---|
| ১ | Data Store, PCV, Adapter (OpenDJ + AD) | কে লগইন করছে | ✅ |
| ২ | Policy Contract | লগইনের পর স্ট্যান্ডার্ড তথ্য | ✅ `lab-contract` |
| ৩ | Selector | OpenDJ না AD | ✅ `login-selector` |
| ৪ | Authentication Policy | selector → adapter → contract | ✅ `lab-main` |
| ৫ | সার্ভারের মৌলিক সেটিং | Base URL `https://192.168.0.29:9031`, Entity ID `pingfed-lab-idp`, Signing সার্ট (চেকলিস্ট পর্ব ১) | ⏳ পরের কাজ — SP Connection এর আগে লাগবেই |
| ৬ | SP Connection | টেস্ট অ্যাপ onboarding | ⬜ |
| ৭ | টেস্ট | Node অ্যাপে OpenDJ + AD ইউজার | ⬜ |

**কেন Contract গুরুত্বপূর্ণ — একই তথ্য দুই নামে**

| তথ্য | opendj-form | ad-form |
|---|---|---|
| email | `mail` | `mail` |
| গ্রুপ | `isMemberOf` | `memberOf` |
| কর্মী আইডি | `employeeNumber` | `employeeID` |
| বিভাগ | — | `department` |

অ্যাপ যেন ডিরেক্টরি বুঝতে না পারে → contract এ একটাই নামের তালিকা, Policy তে মিলানো।

**বানানো:** Authentication → Policies → Policy Contracts → Create New Contract → নাম `lab-contract` → `subject` (core) + `username`, `email`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory` → Save। নাম আমার নিজের স্ট্যান্ডার্ড।

**Policy তে মিলানো (আগাম)**

| Contract | OpenDJ শাখা | AD শাখা |
|---|---|---|
| subject | Adapter `username` | Adapter `username` |
| email | Adapter `mail` | Adapter `mail` |
| groups | Adapter `isMemberOf` | Adapter `memberOf` |
| employeeId | Adapter `employeeNumber` | Adapter `employeeID` |
| department | খালি / `opendjlookup` → `departmentNumber` | Adapter `department` |
| directory | Text `OpenDJ` | Text `AD` |

### Selector — `login-selector` (HTTP Request Parameter)

**কেন এটা:** URL এর `login=` পড়ে রাস্তা বাছে; টেস্ট অ্যাপ আগে থেকেই `login=` পাঠায় ("OpenDJ form" বাটন = `login=ldap`; Custom request এ `ad`)।

**কোথায়:** Authentication → Policies → Selectors → Create New Instance

- পাতা ১: Name `login-selector`, ID `loginselector`, Type **HTTP Request Parameter Authentication Selector**
- ⚠ সংশোধন: এই ভার্সনে ট্যাব = **Type → Authentication Selector → Selector Result Values → Summary**। `ldap`, `ad` দিতে হবে **Selector Result Values** ট্যাবে।
- Authentication Selector ট্যাব:

| ঘর | মান | মানে |
|---|---|---|
| (Selector Result Values ট্যাব) | `ldap`, `ad` | প্রতিটা = policy তে আলাদা শাখা |
| HTTP Request Parameter Name | `login` | |
| Case-Sensitive Matching | বন্ধ | `LDAP` = `ldap` |
| Enable 'Any' Result Value | খালি | "আছে, মান যা-ই হোক" শাখা |
| Enable 'No Match' Result Value | ✔ | অচেনা মান (`login=xyz`) এর শাখা |
| Enable 'Not in Request' Result Value | ✔ | `login` না থাকলে শাখা — "no hint"/সাধারণ লগইন; না দিলে selector ব্যর্থ হয়ে **পরের policy** তে যায় (একটাই policy হলে কার্যত পথ থাকে না) |

**উদাহরণে শাখা**

| URL | শাখা |
|---|---|
| `login=ldap` | ldap |
| `login=ad` | ad |
| `login=xyz` | No Match |
| `login` নেই | Not in Request |

- **Any** = সব তালিকাভুক্ত মান মিলে একটা শাখা (আমরা আলাদা চাই → খালি)
- এই পাতায় Result Attribute Name ঘর নেই (আগে ভুল বলেছিলাম)

**Result Values (`ldap`, `ad`) মানে কী:** `login` প্যারামিটারের সম্ভাব্য মান — আমাদের নিজের **লেবেল**। PingFederate জানে না "ldap" = OpenDJ; adapter/data store এর নামও না (`blue`/`red` দিলেও চলত)। **অর্থ বসে Policy তে** — কোন শাখায় কোন adapter বসাই (ldap → opendj-form, ad → ad-form; উল্টো বসালে উল্টো কাজ)। শর্ত: অ্যাপ যা পাঠায় তার সাথে হুবহু মিল (টেস্ট অ্যাপ: বাটন `ldap`, Custom request এ `ad`)।

### ১১টা selector — ল্যাবে কোনটা সম্ভব

| # | Selector | কী দেখে | বাস্তব উদাহরণ | ল্যাবে | টেস্ট |
|---|---|---|---|---|---|
| 1 | HTTP Request Parameter | URL প্যারামিটার | অ্যাপ বলে কোন লগইন | ✅ এখন | টেস্ট অ্যাপ `login=` |
| 2 | CIDR | ইউজারের IP | অফিসের ভেতরে শুধু পাসওয়ার্ড, বাইরে MFA | ✅ | ল্যাপটপ বনাম VM এর ব্রাউজার |
| 3 | HTTP Header | header (User-Agent ইত্যাদি) | মোবাইলে আলাদা পথ | ✅ | DevTools device mode / ModHeader |
| 4 | Requested AuthN Context | অ্যাপের চাওয়া লগইন মাত্রা (SAML RequestedAuthnContext / OIDC `acr_values`) | "শক্ত লগইন চাই" | ✅ | Custom request `acr_values` |
| 5 | Connection Set (CSAS) | কোন SP connection | অ্যাপ অনুযায়ী আলাদা | ✅ | দ্বিতীয় SP connection |
| 6 | Extended Property | connection/client এ নিজের tag | `risk=high/low` | ✅ | System → Extended Properties |
| 7 | OAuth Client Set | কোন OAuth client | | ✅ OAuth অধ্যায়ে | দুই client |
| 8 | OAuth Scope | চাওয়া scope | `admin` → শক্ত লগইন | ✅ OAuth অধ্যায়ে | extra scopes |
| 9 | Session | আগে থেকে session আছে কি না | লগইন থাকলে MFA বাদ | ✅ | Authentication Sessions |
| 10 | Tag | PingFederate কোন নামে খোলা (Virtual Host Names + Tags) | দুই ব্র্যান্ড এক সার্ভারে | ✅ | AD DNS এ দুই নাম |
| 11 | Cluster Node | কোন node | data center অনুযায়ী | ❌ | standalone |

**সাধারণ নিয়ম:** প্রতিটা selector ফলাফল দেয় → policy তে প্রতিটা ফলাফল একটা শাখা → নিজে লগইন করায় না → একটার ভেতরে আরেকটা বসানো যায়।

**শেখার ক্রম:** HTTP Parameter → CIDR → HTTP Header → Requested AuthN Context → Session → CSAS + Extended Property → Tag → OAuth Client Set + Scope

**Policy তে (আগাম)**
```
login-selector
 ├─ ldap           → opendj-form → lab-contract (directory = OpenDJ)
 ├─ ad             → ad-form     → lab-contract (directory = AD)
 ├─ No Match       → opendj-form
 └─ Not in Request → opendj-form
```

**মনে রাখো:** Policies পাতার **Tracked HTTP Parameters** এ `login` — redirect এর মাঝে হারায় না।

### Authentication Policy — `lab-main`

**কোথায়:** Authentication → Policies → Policies

1. **উপরের সেটিং:** IDP AUTHENTICATION POLICIES ✔ (মূল সুইচ) · SP Authentication Policies খালি (PingFederate যখন নিজে অন্য IdP থেকে লগইন নেয়) · Fail if policy engine finds no authentication source খালি
2. **Tracked HTTP Parameters ট্যাব:** `login` → Add (redirect এর মাঝে হারায় না; না দিলে selector সবসময় "Not in Request" দেখে)
3. **Add Policy:** Name `lab-main`, Enabled ✔, Handle Failures Locally খালি (টিক = ব্যর্থতায় অ্যাপকে না জানিয়ে PingFederate এর error পাতা), Policy = **`login-selector`** → ৪ শাখা
4. **শাখায় adapter:** ldap → `opendj-form` · ad → `ad-form` · No Match → `opendj-form` · Not in Request → `opendj-form`
5. **প্রতিটা adapter এর নিচে:** Fail → **Done** · Success → **`lab-contract`** → Contract Mapping
6. **Contract Mapping:** Attribute Sources (কিছু না) → **Contract Fulfillment** → Issuance Criteria (কিছু না) → Summary → Done

| Contract | OpenDJ শাখা (৩ বার) | AD শাখা |
|---|---|---|
| subject | Adapter `username` | Adapter `username` |
| username | Adapter `username` | Adapter `username` |
| email | Adapter `mail` | Adapter `mail` |
| displayName | Adapter `displayName` | Adapter `displayName` |
| title | Adapter `title` | Adapter `title` |
| department | **No Mapping** (না থাকলে Text `N/A`) | Adapter `department` |
| employeeId | Adapter `employeeNumber` | Adapter `employeeID` |
| groups | Adapter `isMemberOf` | Adapter `memberOf` |
| directory | **Text** `OpenDJ` | **Text** `AD` |

**Contract Mapping wizard:** (১) Attribute Sources & User Lookup → Next · (২) **Contract Fulfillment** — বামে contract এর নাম, Source, Value · (৩) Issuance Criteria → Next · (৪) Summary → Done

**Source অপশন:** Adapter (adapter এর attribute থেকে বাছাই) · **Text** (নিজে লেখা, সবার জন্য একই) · Context (IP, ব্রাউজার, সময়) · Expression (OGNL, Module 9; সার্ভারে চালু না থাকলে দেখায় না) · No Mapping (খালি)

> বামে **আমার contract এর নাম** (`email`, `employeeId`, `groups`), ডানে **ডিরেক্টরির নাম** (`mail`, `employeeID`/`employeeNumber`, `memberOf`/`isMemberOf`) — এই পাতায়ই দুই দুনিয়া মেলে।

**No Match / Not in Request:** হ্যাঁ — `opendj-form`, Fail Done, Success `lab-contract`, LDAP শাখার হুবহু mapping (`directory` = OpenDJ)। কেন: এগুলো ডিফল্ট পথ, একই adapter → একই নাম → একই mapping; একই contract → অ্যাপ সবসময় একই ফরম্যাট। দুই উপায়: হাতে (প্র্যাকটিস) বা Copy/Paste (Paste এর পর mapping দেখে নিতে হয়)। আমার পরিকল্পনা: No Match হাতে, Not in Request Copy/Paste।

| শাখা | Adapter | Fail | Success | directory |
|---|---|---|---|---|
| AD | ad-form | Done | lab-contract | AD |
| LDAP | opendj-form | Done | lab-contract | OpenDJ |
| No Match | opendj-form | Done | lab-contract | OpenDJ |
| Not in Request | opendj-form | Done | lab-contract | OpenDJ |

> একই mapping তিনবার → এই একঘেয়েমিই **Fragment** এর কারণ (পরে)।

7. **শেষ:** নিচে Done → Policies তালিকা → ⚠ **পাতার নিচের Save** (না চাপলে সব হারায়) → `lab-main` Enabled ✔

**Policy tree এর লিংকগুলো**

- ⚠ প্রথম চেষ্টায় root এ `opendj-form (Adapter)` বসেছিল — selector ব্যবহার হতো না, AD পথ থাকত না। ঠিক করা: ⓧ → Selectors থেকে `login-selector` (অথবা ইচ্ছা করে আগে শুধু OpenDJ এর সহজ policy)।
- **Fail/Success এর নিচে:** ড্রপডাউন = পরের ধাপ (adapter, selector, fragment, contract) · **Done** = এখানে শেষ (Fail এ = ব্যর্থ) · **Restart** = policy আবার শুরু থেকে। আমার: Fail → Done, Success → `lab-contract` → Contract Mapping
- **Options → Incoming User ID:** আগের ধাপের username এই adapter কে দেওয়া (যেমন Identifier First এর পর লগইন পেজে নাম আগেই বসানো)। **User ID Authenticated** = আগের ধাপে পরিচয় প্রমাণিত। প্রথম ধাপে কিছু নেই → Cancel
- ⚠ **Success এ Done দিলে** policy শেষ কিন্তু contract তৈরি হয় না → অ্যাপে তথ্য পাঠাতে `lab-contract` ব্যবহার করা যায় না। ঠিক: ⓧ → Policy Contracts থেকে `lab-contract` → Contract Mapping। (Fail → Done ঠিক)
- **selector এর নিচে শুধু Copy**, Options/Rules নেই — selector কাউকে লগইন করায় না, তথ্য দেয় না; Rules শুধু তথ্য দেয় এমন ধাপে (adapter)
- **Copy দিয়ে mapping একবার:** LDAP শাখা পুরো সাজাও (opendj-form + Fail Done + Success lab-contract + mapping) → opendj-form এর **Copy** → No Match / Not in Request এর ড্রপডাউনে **Paste**
- **Options → Context / Requested User (ad-form এ দিয়েছি ✅):** অ্যাপ যে ইউজারের জন্য লগইন চায় (OIDC `login_hint`, SAML AuthnRequest `Subject`) → লগইন পেজে নাম আগে বসানো; hint না থাকলে কিছু হয় না। **User ID Authenticated খালি** — hint যে কেউ বসাতে পারে; টিক দিলে পাসওয়ার্ড ছাড়া অন্যের নামে ঢোকা যায় (মারাত্মক ত্রুটি)। adapter এর Advanced **Allow Username Edits During Chaining** বন্ধ থাকলে আগে বসানো নাম বদলানো যায় না। টেস্ট: Custom request `login=ad`, `login_hint=karim.hossain`
- **সিদ্ধান্ত — Options (Incoming User ID) এখন দেব না (Cancel):** পার্থক্য শুধু ইউজারকে নাম আবার টাইপ করতে হবে কি না (দিলে নাম আগে বসানো); লগইন/নিরাপত্তা/তথ্যে পার্থক্য নেই। কেন না: শুধু সুবিধা · আমাদের অ্যাপ সাধারণত নাম পাঠায় না · নাম লক হয়ে আটকে যাওয়ার ঝুঁকি · আগে সহজ, পরে ফিচার। **কখন দেব:** অ্যাপ সত্যি জানে কোন ইউজার, বা আগের ধাপে নাম নেওয়া হয়েছে (**Identifier First** — আসল ব্যবহার)। User ID Authenticated কখনো না (আগে পাসওয়ার্ড যাচাই না হলে)।
- **সিদ্ধান্ত — Rules এখন না:** খালি সারি **Delete** → **Cancel** (খালি বাধ্যতামূলক ঘর থাকলে Save এ error)। এখন সবাই একই পথে (Success → lab-contract)। পরে পরীক্ষা: Adapter (ad-form) · `memberOf` · multi-value contains DN · `CN=AD-Lab-Admins,OU=LabUsers,DC=pingfed,DC=lab` · Result `admins` → karim admins শাখায়, বাকিরা Success।
- **Rules:** adapter সফল হওয়ার পর তথ্য দেখে নতুন শাখা — Authentication Source · Attribute Name (`isMemberOf`) · Condition (multi-value contains DN, equal to…) · Value (`cn=lab-admins,…`) · Result (শাখার নাম `admins`)। **Default to Success** ✔ = কোনো rule না মিললে Success; না থাকলে Fail। ⚠ খালি সারি রেখে দিলে Save এ error → Delete → Cancel। (পরে গ্রুপ দিয়ে শাখা পরীক্ষা)

```
lab-main
└─ login-selector
   ├─ ldap           → opendj-form ─┬─ Fail    → Done
   │                                └─ Success → lab-contract (directory = OpenDJ)
   ├─ ad             → ad-form     ─┬─ Fail    → Done
   │                                └─ Success → lab-contract (directory = AD)
   ├─ No Match       → opendj-form  → (একই)
   └─ Not in Request → opendj-form  → (একই)
```

**Save এর আগে:** Policies তালিকা ঠিক (sources ad-form + opendj-form, selector login-selector, contract lab-contract, Enabled) → **Next → Default Authentication Sources** (খালি — কোনো policy না মিললে "শেষ ভরসা" adapter) → **Next → Tracked HTTP Parameters** `login` Add → **Save**

**এরপর:** চেকলিস্ট পর্ব ১ (Base URL, Entity ID, Signing সার্ট) → SP Connection → টেস্ট (ayesha.rahman + karim.hossain, `directory` দেখে)

### `https://192.168.0.29:9031` খুললে 403 Forbidden — স্বাভাবিক

| Port | কী | ব্রাউজারে |
|---|---|---|
| 9999 | Admin console (কনফিগ) | লগইন + প্যানেল |
| 9031 | Runtime (ইউজারের লগইন) | হোম পেজ নেই → 403 |

9031 এর ঠিকানা অ্যাপ ব্রাউজারকে পাঠায়: `/pf/heartbeat.ping` (OK) · `/idp/SSO.saml2` (SAML) · `/as/authorization.oauth2` (OIDC) · `/idp/startSSO.ping?PartnerSpId=…` (IdP-initiated)

লগইন পেজ আসে শুধু অ্যাপের অনুরোধে → আগে লাগবে: চেকলিস্ট পর্ব ১ (Base URL, Entity ID, Signing সার্ট) + SP Connection।

```
http://localhost:3000 → SAML বাটন → 9031/idp/SSO.saml2?...&login=ad
→ lab-main → login-selector → ad-form → লগইন পেজ → lab-contract → অ্যাপের profile
```

---

## 3e. টেস্ট অ্যাপ onboard — SP Connection (SAML)

**পূর্বশর্ত (চেকলিস্ট পর্ব ১):** Base URL `https://192.168.0.29:9031`, Entity ID `pingfed-lab-idp`, Signing সার্টিফিকেট

### Signing সার্টিফিকেট তৈরি (পর্ব ১.২)

**কোথায়:** Security → Signing & Decryption Keys & Certificates → Create New

| ঘর | মান | মানে |
|---|---|---|
| Common Name | `PingFed Lab Signing` | চেনার নাম (host নাম লাগে না) |
| Subject Alternative Names | খালি | SSL এ লাগে; সইয়ের সার্টে কেউ host মেলায় না |
| Organization | `PingFed Lab` | বাধ্যতামূলক |
| OU / City / State | `IAM Lab` / `Dhaka` (ঐচ্ছিক) | |
| Country | `BD` | দুই অক্ষরের কোড; পুরো নাম দিলে error |
| Validity | `730` | ২ বছর; বদলালে সব অ্যাপকে নতুনটা দিতে হয় |
| Key Algorithm / Size | RSA / 2048 | সবাই বোঝে; ন্যূনতম নিরাপদ |
| Signature Algorithm | RSA SHA256 | SHA1 অনিরাপদ |

**Self-signed ঠিক কেন:** SAML এ অ্যাপ এই নির্দিষ্ট সার্টটাই রাখে (metadata/ফাইল) → CA লাগে না (SSL এ লাগে)।

**Save এর পর:** Select Action → Export → **Certificate only** → `pingfed-test-app\pingfed-signing.crt` (⚠ "Certificate and private key" কখনো না)। ব্যবহার: SP Connection → Credentials → Signing Certificate; ঐচ্ছিক Metadata Signing। Activate করার কিছু নেই।

### Onboard এর ক্রম

| # | কাজ | কোথায় |
|---|---|---|
| ১ | Signing সার্ট | ✅ |
| ২ | Base URL + Entity ID | System → Server → Protocol Settings → Federation Info |
| ৩ | সার্ট export (Certificate only) → `pingfed-signing.crt` | Security → Signing & Decryption Keys |
| ৪ | অ্যাপের metadata সেভ (`npm start` → `/saml/metadata` → Ctrl+S `sp-metadata.xml`) | ব্রাউজার |
| ৫ | SP Connection | Applications → SP Connections |
| ৬ | `.env` মিলিয়ে চালানো | pingfed-test-app |
| ৭ | টেস্ট | `http://localhost:3000` |

**Federation Info:** Base URL `https://192.168.0.29:9031` (এখন `https://localhost:9031` — ল্যাপটপের ব্রাউজার পায় না; PingFederate সব ঠিকানা এটা দিয়ে বানায়) · SAML 2.0 Entity ID `pingfed-lab-idp` (প্রতিটা উত্তরের Issuer; অ্যাপ মিলিয়ে দেখে; পরে বদলালে সব অ্যাপে বদলাতে হয়) · SAML 1.x / WS-Fed খালি → Save

**ধাপ ৩ — সার্ট export:** Select Action → Export → Certificate only (private key না) → `pingfed-test-app\pingfed-signing.crt` (অ্যাপ এটা দিয়ে উত্তরের সই যাচাই করে)

**ধাপ ৪ — অ্যাপ চালু + metadata:** টার্মিনালে `cd pingfed-test-app` → `npm start` (টার্মিনাল খোলা রাখো) → `/diagnostics` (heartbeat OK, SAML IdP certificate OK, OIDC FAIL স্বাভাবিক) → `/saml/metadata` → Ctrl+S `sp-metadata.xml`। metadata upload করলে Entity ID/ACS নিজে বসে — বাস্তবেও অ্যাপের মালিক metadata পাঠায়। SAML cert FAIL হলে: নাম/জায়গা ভুল (`.crt.txt`, `(1).crt`) → ঠিক করে Ctrl+C → npm start।

**অ্যাপ চালানোর সময় যা পেলাম (২০২৬-১০-০৫)**
- ⚠ অ্যাপ ফোল্ডারের `pingfed-signing.crt` ছিল **পুরনো (মুছে যাওয়া) সার্টের** — export করা সঠিকটা Downloads এ গিয়েছিল। fingerprint মিলিয়ে (`CAE877…` = PingFederate এর বর্তমান) সঠিকটা বসানো হয়েছে; পুরনো = `pingfed-signing.crt.old`। শিক্ষা: একই নামের ফাইল থাকলে fingerprint মিলিয়ে দেখো — না হলে লগইনে "Invalid signature"।
- ✅ পরে ঠিক হয়েছে: Base URL `https://192.168.0.29:9031`, discovery issuer আর authorize ঠিকানাও এখন 192.168.0.29। (আগে: ⚠ **Base URL সেভ হয়নি**, Entity ID হয়েছিল।) লক্ষণ: diagnostics এ OIDC issuer `https://localhost:9031`। আবার Federation Info এ বসিয়ে Save + "Settings saved" দেখা।
- SP metadata সেভ: `pingfed\sp-metadata.xml` (entityID `pflab-node-app`, ACS `http://localhost:3000/saml/acs`)

### SP Connection — একা করার পুরো গাইড

**শুরুর আগে:** Base URL + Entity ID ✅ · Signing সার্ট ✅ · `lab-main` + `lab-contract` ✅ · অ্যাপ চলছে, `pingfed\sp-metadata.xml` ✅

**কোথায়:** Applications → SP Connections → Create Connection

| পাতা | কী দেব | কেন |
|---|---|---|
| 1 Connection Template | Do not use a template | template = Salesforce জাতীয় পরিচিত অ্যাপের জন্য |
| 2 Connection Type | Browser SSO Profiles ✔, SAML 2.0 | |
| 3 Connection Options | Browser SSO ✔ | |
| 4 Import Metadata | File → `sp-metadata.xml` → Metadata Summary | Entity ID/ACS নিজে বসে |
| 5 General Info | Entity ID `pflab-node-app` (বদলাব না), Name `Lab Node App`, Transaction Logging Standard | |
| 6 Browser SSO | (নিচে) | |
| 7 Credentials | Signing Certificate = PingFed Lab Signing, RSA SHA256 | assertion এ সই |
| 8 Activation & Summary | **Active** → **Save** ⚠ | |

**৬. Configure Browser SSO**
- **ক. SAML Profiles:** IdP-Initiated ✔, SP-Initiated ✔, SLO খালি
- **খ. Assertion Lifetime:** 5 / 5 (কম = চুরি হলেও পরে কাজে লাগে না)
- **গ. Assertion Creation:**
  1. Identity Mapping **Standard** (আসল পরিচয়; Pseudonym/Transient পরে)
  2. Attribute Contract: `SAML_SUBJECT` (= NameID) + `email`, `username`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory`; Name Format ডিফল্ট
  3. **Map New Authentication Policy** (Adapter Instance না) → `lab-contract` → Mapping Method "Use only the Authentication Policy Contract values…" → Fulfillment: সব Source = **Authentication Policy Contract**, Value একই নাম (SAML_SUBJECT ← `subject`) → Issuance Criteria কিছু না → Done → Done
  - কেন contract: অ্যাপ জানবে না OpenDJ না AD — সবসময় একই ফরম্যাট
- **ঘ. Protocol Settings:** ACS POST `http://localhost:3000/saml/acs` Default ✔ · Bindings Redirect ✔ POST ✔ (Artifact/SOAP না) · **Always sign the SAML Assertion** ✔ (signed AuthnRequest লাগবে না) · Encryption None → Done
- **ঙ.** Browser SSO Summary → Done

**General Info পর্যালোচনা — সব ঠিক:** Entity ID `pflab-node-app` (কখনো বদলাবে না) · Connection Name শুধু দেখানোর · Virtual Server IDs = অন্য নামে পরিচয় · **Base URL `http://localhost:3000`** = অ্যাপের ঠিকানা (ACS কে `/saml/acs` লেখা যায়) · Application Name/Icon = পোর্টাল · Transaction Logging: Don't Log / **Standard** (কে, কখন, ফল) / Enhanced / Full (পুরো SAML বার্তা — debug এ, ব্যক্তিগত তথ্য লগে যায়)

> **localhost এখানে ঠিক কেন:** PingFederate উত্তর নিজে পাঠায় না — ব্রাউজারকে ফর্ম দেয়, **ব্রাউজার** ACS এ জমা দেয়; অ্যাপ ল্যাপটপে → ব্রাউজারের কাছে localhost:3000 ঠিক। PingFederate এর Base URL এ localhost ভুল ছিল কারণ সেটাও ব্রাউজার খোলে, কিন্তু PingFederate VM এ। নিয়ম: **ঠিকানাটা কে খুলবে, তার দিক থেকে ভাবো।**

**Protocol Settings → ACS পর্যালোচনা — ঠিক:** Default (অ্যাপ নির্দিষ্ট না চাইলে এখানে) · Index 1 (একাধিক ACS হলে অ্যাপ নম্বর দিয়ে বাছে — "Multiple ACS" টেস্ট কেস) · Binding POST · Endpoint `/saml/acs` = Base URL + পথ → `http://localhost:3000/saml/acs`। নিচের খালি সারি = দ্বিতীয় ACS যোগের জায়গা, খালি রেখে Next। Advanced Customizations খালি।

পরের ট্যাব: Allowable Bindings **Redirect + POST** (অনুরোধ URL দিয়ে, উত্তর ফর্মে; Artifact দিলে সার্ভার-টু-সার্ভার সেটিং লাগে, অ্যাপ সমর্থন করে না) · Artifact Resolver Locations কিছু না · Signature Policy **Always sign the SAML Assertion** ✔ · Encryption None · Summary → Done

**টেস্ট**

| # | কী | লগইন | দেখব |
|---|---|---|---|
| 1 | SAML: OpenDJ form | ayesha.rahman | directory OpenDJ, lab-admins |
| 2 | SAML: no hint | tanvir.ahmed | directory OpenDJ (Not in Request) |
| 3 | `http://localhost:3000/saml/login?login=ad` | karim.hossain | directory AD, department IT, AD-Lab-Admins |
| 4 | ভুল পাসওয়ার্ড | যেকোনো | "didn't recognize…" |
| 5 | `https://192.168.0.29:9031/idp/startSSO.ping?PartnerSpId=pflab-node-app` | যেকোনো | IdP-initiated → profile |

profile → Raw → SAML Response (সই, Issuer, attribute)। ইউজার বদলাতে **Incognito** (opendj-form Globally session)।

**"400 - Invalid client_id" দেখলে:** OIDC বাটন চাপা হয়েছে — ঠিকানা `/as/authorization.oauth2?...client_id=…` (OIDC); SAML হলে `/idp/SSO.saml2?SAMLRequest=…`। OAuth client রিসেটে মোছা, এখনো বানাইনি। **SP Connection (SAML) ≠ OAuth Client (OIDC)** — নাম একই হলেও আলাদা জিনিস (Applications → SP Connections বনাম Applications → OAuth → Clients)। টেস্টে শুধু "2 · SAML 2.0" বাটন / `saml/login?login=ad`; OIDC বাটন ও Custom request এখন না।

**লগইন পেজ এলো = SAML + policy + selector + adapter জোড়া লেগেছে।** কোন ইউজার: OpenDJ পেজ (SAML: OpenDJ form / no hint) → OpenDJ ইউজার (credentials অংশ ৪); AD পেজ (`saml/login?login=ad`) → AD ইউজার (credentials 3b)। এক ডিরেক্টরির পেজে অন্যটার ইউজার চলে না। নতুন ইউজার টেস্টে Incognito (session মনে রাখে)। profile এ দেখো: Subject, `directory`, email/displayName/title/groups, Raw → SAML Response।

**টেস্ট অ্যাপের বাটন (হালনাগাদ, policy র সাথে মেলানো)**

| বাটন | পাঠায় | শাখা | ফর্ম |
|---|---|---|---|
| SAML: OpenDJ | `login=ldap` | ldap | OpenDJ |
| SAML: Active Directory | `login=ad` | ad | AD |
| SAML: Unknown value | `login=xyz` | No Match | OpenDJ |
| SAML: no hint | — | Not in Request | OpenDJ |

আগের "Local users" (`login=local`) আর "RADIUS" ছিল পুরনো সেটআপের — এখন No Match → OpenDJ। দুই ফর্ম একই template তাই দেখতে এক; পার্থক্য: কোন ইউজার চলে, profile এর `directory`, বা পরে adapter এর Login Template আলাদা করা।

**ভুল হলে**

| লক্ষণ | কারণ | সমাধান |
|---|---|---|
| Invalid signature | সার্ট মেলে না | আবার export, অ্যাপ restart |
| audience / issuer mismatch | Entity ID ভুল | `pflab-node-app` / `pingfed-lab-idp` |
| unknown partner | Connection Active না / ID ভুল | Activation |
| ACS not allowed | ACS URL ভুল | Protocol Settings |
| লগইন পেজ আসে না | policy/selector | VM `server.log` |
| সবসময় OpenDJ | Tracked `login` নেই | Policies → Tracked HTTP Parameters |
| attribute খালি | কোনো ধাপে নাম ভুল | PCV → adapter → contract mapping → SP fulfillment |
| 400 Invalid client_id | OIDC বাটন চাপা, OAuth client নেই | SAML বাটন ব্যবহার |

**SP metadata কোথা থেকে, কীভাবে**
- **টেস্ট অ্যাপ নিজেই বানায়:** `server.js` এর `/saml/metadata` পাতা → `.env` থেকে entityID (`SAML_SP_ENTITY_ID`) আর ACS (`APP_URL` + `/saml/acs`) নিয়ে `@node-saml/node-saml` দিয়ে XML
- **Claude যেভাবে সেভ করেছে:** `curl -s http://localhost:3000/saml/metadata -o ".../pingfed/sp-metadata.xml"`
- **নিজে:** অ্যাপ চালু রেখে (১) ব্রাউজারে খুলে Ctrl+S, (২) `Invoke-WebRequest http://localhost:3000/saml/metadata -OutFile sp-metadata.xml`, (৩) curl
- **ভেতরে:** `entityID="pflab-node-app"` · `AuthnRequestsSigned="false"` · `WantAssertionsSigned="true"` · NameIDFormat unspecified · ACS HTTP-POST `http://localhost:3000/saml/acs`
- **বাস্তবে:** Salesforce/ServiceNow/AWS এর admin প্যানেলে "Download SP Metadata" বা metadata URL; নিজেদের অ্যাপে `/metadata`; উল্টো দিকে PingFederate এর metadata = System → Protocol Metadata → Metadata Export → অ্যাপের মালিককে পাঠানো

**অ্যাপের পরিচয়:** SP Entity ID `pflab-node-app` · ACS `http://localhost:3000/saml/acs` · Metadata `http://localhost:3000/saml/metadata`

**কোথায়:** Applications → SP Connections → Create Connection

1. Template: Do not use
2. Connection Type: Browser SSO Profiles ✔, SAML 2.0
3. Options: Browser SSO ✔
4. Import Metadata: **File** (ব্রাউজারে metadata খুলে Ctrl+S → upload) বা None (হাতে)। URL না — VM থেকে ল্যাপটপের localhost দেখা যায় না
5. General Info: Entity ID `pflab-node-app`, Name `Lab Node App`
6. Browser SSO:
   - SAML Profiles: IdP-Initiated ✔, SP-Initiated ✔
   - Assertion Lifetime: 5/5
   - Assertion Creation: Identity Mapping **Standard** · Attribute Contract `SAML_SUBJECT` + `email`, `username`, `displayName`, `title`, `department`, `employeeId`, `groups`, `directory` · **Map New Authentication Policy → `lab-contract`** · Fulfillment: সবগুলো Source = Authentication Policy Contract, Value একই নাম (SAML_SUBJECT ← `subject`) · Issuance Criteria কিছু না
   - Protocol Settings: ACS POST `http://localhost:3000/saml/acs` · Bindings Redirect ✔ POST ✔ · **Always sign the SAML Assertion** ✔ · Encryption None
7. Credentials: Signing Certificate = পর্ব ১ এর সার্ট
8. Activation: **Active** → Save

**অ্যাপের দিকে**
1. সার্ট export: Select Action → Export → Certificate only → `pingfed-test-app\pingfed-signing.crt`
2. `.env`: `PF_BASE_URL=https://192.168.0.29:9031`, `SAML_IDP_ENTITY_ID=pingfed-lab-idp`, `SAML_SP_ENTITY_ID=pflab-node-app`, `SAML_IDP_CERT_FILE=./pingfed-signing.crt`
3. `npm start` → `/diagnostics`: heartbeat + SAML cert OK (OIDC FAIL স্বাভাবিক)

**টেস্ট**

| টেস্ট | কীভাবে | দেখব |
|---|---|---|
| OpenDJ | SAML: OpenDJ form (`login=ldap`) → ayesha.rahman | directory OpenDJ, groups lab-admins |
| ডিফল্ট | SAML: no hint → tanvir.ahmed | directory OpenDJ (Not in Request) |
| AD | `http://localhost:3000/saml/login?login=ad` → karim.hossain | directory AD, department IT, AD-Lab-Admins |

> Custom request ফর্ম OIDC দিয়ে শুরু করে → AD এর SAML টেস্ট সরাসরি URL দিয়ে।

---

## 3f. লগআউট আর session

**লগইনে দুই জায়গায় session:** অ্যাপের (localhost:3000 cookie) + PingFederate এর (192.168.0.29 cookie, SSO এর জন্য)

**টেস্ট অ্যাপের Log out:** অ্যাপের session মোছে ✅, PingFederate এর থাকে ❌ (SAML SLO চালু করিনি, অ্যাপ সমর্থনও করে না) → আবার লগইনে পাসওয়ার্ড ছাড়াই ঢোকে = SSO কাজ করছে (opendj-form Globally)

**পুরো লগআউট এখন**

| উপায় | কীভাবে |
|---|---|
| Incognito / ব্রাউজার বন্ধ | টেস্টের জন্য সুপারিশ |
| cookie মোছা | `192.168.0.29` → Site settings → Delete data |
| শুধু অ্যাপের Log out | অ্যাপ থেকে বের, PingFederate session থাকে |

### SAML Single Logout (SLO) সেটআপ

**অ্যাপের দিক (Claude করেছে — অ্যাপের কোড):**

| জিনিস | কাজ |
|---|---|
| `sp-signing.key` / `sp-signing.crt` | অ্যাপের key pair — লগআউট (আর এখন লগইন) অনুরোধে সই; সই ছাড়া PingFederate লগআউট মানে না (না হলে যে কেউ অন্যকে লগআউট করাতে পারত) |
| লগইনে `nameID` + `sessionIndex` রাখা | "ঠিক এই session শেষ করো" বলার জন্য |
| `/saml/logout` | SP-initiated SLO শুরু (signed LogoutRequest, Redirect) |
| `/saml/slo` | LogoutResponse নেওয়া / PingFederate এর LogoutRequest মেনে উত্তর (IdP-initiated) |
| দুই বাটন | Single Logout (SLO) বনাম Log out of app only |

metadata এ এখন SingleLogoutService + signing KeyDescriptor; `AuthnRequestsSigned="true"` → ⚠ সার্ট import না করা পর্যন্ত SAML লগইনে error হতে পারে।

**PingFederate এর দিক (আমি করব):**
1. SP Connection `pflab-node-app` → Browser SSO:
   - SAML Profiles: **SP-Initiated SLO** ✔, **IdP-Initiated SLO** ✔
   - Protocol Settings → **SLO Service URLs**: Redirect `/saml/slo`, POST `/saml/slo`; Allowable Bindings Redirect + POST
   - Signature Policy অপরিবর্তিত (লগআউট বার্তায় PingFederate নিজে সই করে)
   - Credentials → Signature Verification Settings: Trust Model **Unanchored** (self-signed, নির্দিষ্ট সার্টে বিশ্বাস); Primary Verification Certificate = import `pingfed-test-app\sp-signing.crt`
   - Save
2. Authentication → Policies → **Sessions** → **Track Adapter Sessions for Logout** ✔ (না দিলে HTML Form এর নিজের session থেকে যায় → পরের লগইনে পাসওয়ার্ড চায় না)

**টেস্ট**

| # | কী | হওয়া উচিত |
|---|---|---|
| 1 | Incognito → SAML: OpenDJ form → ayesha | profile |
| 2 | Single Logout (SLO) | redirect → "Logged out" পাতা |
| 3 | আবার লগইন | পাসওয়ার্ড চায় ✅ |
| 4 | তুলনা: Log out of app only → আবার লগইন | পাসওয়ার্ড চায় না |
| 5 | `https://192.168.0.29:9031/idp/startSLO.ping` | IdP-initiated: অ্যাপ লগআউট মানে, সব শেষ |

ভুল হলে: Signature Verification এ সার্ট নেই / SLO Service URL নেই।

**পরে শেখার**
1. **SAML SLO:** SP Connection এ SP-Initiated SLO + অ্যাপে SLO ঠিকানা → অ্যাপ থেকে লগআউটে PingFederate session শেষ, অন্য অ্যাপকেও জানায় (কোর্স: Test case 10 Single Logout; অ্যাপে কোড লাগবে)
2. **Adapter Logout Path:** HTML Form → Advanced → Logout Path `/opendj-logout` → `https://192.168.0.29:9031/ext/opendj-logout` এ ওই adapter এর session শেষ; Logout Redirect দিয়ে পরে কোথায় যাবে

**SSO পরীক্ষা (Globally বনাম Per Adapter)**
1. Incognito → SAML: OpenDJ form → ayesha লগইন
2. অ্যাপের Log out
3. আবার SAML: OpenDJ form → পাসওয়ার্ড ছাড়া profile (SSO ✅)
4. `saml/login?login=ad` → AD লগইন পেজ আসে (ad-form Per Adapter — OpenDJ session কাজে লাগে না)

---

## 3g. OIDC — একই লগইন, token দিয়ে

**একই থাকে:** `lab-main`, `login-selector`, `opendj-form`/`ad-form`, `lab-contract` — একবার বানানো লগইন SAML আর OIDC দুটোতেই (Policy Contract এর সুবিধা)। নতুন শুধু contract এর পরের অংশ।

```
SAML:  lab-contract → SP Connection → SAML assertion → অ্যাপ  ✅
OIDC:  lab-contract → Grant Mapping → Access Token Mapping → Access Token (JWT)
                                                     → OIDC Policy → ID Token → অ্যাপ
                                       (OAuth Client = অ্যাপের পরিচয়)
```

| # | জিনিস | কাজ | কোথায় |
|---|---|---|---|
| 1 | Scopes | `profile`, `email` (`openid` আগে থেকেই) | System → OAuth Settings → Scope Management |
| 2 | Access Token Manager | `lab-jwt-atm` (ID `labjwtatm`), **JSON Web Tokens**, Lifetime 60, **Use Centralized Signing Key** ✔, RS256; contract: username, email, displayName, title, department, employeeId, groups, directory | Applications → OAuth → Access Token Management |
| 3 | Policy Contract Grant Mapping | `lab-contract`: USER_KEY ← subject, USER_NAME ← username (grant = অনুমতির রেকর্ড) | Authentication → OAuth → Policy Contract Grant Mapping |
| 4 | Access Token Mapping | Context **Authentication Policy Contract: lab-contract** (না থাকলে Default → তখন Persistent Grant, শুধু USER_KEY/NAME), ATM lab-jwt-atm; সব ← contract এর একই নাম | Applications → OAuth → Access Token Mappings |
| 5 | OIDC Policy | `lab-oidc`, ATM lab-jwt-atm, Include User Info in ID Token ✔; claims sub, email, name, preferred_username, title, department, groups, directory; scopes: email→email, profile→name/preferred_username/title/department; Source Access Token (sub←username, name←displayName…); **Set as Default** | Applications → OAuth → OpenID Connect Policy Management |
| 6 | OAuth Client | ID `pflab-node-app`; **Client Secret** (Generate, কপি — পরে দেখা যায় না); Redirect `http://localhost:3000/oidc/callback`; Authorization Code (+Refresh); **Require PKCE** ✔; ATM lab-jwt-atm; OIDC Policy lab-oidc; RS256 | Applications → OAuth → Clients |
| 7 | `.env` | `OIDC_CLIENT_SECRET=` → অ্যাপ restart | pingfed-test-app |

**Access Token Manager → Session Validation: সব খালি।** কাজ = token এর বৈধতা PingFederate লগইন session এর সাথে বাঁধা। লাল সতর্কবার্তা: Authentication Sessions চালু নেই → চালু করলে token যাচাই ব্যর্থ। অপশন: Include Session Identifier (`sid` token এ) · Check for Valid Authentication Session (session শেষ → token অকেজো) · Check Session Revocation Status (লগআউটে revoke) · Update Authentication Session Activity (token ব্যবহারে idle timeout বাড়ে)। পরে Sessions শেখার সময়।

**পরের ট্যাব:** Access Token Attribute Contract ⭐ (username, email, displayName, title, department, employeeId, groups, directory) · Token Endpoint Attribute Contract খালি (token endpoint উত্তরে বাড়তি তথ্য) · Resource URIs খালি (API অনুযায়ী ATM বাছাই) · Access Control খালি (নির্দিষ্ট client সীমা) · Summary → Save

**কেন JWT:** ভেতরের তথ্য অ্যাপ নিজে পড়ে (শেখার জন্য ভালো); reference token = অর্থহীন লেখা, PingFederate কে জিজ্ঞেস করতে হয় (Module 7)।
**কেন PKCE:** code চুরি হলেও কাজে লাগে না। **কেন Redirect URI:** অন্য ঠিকানায় পাঠালে PingFederate বাতিল করে।

**PKCE কোথায় সেট করে**
- **Client এ (বাধ্যতামূলক করা):** Applications → OAuth → Clients → `pflab-node-app` → Allowed Grant Types এ Authorization Code ✔ → **Require Proof Key for Code Exchange (PKCE)** ✔ → Save। না থাকলে `code_challenge` ছাড়া অনুরোধ বাতিল। (ATM এ না!)
- **পুরো সার্ভারে:** System → OAuth Settings → Authorization Server Settings → **Disallow Plain PKCE** ✔ → শুধু S256 (plain = challenge আর verifier একই, প্রায় কোনো সুরক্ষা নেই)
- "Require" না দিলেও client `code_challenge` পাঠালে PingFederate যাচাই করে; Require = বাধ্যতামূলক
- public client (মোবাইল/SPA, secret রাখতে পারে না) এর জন্য অপরিহার্য; এখন সব client এর জন্যই সুপারিশ
- প্রবাহ: অ্যাপ র‍্যান্ডম `code_verifier` → hash (`code_challenge`, S256) লগইন অনুরোধে → token এর সময় আসল verifier → PingFederate মেলায় → চুরি করা code একা অকেজো

**Well-known (discovery) endpoint** (২০২৬-১০-০৭ এ যাচাই, দুটোই 200)
- OIDC: `https://192.168.0.29:9031/.well-known/openid-configuration`
- OAuth AS metadata (RFC 8414): `https://192.168.0.29:9031/.well-known/oauth-authorization-server`

| Key | পথ | কাজ |
|---|---|---|
| issuer | `https://192.168.0.29:9031` | token এর `iss` এর সাথে মিলতে হবে (Base URL থেকে) |
| authorization_endpoint | `/as/authorization.oauth2` | ব্রাউজার লগইন শুরু |
| token_endpoint | `/as/token.oauth2` | code + PKCE verifier → token |
| userinfo_endpoint | `/idp/userinfo.openid` | access token দিয়ে claim |
| jwks_uri | `/pf/JWKS` | ID token / JWT এর সই যাচাইয়ের public key |
| introspection_endpoint | `/as/introspect.oauth2` | token বৈধ কি না, ভেতরে কী |
| revocation_endpoint | `/as/revoke_token.oauth2` | token বাতিল |
| end_session_endpoint | `/idp/init_logout.openid` | OIDC লগআউট |
| pushed_authorization_request_endpoint | `/as/par.oauth2` | PAR |
| device_authorization_endpoint | `/as/device_authz.oauth2` | Device flow |

তখনকার অবস্থা: scopes `openid, profile, email` ✅ · code_challenge_methods `plain, S256` (Disallow Plain PKCE এখনো না) · auth methods: client_secret_basic, client_secret_post, client_secret_jwt, private_key_jwt, tls_client_auth, none

**অবস্থা (২০২৬-১০-১৫, শুধু পড়ে দেখা):** Scopes ✅ · ATM / Grant Mapping / Access Token Mapping / OIDC Policy / OAuth Client ❌ (ATM এর Session Validation পর্যন্ত গিয়েছিলাম, Save হয়নি) · `.env` এর secret পুরনো (মোছা client এর) — ধাপ ৭ এ বদলাতে হবে; diagnostics এর "client secret set OK" শুধু মান আছে কি না দেখে।

### OIDC — পুরো গাইড শুরু থেকে (২০২৬-১০-১৫)

**OAuth বনাম OIDC:** OAuth = অনুমতি → Access Token (API এর চাবি) · OIDC = OAuth এর উপরে পরিচয় → ID Token (JWT: ইউজার কে)। SAML = সই করা XML, OIDC = সই করা JSON।

**প্রবাহ (Authorization Code + PKCE):** অ্যাপ → `/as/authorization.oauth2?client_id&scope=openid profile email&redirect_uri&code_challenge&login=…` → একই policy/লগইন → `lab-contract` → ব্রাউজারে শুধু `code` ফেরত → অ্যাপ সার্ভার থেকে `/as/token.oauth2` (code + secret + code_verifier) → ID + Access token → JWKS দিয়ে সই যাচাই। **code কেন:** token ব্রাউজারের ঠিকানায় আসে না; code কাজে লাগাতে secret + verifier লাগে।

**খুঁটিনাটি যোগ:**
- ATM Type: JWT (ভেতরের তথ্য দেখা যায়, API নিজে যাচাই) বনাম Reference (অর্থহীন লেখা, introspection, সাথে সাথে বাতিলযোগ্য)
- OIDC Policy: ID Token Lifetime 5 মিনিট; Include User Info in ID Token ✔ (না দিলে userinfo থেকে আনতে হয়); `groups`/`directory` কোনো scope এ না → সবসময় যায়
- Client: Refresh Token ✔ (নতুন access token), Restrict Common Scopes খালি; secret এখনই কপি
- Access Token Mapping এ `lab-contract` context না পেলে Default → শুধু Persistent Grant (USER_KEY/NAME)

**সাধারণ ভুল:** invalid_client (ID ভুল/Save হয়নি) · redirect_uri mismatch (হুবহু মেলেনি) · token endpoint 401 (secret ভুল/restart হয়নি) · claim খালি (ধাপ ৪/৫ নাম) · invalid_scope (ধাপ ১)

### PKCE কেন্দ্রিক OIDC সেটআপ

> 📄 **আলাদা পূর্ণ গাইড:** [PingFederate_OIDC_PKCE_Guide.md](PingFederate_OIDC_PKCE_Guide.md) — প্রতিটা পাতা/ঘর, যাচাই, টেস্ট, ভুল, চেকলিস্ট এক ফাইলে।

**সমস্যা:** code ব্রাউজারের ঠিকানায় আসে → চুরি হতে পারে → চোর token নিয়ে নেয়। **PKCE:** অ্যাপ আগে গোপন সংখ্যা বানায়, token নিতে সেটা দেখাতে হয়।

```
code_verifier  = র‍্যান্ডম (অ্যাপ গোপনে রাখে)
code_challenge = BASE64URL(SHA256(verifier))  → authorization request এ (S256)
token request এ verifier → PingFederate: SHA256(verifier) == challenge? → token / invalid_grant
```
plain = challenge আর verifier একই (সুরক্ষা নেই) · S256 = শুধু hash যায়।

| | ক) Confidential + PKCE ⭐ | খ) Public + PKCE |
|---|---|---|
| কারা | সার্ভারে চলা অ্যাপ (Node, Java/.NET) | SPA, মোবাইল, desktop |
| secret | আছে | নেই (ডিভাইসে লুকানো যায় না) |
| Client Authentication | Client Secret | **None** |
| `.env` | `OIDC_CLIENT_SECRET=<secret>` | `OIDC_CLIENT_SECRET=` খালি |

**PingFederate এ PKCE সেটিং:** (০) Authorization Server Settings → **Disallow Plain PKCE** ✔ (discovery তে শুধু S256) · (৬) Client → **Require Proof Key for Code Exchange (PKCE)** ✔ — টিক ছাড়া: challenge পাঠালে যাচাই করে, না পাঠালে ছেড়ে দেয়; টিক দিলে PKCE ছাড়া কিছুই গ্রহণ না। public client এ বাধ্যতামূলক।

**অ্যাপে যোগ (Claude):** secret খালি হলে public mode (client_id body তে, Basic header না); diagnostics এ "OIDC client type"; profile → Raw → "PKCE (S256)" এ verifier আর challenge।

**PKCE প্রমাণের টেস্ট:**
1. লগইন → Raw এ verifier/challenge, Authorization request এ `code_challenge` + `S256`
2. PKCE ছাড়া authorize URL: `https://192.168.0.29:9031/as/authorization.oauth2?response_type=code&client_id=pflab-node-app&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Foidc%2Fcallback&scope=openid` → `invalid_request` প্রত্যাশিত
3. plain: ওই URL + `&code_challenge=aaaa…(43)&code_challenge_method=plain` → `invalid_request`
4. ঐচ্ছিক: Client Authentication None + `.env` খালি → secret ছাড়া লগইন

**ভুল:** invalid_grant (verifier মেলেনি — মাঝপথে restart) · invalid_client/401 (ক: secret ভুল; খ: PingFederate এ এখনো Client Secret) · invalid_request code_challenge required (= Require PKCE কাজ করছে)

**টেস্ট:** OIDC: OpenDJ → ayesha (`directory = OpenDJ`) · OIDC: Active Directory → karim (`directory = AD`, department IT) — একই লগইন পেজ, শেষে token।

---

## 4. প্রশ্ন-উত্তর লগ

| # | প্রশ্ন | সংক্ষিপ্ত উত্তর | বিস্তারিত |
|---|---|---|---|
| 1 | OpenDJ এর data store সেটিংও কি মুছে দিয়েছ? | হ্যাঁ, PingFederate রিসেটে `pingfedopendj` মোছা হয়েছিল। OpenDJ সার্ভার আর ইউজার অক্ষত। নতুন করে বানাতে হয় (ধাপ 2.1) | [Data Store](#1-data-store-ধাপ-21) |
| 2 | LDAP Type Generic কেন? | OpenDJ তালিকায় নেই; Generic = স্ট্যান্ডার্ড LDAP, কোনো বাড়তি ধারণা নেই। ভুল type দিলে গ্রুপ/attribute চুপচাপ খালি আসে | [LDAP Type](#ldap-type-generic-কেন) |
| 3 | Data store এর স্ক্রিনে আর কিছু করতে হবে? | Hostname লিখে **Add** চাপো → ড্রপডাউনে host বাছো → Test Connection → Next → Save | [সেটিং](#যে-সেটিং-দিয়েছি) |
| 4 | ইউজাররা `ou=limbosoft` এর ভেতরে — বাড়তি ধাপ লাগবে? | Data Store এ না। PCV এর Search Base আর Adapter এর Base DN এ `ou=limbosoft,dc=pingfed,dc=com`, Scope Subtree | [গঠন](#আমাদের-opendj-এর-গঠন) |
| 5 | ৫টা PCV এর কোনটা কী, কখন? | পার্থক্য শুধু কাকে জিজ্ঞেস করে যাচাই হয়। এখন LDAP | [৫ ধরনের PCV](#৫-ধরনের-pcv) |
| 6 | PCV এর দ্বিতীয় স্ক্রিনের এত অপশন কী? | ভুল করে Authentication Error Overrides এর সারি খুলেছিল — ঐচ্ছিক। সারির Cancel চাপো | [Error Overrides](#পাতা-২-authentication-error-overrides-ঐচ্ছিক) |
| 7 | ড্রপডাউনের প্রতিটা অপশনের জন্য কী সেটিং দেব? | প্রতিটার Match Expression তালিকায়; OpenDJ এ মিলবে না, AD এর জন্য | [প্রতিটা অপশন](#পাতা-২-authentication-error-overrides-ঐচ্ছিক) |
| 8 | User Not Found এর Message Properties Key এ কী লিখব? | কিছু না, খালি। Key লাগে শুধু "Use Message Properties Key" বাছলে | [Error Overrides](#পাতা-২-authentication-error-overrides-ঐচ্ছিক) |
| 9 | Password Policy Violated কখন কাজ করবে? | শুধু পাসওয়ার্ড বদলানোর সময় (Change Password, মেয়াদ শেষ, Reset), যখন ডিরেক্টরি নতুন পাসওয়ার্ড নিয়মের কারণে ফেরায় (error 19)। OpenDJ তেও কাজ করার সম্ভাবনা আছে | [Password Policy Violated](#password-policy-violated-কখন-কাজ-করে) |
| 10 | PCV এর Extended Contract পাতায় কী করতে হয়, কেন? | ঐচ্ছিক। লগইনের সময় PCV বাড়তি কোন LDAP তথ্য ফেরত দেবে; adapter একই নামে থাকলে নিজেই নেয়। `displayName`, `isMemberOf` যোগ করা ভালো | [Extended Contract](#পাতা-৩-extended-contract) |
| 11 | Extended Contract এ displayName, employeeNumber, isMemberOf, sn, title দিয়েছি — ঠিক আছে? | হ্যাঁ, বানান সব ঠিক। departmentNumber ঐচ্ছিক। এরপর Next → Summary মিলিয়ে Save | [Extended Contract](#পাতা-৩-extended-contract) |
| 12 | PCV বানানো শেষ, এরপর কী? | ধাপ 2.3: HTML Form Adapter `opendj-form`, PCV `opendj-pcv`, Extended Contract এ PCV এর একই নাম | [Adapter](#3-idp-adapter--html-form-ধাপ-23) |
| 13 | PCV কিছু দেখায় না, তাহলে attribute কেন যোগ করলাম? | PCV ইউজারকে দেখায় না, কিন্তু যে ডেকেছে (Adapter, OAuth ROPC, STS) তাকে তথ্য ফেরত দেয়; একই খোঁজে আসে বলে আলাদা লুকআপ লাগে না | [PCV কিছু দেখায় না](#pcv-কিছু-দেখায়-না--তাহলে-attribute-কেন) |
| 14 | Adapter এর মধ্যেও কি একই কাজ করা যায়? | হ্যাঁ, Adapter Contract Mapping এ Attribute Source + Fulfillment + Issuance Criteria; বেশি নিয়ন্ত্রণ, কিন্তু বাড়তি LDAP অনুরোধ। Policy তেও করা যায় | [Adapter এর ভেতরে](#adapter-এর-ভেতরেও-তথ্য-আনা-যায়-ট্যাব-৫-adapter-contract-mapping) |
| 15 | Adapter এর কাজ শুরু — গাইড করো | ট্যাব ১ Type: `opendj-form` / `opendjform` / HTML Form IdP Adapter / Parent None → Next; ট্যাব ২ এর পুরো স্ক্রিনশট পাঠাবো | [ট্যাব ১](#ট্যাব-১-type--বিস্তারিত) |
| 16 | Type ড্রপডাউনের প্রতিটা adapter কী, কখন, কেন? | ১৭টা adapter ৫ ভাগে: মূল লগইন, প্রবাহ নিয়ন্ত্রণ, MFA, ঝুঁকি/পরিচয়, অ্যাপ সংযোগ; এখন HTML Form। Instance ID `openfjform` → `opendjform` ঠিক করতে হবে | [১৭টা adapter](#type-ড্রপডাউনের-১৭টা-adapter) |
| 17 | Cloud ছাড়া সব adapter করা যাবে? VM এ AD আছে তো | ৮টা AD ছাড়াই করা যাবে; Mac Platform SSO না। কিন্তু VM এ AD নেই (WORKGROUP) — Kerberos এর আগে AD বসাতে হবে (এই VM বা আলাদা VM) | [Cloud ছাড়া adapter](#cloud-ছাড়া-adapter--আমার-ল্যাবে-কোনটা-সম্ভব) |
| 18 | আমার Windows Server এ AD configure করে দাও | এই VM, `pingfed.lab`; OpenDJ → 1389, স্থির IP হয়েছে; data store আমি বদলাব; AD install বাকি | [AD সেটআপ](#3a-active-directory-সেটআপ--অগ্রগতি-আর-নেটওয়ার্কের-ঘটনা-২০২৬-১০-০৫) |
| 19 | হঠাৎ কী হলো, VM এ পৌঁছানো যাচ্ছে না কেন | রিমোটে IP মুছে সংযোগ কাটা → APIPA; আসল কারণ VMware NIC NAT ছিল → Bridged করে ঠিক | [ঘটনা](#কী-ভুল-হয়েছিল-কীভাবে-ঠিক-হলো) |
| 20 | Data Stores খুলতে "Something's not right" — সমস্যা কী? | admin console এর সাময়িক গোলমাল (ConcurrentModificationException), দুই ট্যাব/দুই লগইন; কনফিগ ঠিক আছে। এক ট্যাব রেখে restart লিংক | [Something's not right](#somethings-not-right-পাতা-admin-console) |
| 21 | OpenDJ port বদলানো শেষ, AD install শুরু করো | AD DS + DNS install, Administrator পাসওয়ার্ড সেট, ডোমেইন `pingfed.lab` তৈরি, SYSVOL ঠিক, firewall নিয়ম; সব যাচাই করা | [AD তৈরির পরে](#ad-তৈরির-পরে-যা-যা-ঘটল-শিক্ষা) |
| 22 | AD তে আরও ইউজার যোগ করো, আর কোথা থেকে যোগ করা যায় বলো | OU LabUsers এ ৫ জন + ২ গ্রুপ + svc-pingfed বানানো; নিজে: ADUC (dsa.msc), ADAC (dsac.exe), PowerShell New-ADUser, net user /domain | [AD তে ইউজার](#ad-তে-ইউজার--কী-বানানো-হয়েছে-আর-নিজে-কীভাবে-বানাব) |
| 23 | AD এর data store add করতে কী কী করতে হবে? | নতুন data store `localhost:389`, LDAP Type **Active Directory**, bind `svc-pingfed@pingfed.lab`; পরে PCV filter `sAMAccountName=${username}` | [AD Data Store](#3b-ad-এর-data-store-দ্বিতীয়-data-store) |
| 24 | password কি service account এর অংশেরটা? | হ্যাঁ, 3b এর শেষে svc-pingfed এর Password; User DN `svc-pingfed@pingfed.lab`; হুবহু কপি, space ছাড়া | [AD Data Store](#3b-ad-এর-data-store-দ্বিতীয়-data-store) |
| 25 | AD দিয়ে PCV বানাতে গাইড করো | `ad-pcv`: base `OU=LabUsers,DC=pingfed,DC=lab`, filter `sAMAccountName=${username}`, case-sensitive বন্ধ, AD error override (775/533/532/773), memberOf ইত্যাদি | [AD PCV](#ad-pcv--ad-pcv-ধাপে-ধাপে) |
| 26 | AD Domains/Kerberos Realms পাতায় realm জিনিসটা কী? | realm = Kerberos এর ডোমেইন (`PINGFED.LAB`); পাতাটা Kerberos টিকিট যাচাইয়ের জন্য (Kerberos adapter), LDAP/PCV এর জন্য না; SPN সহ service account লাগে | [Kerberos Realms](#3c-active-directory-domains--kerberos-realms) |
| 27 | Adapter এ ফিরি — আগের option গুলোর তালিকা আবার দাও | Cloud ছাড়া ৮টার ক্রম; Kerberos এখন সম্ভব; দুই PCV → দুইটা আলাদা HTML Form (opendj-form, ad-form) সুপারিশ | [শেখার ক্রম](#শেখার-ক্রম-আর-এখনকার-অবস্থা-ad-এর-পরে-হালনাগাদ) |
| 28 | সবগুলো adapter দেখব — HTML Form দিয়ে শুরু | ট্যাব ১ Type; ট্যাব ২ এর প্রতিটা ঘর ভাগ করে (PCV, Retries 3, Session Globally, Remember Username); ট্যাব ৩-৬ | [ট্যাব ২](#ট্যাব-২-idp-adapter--প্রতিটা-ঘর--বদলাব) |
| 29 | ট্যাব ২ এর স্ক্রিনশট — কী কী আছে দেখো | Retries/Session/Remember ঠিক; Credential Validators টেবিল খালি — opendj-pcv যোগ করে Update; নতুন ঘর (Change Password Policy Contract, Reset Type, Revoke Sessions…) ব্যাখ্যা | [ট্যাব ২](#ট্যাব-২-idp-adapter--প্রতিটা-ঘর--বদলাব) |
| 30 | নতুন ৫টা ঘরের configuration কি আলাদা করে করতে হবে? | হ্যাঁ — প্রতিটার পূর্বশর্ত আলাদা (Notification Publisher, SMS provider, policy contract, unique user key, লেখার অধিকার/AD LDAPS); পরে "পাসওয়ার্ড ব্যবস্থাপনা" অধ্যায়ে | [ট্যাব ২](#ট্যাব-২-idp-adapter--প্রতিটা-ঘর--বদলাব) |
| 31 | Adapter এর Extended Contract এ কী দেওয়া উচিত? | PCV এর হুবহু নাম: mail, givenName, displayName, sn, title, employeeNumber, isMemberOf; core = username, policy.action | [ট্যাব ৩](#ট্যাব-৩-extended-contract--কী-দেব) |
| 32 | Adapter Attributes পাতায় কী করতে হবে, কেন? | Unique User Key = username; Pseudonym শুধু username; Mask Log Values খালি (ল্যাবে debug এর জন্য) | [ট্যাব ৪](#ট্যাব-৪-adapter-attributes--কী-আর-কেন) |
| 33 | Adapter Contract Mapping পাতায় কী করতে হবে? | কিছু না — ডিফল্টে adapter নিজে (PCV থেকে) ভরে; Configure Adapter Contract = Attribute Sources, Fulfillment, Issuance Criteria (পরে পরীক্ষা) | [ট্যাব ৫](#ট্যাব-৫-adapter-contract-mapping--এখন-কিছু-না-শুধু-next) |
| 34 | Configure Adapter Contract চাপলে Attribute Sources পাতা — আসলেই কিছু করার নেই? | আছে (বাধ্যতামূলক না): Attribute Source (opendjlookup) দিয়ে departmentNumber/telephoneNumber আনা, Fulfillment এ Source বদলানো, Issuance Criteria; contract এ attribute আগে লাগে | [ভেতরে কী করা যায়](#configure-adapter-contract-এর-ভেতরে--আসলে-কী-করা-যায়) |
| 35 | LDAP Filter পাতা ঠিক আছে কিনা | হ্যাঁ, cn=${username}; Values = filter এ ব্যবহারযোগ্য variable; দুইবার দেখানো UI এর ধরন | [ভেতরে কী করা যায়](#configure-adapter-contract-এর-ভেতরে--আসলে-কী-করা-যায়) |
| 36 | OpenDJ এর adapter শেষ, এবার AD এর টা? | `ad-form`: PCV ad-pcv, Session **Per Adapter** (Globally হলে দুই adapter এর session মিশে যায়), AD এর attribute নাম (memberOf, employeeID, department…) | [ad-form](#দ্বিতীয়-adapter-ad-form-ad) |
| 37 | Adapter এর পরের part এ কী আছে? | Policy Contract → Selector → Policy → (পর্ব ১ সেটিং বাকি) → SP Connection → টেস্ট; `lab-contract` এ এক নামের তালিকা, Policy তে দুই adapter মিলানো | [3d](#3d-adapter-এর-পরে--পথ-আর-policy-contract) |
| 38 | Policy contract বানানো শেষ, এরপর কী? | Selector `login-selector` (HTTP Request Parameter `login`; ফল ldap/ad; No Match + Not in Request চালু); পরে Tracked HTTP Parameters এ login | [Selector](#selector--login-selector-http-request-parameter) |
| 39 | অনেক selector type — ল্যাবে কোনগুলো সম্ভব? | ১১টার ১০টা সম্ভব (Cluster Node বাদ — standalone); প্রতিটার টেস্ট পদ্ধতি; সংশোধন: result values দিতে হয় "Selector Result Values" ট্যাবে | [১১টা selector](#১১টা-selector--ল্যাবে-কোনটা-সম্ভব) |
| 40 | Authentication Selector পাতার ঘরগুলো বুঝছি না | Name `login`, Case-Sensitive বন্ধ, Any খালি, No Match ✔, Not in Request ✔; না দিলে selector ব্যর্থ → পরের policy | [Selector](#selector--login-selector-http-request-parameter) |
| 41 | Result Values এ ldap আর ad দিয়ে আসলে কী বোঝায়? | `login` এর সম্ভাব্য মান — শুধু লেবেল; অর্থ বসে policy তে কোন শাখায় কোন adapter দিই; অ্যাপের পাঠানো মানের সাথে হুবহু মিলতে হবে | [Selector](#selector--login-selector-http-request-parameter) |
| 42 | Selector শেষ, এরপর কী? | Authentication Policy `lab-main`: IdP policies ✔, Tracked `login`, selector → ৪ শাখায় adapter, Success → lab-contract + mapping (OpenDJ/AD আলাদা, directory = Text), শেষে পাতার Save | [Policy](#authentication-policy--lab-main) |
| 43 | Policy পাতার Options, Rules, Restart/Done — কী করব? | root এ adapter বসেছিল → login-selector দাও; Fail → Done, Success → lab-contract; Options (Incoming User ID) ও Rules এখন না — খালি rule সারি Delete | [Policy tree এর লিংক](#authentication-policy--lab-main) |
| 44 | login-selector বাছলাম, এখানেও Options আর Rules কেন? | adapter এর নিচে আছে (আগের মতো, এখন কিছু না); selector এর নিচে শুধু Copy। ⚠ Success এ Done না — lab-contract দাও; Copy/Paste দিয়ে OpenDJ mapping একবার | [Policy tree এর লিংক](#authentication-policy--lab-main) |
| 45 | Options এ Context / Requested User দিলাম — ঠিক আছে? | হ্যাঁ: login_hint/Subject দিয়ে নাম আগে বসায়; User ID Authenticated কখনো টিক না (নিরাপত্তা ত্রুটি); Allow Username Edits During Chaining জেনে রাখো | [Policy tree এর লিংক](#authentication-policy--lab-main) |
| 46 | Options select করব কি করব না, কেন? | এখন না (Cancel) — শুধু নাম আগে বসানোর সুবিধা, ঝুঁকি বাড়ায়; আসল ব্যবহার Identifier First এর পরের ধাপে | [Policy tree এর লিংক](#authentication-policy--lab-main) |
| 47 | Rules পপআপে কী করব? | এখন কিছু না — খালি সারি Delete, Cancel; পরে memberOf দিয়ে admins শাখা পরীক্ষা। AD Success = lab-contract ✅ | [Policy tree এর লিংক](#authentication-policy--lab-main) |
| 48 | Contract mapping এ কী লিখব? | Fulfillment পাতায় প্রতিটা contract attribute এর Source + Value — AD: Adapter (ad-form) mail/memberOf/employeeID…, directory = Text `AD`; OpenDJ: isMemberOf/employeeNumber, department No Mapping, directory = Text `OpenDJ` | [Policy](#authentication-policy--lab-main) |
| 49 | No Match আর Not in Request এর success এও কি একই contract + mapping? | হ্যাঁ — opendj-form, lab-contract, LDAP এর হুবহু mapping; হাতে বা Copy/Paste | [Policy](#authentication-policy--lab-main) |
| 50 | এখন কি Save করব? | হ্যাঁ, তবে আগে Next → Default Authentication Sources (খালি) → Tracked HTTP Parameters এ `login` → Save | [Policy](#authentication-policy--lab-main) |
| 51 | 9031 খুললে 403 Forbidden — কী করব? | স্বাভাবিক: runtime এর হোম পেজ নেই; heartbeat দিয়ে যাচাই; লগইন পেজ আসে অ্যাপের অনুরোধে → আগে পর্ব ১ + SP Connection | [3d](#3d-adapter-এর-পরে--পথ-আর-policy-contract) |
| 52 | আমাদের অ্যাপ তো connection দিয়ে onboard করা হয়নি | ঠিক — আগে পর্ব ১, তারপর SP Connection (metadata File import, lab-contract map, sign assertion, signing cert), অ্যাপে সার্ট export + .env, তারপর টেস্ট | [3e](#3e-টেস্ট-অ্যাপ-onboard--sp-connection-saml) |
| 53 | Signing certificate কীভাবে create করব? | CN `PingFed Lab Signing`, SAN খালি, O `PingFed Lab`, C `BD`, 730 দিন, RSA 2048, SHA256 → Save → Export Certificate only → pingfed-signing.crt | [Signing সার্ট](#signing-সার্টিফিকেট-তৈরি-পর্ব-১২) |
| 54 | App onboard এর জন্য পরের ধাপ কী? | Federation Info (Base URL + Entity ID) → সার্ট export → অ্যাপের metadata সেভ → SP Connection (3e) → .env → টেস্ট | [Onboard এর ক্রম](#onboard-এর-ক্রম) |
| 55 | Base URL + Entity ID done, এরপর? | সার্ট export (Certificate only → pingfed-signing.crt) → npm start → diagnostics → metadata সেভ → SP Connection প্রথম ৪ পাতা (Metadata File) | [Onboard এর ক্রম](#onboard-এর-ক্রম) |
| 56 | Certificate export done, app run করো | অ্যাপ চালু, diagnostics OK; অ্যাপ ফোল্ডারে পুরনো সার্ট ছিল → Downloads এর সঠিকটা বসানো; metadata `sp-metadata.xml`; ⚠ Base URL এখনো localhost — আবার Save | [Onboard এর ক্রম](#onboard-এর-ক্রম) |
| 57 | Base URL change করেছি, দেখো | ✅ Base URL + Entity ID ঠিক, discovery issuer 192.168.0.29; diagnostics OK (OIDC client রিসেটে মোছা — পরে); এখন SP Connection: Template না → Browser SSO SAML 2.0 → Metadata File `sp-metadata.xml` | [3e](#3e-টেস্ট-অ্যাপ-onboard--sp-connection-saml) |
| 58 | App onboard বা SP এর যা যা করতে হবে বলো, নিজে করব | পুরো SP Connection গাইড পাতা ১–৮, Browser SSO এর ভেতর (Profiles, Lifetime, Assertion Creation + lab-contract, Protocol Settings), Credentials, Activation; ৫টা টেস্ট আর troubleshooting | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 59 | metadata ফাইল কোথায় পেলে, কীভাবে বের করলে? | টেস্ট অ্যাপের `/saml/metadata` নিজে বানায় (.env থেকে); curl দিয়ে সেভ; নিজে ব্রাউজারে Ctrl+S বা Invoke-WebRequest; বাস্তবে অ্যাপের admin প্যানেল থেকে | [SP metadata](#3e-টেস্ট-অ্যাপ-onboard--sp-connection-saml) |
| 60 | General Info পাতায় কোনো ভুল আছে? | না — সব ঠিক; Base URL localhost:3000 অ্যাপের ঠিকানা, ব্রাউজার খোলে তাই ঠিক; Transaction Logging Standard | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 61 | ACS URL পাতা ঠিক আছে? | হ্যাঁ — default, index 1, POST, /saml/acs (Base URL এর সাথে জুড়ে পুরো ঠিকানা); পরের: Redirect+POST, Artifact resolver কিছু না, Always sign assertion, Encryption None | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 62 | টেস্টে "400 - Invalid client_id" | OIDC বাটন চাপা হয়েছে (authorization.oauth2); OAuth client নেই — SP Connection আলাদা জিনিস; SAML বাটন দিয়ে টেস্ট | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 63 | লগইন পেজ আসছে — username/password দাও | OpenDJ পেজে OpenDJ ইউজার (ayesha.rahman…), AD পেজে AD ইউজার (karim.hossain…), পাসওয়ার্ড lab-credentials.txt (৪ / 3b); Incognito; profile যাচাই | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 64 | লগইন হলো, logout কীভাবে? | দুই session (অ্যাপ + PingFederate); অ্যাপের Log out শুধু অ্যাপের মোছে; পুরো লগআউট = Incognito/cookie মোছা; পরে SLO আর adapter Logout Path; SSO পরীক্ষা | [3f](#3f-লগআউট-আর-session) |
| 65 | চলো SLO টাও setup করি | অ্যাপে SLO কোড + নিজের signing key (Claude); PingFederate এ: SP/IdP-Initiated SLO, SLO Service URL `/saml/slo`, Signature Verification এ sp-signing.crt (Unanchored), Sessions এ Track Adapter Sessions for Logout | [SLO সেটআপ](#saml-single-logout-slo-সেটআপ) |
| 66 | AD এর form কোনটা? Local users কি? | না — Local users পুরনো বাটন (login=local → No Match → OpenDJ); অ্যাপের বাটন হালনাগাদ: OpenDJ / Active Directory / Unknown value / no hint; দুই ফর্ম দেখতে এক, directory দিয়ে বোঝা | [একা করার গাইড](#sp-connection--একা-করার-পুরো-গাইড) |
| 67 | এবার OIDC — একই adapter দিয়ে তো? | হ্যাঁ, পুরো লগইন (policy, selector, adapter, contract) একই; নতুন: Scopes, JWT Access Token Manager, Grant Mapping, Access Token Mapping, OIDC Policy, OAuth Client, .env secret | [3g](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 68 | ATM এর Session Validation পাতায় কী করব? | সব খালি — Authentication Sessions চালু না থাকায় চালু করলে token ব্যর্থ; বাকি ট্যাব: শুধু Attribute Contract extend | [3g](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 69 | Authorization code এ PKCE কোথায় সেট করব? | Client এ "Require Proof Key for Code Exchange (PKCE)"; সার্ভারে Authorization Server Settings → Disallow Plain PKCE (শুধু S256) | [3g](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 70 | Well-known endpoint দাও | `https://192.168.0.29:9031/.well-known/openid-configuration` (+ oauth-authorization-server); issuer, authorize, token, userinfo, JWKS, introspect, revoke, logout, PAR, device | [3g](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 71 | টেস্ট অ্যাপ চালাও, তারপর OIDC | অ্যাপ চালু (diagnostics OK); OIDC: শুধু Scopes হয়েছে, বাকি ২–৭ বাকি; পরের কাজ ATM `lab-jwt-atm` | [3g](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 72 | চেকলিস্টে selector আর policy contract এর অংশ নেই | ঠিক — চেকলিস্ট শুরুর পরিকল্পনায় লেখা ছিল; আসলে যা বানানো হয়েছে সেই অনুযায়ী নতুন করে লেখা: AD, selector, lab-contract, policy, SP, SLO, OIDC, শেষ ধাপে টিক | `PingFederate_Hands-on_Checklist.md` |
| 73 | OIDC এর কাজ একদম শুরু থেকে পুরো গাইড করো | ধারণা (OAuth/OIDC, code+PKCE প্রবাহ, কোন জিনিস কী করে) + ধাপ ১–৭ ঘর ধরে (Scopes ✅, ATM, Grant Mapping, Token Mapping, OIDC Policy, Client, secret) + টেস্ট + সাধারণ ভুল | [OIDC পুরো গাইড](#oidc--পুরো-গাইড-শুরু-থেকে-২০২৬-১০-১৫) |
| 74 | PKCE দিয়েই সেটআপ করতে হবে, গাইড সেভাবে দাও | PKCE কী/কীভাবে (verifier, challenge, S256); confidential বনাম public client; Disallow Plain PKCE + Client এ Require PKCE; অ্যাপ দুই মোড সমর্থন করে + Raw এ PKCE মান; ৪টা প্রমাণ টেস্ট | [PKCE কেন্দ্রিক](#pkce-কেন্দ্রিক-oidc-সেটআপ) |
| 75 | OIDC+PKCE গাইড আলাদা md ফাইলে দাও, যাতে নিজে সেটআপ করতে পারি | `PingFederate_OIDC_PKCE_Guide.md` বানানো: বড় ছবি, শুরুর শর্ত, PKCE ব্যাখ্যা, client ধরন, ধাপ ০–৬ ঘর ধরে ধরে, অ্যাপের দিক (.env + নিজে restart), ৭টা টেস্ট, ভুলের টেবিল, মানের তালিকা, চেকলিস্ট | [OIDC PKCE গাইড](PingFederate_OIDC_PKCE_Guide.md) |
| 76 | ATM Instance Configuration এ লাল বার্তা (Active Signing Certificate Key ID বা Centralized Signing Key লাগবে); Certificates এ `labtest` + PingFed Lab Signing দিয়েছি, কী করব? | RS256 এ সই করতে key লাগে। Certificates এর `labtest` সারি Delete, Symmetric Keys খালি, **Use Centralized Signing Key** ✔, JWS RSA using SHA-256, Active Symmetric/Signing Certificate Key ID খালি → Next। বিকল্প: সারি রেখে নিচে Active Signing Certificate Key ID = labtest (SAML সার্ট পুনর্ব্যবহার, ভালো অভ্যাস না) | [গাইড ধাপ ২](PingFederate_OIDC_PKCE_Guide.md#ধাপ-২-access-token-manager-lab-jwt-atm) |
| 77 | ATM Session Validation পাতা (৪টা চেকবক্স খালি, লাল সতর্কবার্তা) — ঠিক আছে? | হ্যাঁ, সব খালি রেখে Next। লাল বার্তা = Authentication Sessions চালু নেই, তাই Check for Valid Authentication Session দিলে token যাচাই ব্যর্থ হতো; শুধু তথ্য, error না। পরের ট্যাব Access Token Attribute Contract এ ৮টা attribute | [3g Session Validation](#3g-oidc--একই-লগইন-token-দিয়ে) |
| 78 | ATM এর Token Endpoint Attribute Contract ট্যাবে কী করতে হবে? | কিছু না, খালি রেখে Next। এটা token endpoint এর JSON উত্তরে (access_token, id_token এর পাশে) বাড়তি ঘর যোগের জায়গা; Multi-Valued = একাধিক মান, Mapped Scopes = শুধু ওই scope দিলে পাঠাবে। আমাদের সব তথ্য token এর ভেতরে, তাই লাগে না। Resource URIs, Access Control ও খালি; Summary তে ৮টা attribute মিলিয়ে Save | [গাইড ধাপ ২](PingFederate_OIDC_PKCE_Guide.md#ধাপ-২-access-token-manager-lab-jwt-atm) |
| 79 | Access Token Mappings এর Context ড্রপডাউনে lab-contract নেই (শুধু Client Credentials, Default) | Context এ contract আসে কেবল তার Policy Contract Grant Mapping (ধাপ ৩) থাকলে — ধাপ ৩ বাদ গেছে/Save হয়নি। Client Credentials (ইউজার ছাড়া, অ্যাপ নিজে) বা Default (শুধু USER_KEY/USER_NAME) বেছো না, Add Mapping চেপো না। আগে Authentication → OAuth → Policy Contract Grant Mapping → lab-contract → USER_KEY←subject, USER_NAME←username → Save; তারপর এই পাতা refresh | [গাইড ধাপ ৩–৪](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৩-policy-contract-grant-mapping) |
| 80 | Policies পাতায় Policy Contract Grant Mapping খুঁজে পাচ্ছি না | Claude এর ভুল পথ: এটা Authentication → **OAuth** → Policy Contract Grant Mapping এ, Policies মেনুতে না। Policies পাতায় কিছু বদলাইনি তাই Cancel/চলে যাও। উপরে AUTHENTICATION → OAuth অংশ, বা 🔍 "Grant Mapping"। গাইড/চেকলিস্ট/নোটের পথ ঠিক করা হয়েছে | [গাইড ধাপ ৩](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৩-policy-contract-grant-mapping) |
| 81 | Grant Mapping এর Issuance Criteria পাতায় কী করব? | কিছু না, খালি রেখে Next → Summary → Save। এটা শর্তের জায়গা: মিললে token দেবে, না মিললে Error Result দেখাবে (যেমন directory = AD হলে তবেই, বা groups এ নির্দিষ্ট গ্রুপ থাকলে)। Source/Attribute Name/Condition/Value/Error Result; Show Advanced Criteria = OGNL expression। পরে পরীক্ষা: Source contract, Attribute groups, Condition multi-value contains, Value lab-admins | [গাইড ধাপ ৩](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৩-policy-contract-grant-mapping) |
| 82 | OIDC Policy এর Manage Policy পাতার অপশনগুলোর কাজ কী? | ID Token Lifetime 5; Session Identifier (`sid`, লগআউট); User Info ✔ (claim ID token এ); State Hash (`s_hash`, FAPI); X.509 Thumbprint (`x5t#S256` header); typ header; Return on Refresh / Token Exchange; Reissue in Hybrid; ID Token Introspection। আমাদের শুধু User Info ✔, বাকি খালি | [গাইড ধাপ ৫](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৫-oidc-policy-lab-oidc) |
| 83 | OIDC Policy এর Attribute Contract এ আগে থেকেই অনেক attribute (address.*, birthdate…) আছে | এগুলো OIDC Core এর standard claim, PingFederate preset। রাখো email, name, preferred_username; বাকি ১৮টা Delete (মান নেই, fulfillment ঝামেলা); Add title, department, groups (Multi-Valued ✔ → JSON array), directory। `profile` claim ≠ profile scope। এরপর Next না থাকলে Save → policy আবার খুলে বাকি ট্যাব | [গাইড ধাপ ৫](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৫-oidc-policy-lab-oidc) |
| 84 | OAuth Client এর Secret Storage এ কী বাছব? | **Internally Managed** (PingFederate নিজে hash করে রাখে); Secret Manager = CyberArk জাতীয় বাইরের vault, plugin লাগে। Retention Period: Use Global Settings (secret বদলালে পুরনোটা কিছুক্ষণ চলে)। Client Authentication শুধু Client Secret (Client Secret JWT = secret দিয়ে সই করা JWT, Private Key JWT = অ্যাপের private key, Client TLS = mTLS সার্ট)। 👁 দিয়ে পুরো secret কপি করে `.env` এ | [গাইড ধাপ ৬](PingFederate_OIDC_PKCE_Guide.md#ধাপ-৬-oauth-client-pflab-node-app--pkce-এর-মূল-জায়গা) |
| 85 | credentials আবার দাও | `lab-credentials.txt` থেকে: VM, PingFederate admin, OpenDJ, AD, AD ও OpenDJ টেস্ট ইউজার, অ্যাপের OIDC তথ্য (পাসওয়ার্ড এখানে লেখা হয়নি, ফাইলে আছে) | `lab-credentials.txt` |
| 86 | .env এ নতুন secret দিয়েছি, অ্যাপ restart করো | Claude restart করেছে; diagnostics সব OK, OIDC client type = confidential (client secret + PKCE S256)। এরপর গাইডের টেস্ট ১–৫ | [গাইড টেস্ট](PingFederate_OIDC_PKCE_Guide.md#৬-টেস্ট) |
| 87 | jwks uri দিয়ে কী কাজ হয়, অনুশীলনের জন্য configure করে দাও; introspect কী? | JWKS = PingFederate এর public key সেট (`/pf/JWKS`), token header এর `kid` দিয়ে key বেছে সই নিজে যাচাই (নেটওয়ার্ক ছাড়া, শুধু সই+মেয়াদ জানে); ১৪ key = প্রতি অ্যালগরিদমে বর্তমান+পরের (rotation) + enc key। Introspection (RFC 7662) = `POST /as/introspect.oauth2` এ token পাঠিয়ে active কি না জিজ্ঞেস, client auth লাগে, বাতিল ও reference token ও জানে। Claude অ্যাপে Token lab (`/tokens`) যোগ করেছে: JWKS তালিকা, লোকাল যাচাই + জাল token, introspection ফর্ম; `.env` এ INTROSPECT_CLIENT_ID/SECRET। ইউজার করবে: client `pflab-api`, শুধু Access Token Validation grant | [গাইড ১০](PingFederate_OIDC_PKCE_Guide.md#১০-jwks-আর-introspection-অনুশীলন) |
| 88 | সব কিছু GitHub এ push করো (নতুন repo) | public repo `shahed-swe/pingfederate-lab`; secret বাদ: `.gitignore` এ lab-credentials.txt, backups/, .env, *.key, *.p12; setup-pingfed.js আর cert_report.py এ hard-coded admin password সরিয়ে `PF_ADMIN_PASSWORD` env var; root README যোগ | https://github.com/shahed-swe/pingfederate-lab |
