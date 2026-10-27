// Configures the Docker PingFederate for the lab app's OIDC (Authorization Code + PKCE) flow,
// following pingfederate-lab/PingFederate_OIDC_PKCE_Guide.md, with OpenDJ and Samba AD as user stores.
//   PF_ADMIN_PASSWORD=Admin123 node setup-oidc-lab.js
// Names match the hints in pingfed-test-app/views.js: selector login-selector, policy lab-main,
// adapters opendj-form / ad-form, validators opendj-pcv / ad-pcv, contract lab-contract.
const crypto = require('crypto');
const https = require('https');

const ADMIN = process.env.PF_ADMIN_URL || 'https://localhost:9999/pf-admin-api/v1';
const USER = process.env.PF_ADMIN_USER || 'admin';
const PASS = process.env.PF_ADMIN_PASSWORD || 'Admin123';
const APP_URL = (process.env.APP_URL || 'http://localhost:3100').replace(/\/$/, '');
const SECRET = process.env.OIDC_CLIENT_SECRET || crypto.randomBytes(24).toString('base64url');
const OPENDJ_PASSWORD = process.env.OPENDJ_ADMIN_PASSWORD || 'Password1';
const AD_PASSWORD = process.env.AD_ADMIN_PASSWORD || 'Admin-Pass123!';

const ID = { opendjDs: 'opendjds', adDs: 'adds', opendjPcv: 'opendjpcv', adPcv: 'adpcv', opendjForm: 'opendjform', adForm: 'adform',
  selector: 'loginselector', apc: 'labcontract', atm: 'labjwtatm', oidc: 'laboidc', client: 'pflab-node-app' };
const CONTRACT_ATTRS = ['username', 'email', 'displayName', 'title', 'department', 'employeeId', 'groups', 'directory'];
const DIRS = {
  ldap: { ds: ID.opendjDs, pcv: ID.opendjPcv, form: ID.opendjForm, name: 'OpenDJ', host: 'opendj:1389', ldapType: 'GENERIC',
    bindDn: 'cn=Directory Manager', bindPw: OPENDJ_PASSWORD, base: 'ou=People,dc=pingfed,dc=lab', filter: 'uid=${username}',
    attrs: { email: 'mail', displayName: 'displayName', title: 'title', department: 'departmentNumber', employeeId: 'employeeNumber', groups: 'isMemberOf' } },
  ad: { ds: ID.adDs, pcv: ID.adPcv, form: ID.adForm, name: 'Active Directory', host: 'samba-ad:389', ldapType: 'ACTIVE_DIRECTORY',
    bindDn: 'CN=Administrator,CN=Users,DC=pingfed,DC=lab', bindPw: AD_PASSWORD, base: 'DC=pingfed,DC=lab', filter: 'sAMAccountName=${username}',
    attrs: { email: 'mail', displayName: 'displayName', title: 'title', department: 'department', employeeId: 'employeeNumber', groups: 'memberOf' } },
};

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(ADMIN + path, { method, rejectUnauthorized: false,
      headers: { Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64'), 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let d; try { d = t ? JSON.parse(t) : null; } catch { d = t; } resolve({ status: res.statusCode, ok: res.statusCode < 300, data: d }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const must = (label, r) => { if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 1200)}`); return r.data; };
async function upsert(label, collection, id, body) {
  const cur = await api('GET', `${collection}/${encodeURIComponent(id)}`);
  const r = cur.ok ? await api('PUT', `${collection}/${encodeURIComponent(id)}`, body) : await api('POST', collection, body);
  must(label, r); console.log(`  ${cur.ok ? 'updated' : 'created'} ${label}`); return r.data;
}
async function remove(label, collection, id) { const r = await api('DELETE', `${collection}/${encodeURIComponent(id)}`); if (r.ok) console.log(`  removed ${label}`); }
const fields = (o) => Object.entries(o).map(([name, value]) => ({ name, value: String(value) }));
const apc = (v) => ({ source: { type: 'AUTHENTICATION_POLICY_CONTRACT' }, value: v });
const tok = (v) => ({ source: { type: 'TOKEN' }, value: v });
const text = (v) => ({ source: { type: 'TEXT' }, value: v });

(async () => {
  console.log('== Step 0/1: scopes + Disallow Plain PKCE');
  const s = must('get authServerSettings', await api('GET', '/oauth/authServerSettings'));
  for (const [name, description] of [['openid', 'OpenID Connect login'], ['profile', 'Basic profile'], ['email', 'Email address']])
    if (!s.scopes.some((x) => x.name === name)) s.scopes.push({ name, description, dynamic: false });
  s.disallowPlainPKCE = true;
  must('put authServerSettings', await api('PUT', '/oauth/authServerSettings', s));
  console.log('  scopes:', s.scopes.map((x) => x.name).join(', '), '| disallowPlainPKCE=true');

  console.log('== Directories: LDAP data stores, credential validators, HTML Form adapters');
  for (const [key, d] of Object.entries(DIRS)) {
    await upsert(`data store ${d.name} (${d.host})`, '/dataStores', d.ds, {
      type: 'LDAP', id: d.ds, name: `${d.name} (lab)`, ldapType: d.ldapType, hostnames: [d.host], bindAnonymously: false,
      userDN: d.bindDn, password: d.bindPw, useSsl: false, useStartTLS: false, useDnsSrvRecords: false, followLDAPReferrals: false,
      testOnBorrow: true, testOnReturn: false, createIfNecessary: true, verifyHost: false, maskAttributeValues: false,
      minConnections: 10, maxConnections: 100, maxWait: -1, timeBetweenEvictions: 60000, readTimeout: 3000, connectionTimeout: 3000, dnsTtl: 60000,
    });
    await upsert(`PCV ${key === 'ldap' ? 'opendj-pcv' : 'ad-pcv'}`, '/passwordCredentialValidators', d.pcv, {
      id: d.pcv, name: key === 'ldap' ? 'opendj-pcv' : 'ad-pcv',
      pluginDescriptorRef: { id: 'org.sourceid.saml20.domain.LDAPUsernamePasswordCredentialValidator' },
      configuration: { tables: [{ name: 'Authentication Error Overrides', rows: [] }], fields: fields({
        'LDAP Datastore': d.ds, 'Search Base': d.base, 'Search Filter': d.filter, 'Scope of Search': 'Subtree', 'Case-Sensitive Matching': 'false',
        'Display Name Attribute': 'displayName', 'Mail Attribute': 'mail' }) },
      attributeContract: { coreAttributes: ['DN', 'givenName', 'mail', 'username'].map((name) => ({ name })),
        extendedAttributes: Object.values(d.attrs).filter((a) => !['DN', 'givenName', 'mail', 'username'].includes(a)).map((name) => ({ name })) },
    });
    await upsert(`adapter ${key === 'ldap' ? 'opendj-form' : 'ad-form'}`, '/idp/adapters', d.form, {
      id: d.form, name: key === 'ldap' ? 'opendj-form' : 'ad-form',
      pluginDescriptorRef: { id: 'com.pingidentity.adapters.htmlform.idp.HtmlFormIdpAuthnAdapter' },
      configuration: { tables: [{ name: 'Credential Validators', rows: [{ fields: fields({ 'Password Credential Validator Instance': d.pcv }) }] }],
        fields: fields({ 'Challenge Retries': 3, 'Session State': 'None', 'Login Template': 'html.form.login.template.html' }) },
      attributeContract: { coreAttributes: [{ name: 'username', pseudonym: true }, { name: 'policy.action' }], extendedAttributes: Object.values(d.attrs).map((name) => ({ name })), maskOgnlValues: false },
    });
  }

  console.log('== Policy contract lab-contract, selector login-selector, policy lab-main');
  await upsert('policy contract lab-contract', '/authenticationPolicyContracts', ID.apc, {
    id: ID.apc, name: 'lab-contract', coreAttributes: [{ name: 'subject' }], extendedAttributes: CONTRACT_ATTRS.map((name) => ({ name })),
  });
  await upsert('selector login-selector (HTTP request parameter "login")', '/authenticationSelectors', ID.selector, {
    id: ID.selector, name: 'login-selector',
    pluginDescriptorRef: { id: 'com.pingidentity.pf.selectors.http.HttpRequestParamAuthnSelector' },
    configuration: { tables: [], fields: fields({ 'HTTP Request Parameter Name': 'login', 'Case-Sensitive Matching': 'false',
      "Enable 'Any' Result Value": 'false', "Enable 'No Match' Result Value": 'true', "Enable 'Not in Request' Result Value": 'true' }) },
    attributeContract: { extendedAttributes: Object.keys(DIRS).map((name) => ({ name })) },
  });
  const branch = (context, d, dirName) => {
    const ad = (v) => ({ source: { type: 'ADAPTER', id: d.form }, value: v });
    return { action: { type: 'AUTHN_SOURCE', context, authenticationSource: { type: 'IDP_ADAPTER', sourceRef: { id: d.form } } }, children: [
      { action: { type: 'DONE', context: 'Fail' } },
      { action: { type: 'APC_MAPPING', context: 'Success', authenticationPolicyContractRef: { id: ID.apc }, attributeMapping: {
        attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
        attributeContractFulfillment: { subject: ad('username'), username: ad('username'),
          ...Object.fromEntries(Object.entries(d.attrs).map(([c, a]) => [c, ad(a)])), directory: text(dirName) } } } },
    ] };
  };
  const tree = { name: 'lab-main', description: 'Lab: ?login=ldap|ad picks OpenDJ or AD form; otherwise OpenDJ', enabled: true, rootNode: {
    action: { type: 'AUTHN_SELECTOR', authenticationSelectorRef: { id: ID.selector } }, children: [
      branch('ldap', DIRS.ldap, 'opendj'), branch('ad', DIRS.ad, 'ad'), branch('No Match', DIRS.ldap, 'opendj'), branch('Not in Request', DIRS.ldap, 'opendj') ] } };
  const pol = must('get policies', await api('GET', '/authenticationPolicies/default'));
  must('put policies', await api('PUT', '/authenticationPolicies/default', { ...pol, trackedHttpParameters: Array.from(new Set([...(pol.trackedHttpParameters || []), 'login'])),
    authnSelectionTrees: [...(pol.authnSelectionTrees || []).filter((t) => t.name !== 'lab-main'), tree] }));
  must('put policy settings', await api('PUT', '/authenticationPolicies/settings', { enableIdpAuthnSelection: true, enableSpAuthnSelection: false }));
  console.log('  policy tree lab-main saved (tracked parameter "login"), IdP authentication policies enabled');
  await remove('old simple-PCV adapter', '/idp/adapters', 'htmlformsimplepcv');
  await remove('old simple PCV', '/passwordCredentialValidators', 'simplepcv');

  console.log('== Step 2: ATM lab-jwt-atm');
  await upsert('ATM lab-jwt-atm', '/oauth/accessTokenManagers', ID.atm, {
    id: ID.atm, name: 'lab-jwt-atm',
    pluginDescriptorRef: { id: 'com.pingidentity.pf.access.token.management.plugins.JwtBearerAccessTokenManagementPlugin' },
    configuration: { tables: [{ name: 'Symmetric Keys', rows: [] }, { name: 'Certificates', rows: [] }],
      fields: fields({ 'Token Lifetime': 60, 'Use Centralized Signing Key': 'true', 'JWS Algorithm': 'RS256', 'JWT ID Claim Length': 22 }) },
    attributeContract: { extendedAttributes: CONTRACT_ATTRS.map((name) => ({ name, multiValued: name === 'groups' })) },
    selectionSettings: { resourceUris: [] }, accessControlSettings: { restrictClients: false, allowedClients: [] },
    sessionValidationSettings: { checkValidAuthnSession: false, checkSessionRevocationStatus: false, updateAuthnSessionActivity: false, includeSessionId: false },
  });

  console.log('== Step 3: Grant mapping lab-contract');
  await upsert('grant mapping lab-contract', '/oauth/authenticationPolicyContractMappings', ID.apc, {
    id: ID.apc, authenticationPolicyContractRef: { id: ID.apc }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
    attributeContractFulfillment: { USER_KEY: apc('subject'), USER_NAME: apc('username') },
  });

  console.log('== Step 4: Access token mapping');
  const list = must('list access token mappings', await api('GET', '/oauth/accessTokenMappings'));
  const existing = (Array.isArray(list) ? list : list.items || []).find((m) => m.context?.type === 'AUTHENTICATION_POLICY_CONTRACT' && m.context.contextRef?.id === ID.apc && m.accessTokenManagerRef?.id === ID.atm);
  const atmMapping = { context: { type: 'AUTHENTICATION_POLICY_CONTRACT', contextRef: { id: ID.apc } }, accessTokenManagerRef: { id: ID.atm },
    attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, attributeContractFulfillment: Object.fromEntries(CONTRACT_ATTRS.map((a) => [a, apc(a)])) };
  if (existing) { must('update access token mapping', await api('PUT', `/oauth/accessTokenMappings/${encodeURIComponent(existing.id)}`, { ...atmMapping, id: existing.id })); console.log(`  updated access token mapping ${existing.id}`); }
  else { const r = must('create access token mapping', await api('POST', '/oauth/accessTokenMappings', atmMapping)); console.log(`  created access token mapping ${r.id}`); }

  console.log('== Step 5: OIDC policy lab-oidc');
  const claims = { sub: 'username', email: 'email', name: 'displayName', preferred_username: 'username', title: 'title', department: 'department', groups: 'groups', directory: 'directory' };
  await upsert('OIDC policy lab-oidc', '/oauth/openIdConnect/policies', ID.oidc, {
    id: ID.oidc, name: 'Lab OIDC Policy', accessTokenManagerRef: { id: ID.atm }, idTokenLifetime: 5,
    includeUserInfoInIdToken: true, includeSriInIdToken: false, includeSHashInIdToken: false, includeX5tInIdToken: false,
    returnIdTokenOnRefreshGrant: false, returnIdTokenOnTokenExchangeGrant: false, reissueIdTokenInHybridFlow: false,
    attributeContract: { coreAttributes: [{ name: 'sub' }], extendedAttributes: Object.keys(claims).filter((c) => c !== 'sub').map((name) => ({ name, multiValued: name === 'groups' })) },
    attributeMapping: { attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, attributeContractFulfillment: Object.fromEntries(Object.entries(claims).map(([c, v]) => [c, tok(v)])) },
    scopeAttributeMappings: { email: { values: ['email'] }, profile: { values: ['name', 'preferred_username', 'title', 'department'] } },
  });
  must('set default OIDC policy', await api('PUT', '/oauth/openIdConnect/settings', { defaultPolicyRef: { id: ID.oidc } }));
  console.log('  lab-oidc set as default');

  console.log('== Step 6: OAuth client pflab-node-app');
  await upsert('client pflab-node-app', '/oauth/clients', ID.client, {
    clientId: ID.client, name: 'Lab Node App (OIDC)', enabled: true,
    redirectUris: [`${APP_URL}/oidc/callback`], grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
    clientAuth: { type: 'SECRET', secret: SECRET }, requireProofKeyForCodeExchange: true, bypassApprovalPage: true, restrictScopes: false,
    defaultAccessTokenManagerRef: { id: ID.atm },
    oidcPolicy: { idTokenSigningAlgorithm: 'RS256', policyGroup: { id: ID.oidc }, grantAccessSessionRevocationApi: false, pingAccessLogoutCapable: false, postLogoutRedirectUris: [`${APP_URL}/`] },
  });
  console.log(`\nDone. OIDC_CLIENT_SECRET=${SECRET}\nTest users: OpenDJ ayesha.rahman / rahim.uddin, AD karim.hossain / nadia.islam (password from LAB_USER_PASSWORD)`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
