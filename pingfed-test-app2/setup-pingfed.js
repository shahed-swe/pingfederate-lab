// Configures PingFederate for the PingFed Lab App through the Admin API.
//   node setup-pingfed.js            -> dry run: prints what would change
//   node setup-pingfed.js --apply    -> applies the changes
//   node setup-pingfed.js --apply --only=client,oidc   -> selected steps
// Every step is "upsert": GET the object, then PUT if it exists or POST if it does not.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const crypto = require('crypto');
const { Agent, fetch } = require('undici');

const VM = process.env.PF_VM_HOST || '192.168.0.29';
const ADMIN = process.env.PF_ADMIN_URL || `https://${VM}:9999/pf-admin-api/v1`;
if (!process.env.PF_ADMIN_PASSWORD) { console.error('Set PF_ADMIN_PASSWORD (PingFederate admin password) first.'); process.exit(1); }
const AUTH = 'Basic ' + Buffer.from(`${process.env.PF_ADMIN_USER || 'admin'}:${process.env.PF_ADMIN_PASSWORD}`).toString('base64');
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const agent = new Agent({ connect: { rejectUnauthorized: false } });   // lab: self-signed admin certificate

const IDS = {
  signing: 'pflabsigning', apc: 'pflabapp', selector: 'pflablogin', atm: 'pflabatm',
  oidc: 'pflaboidc', client: process.env.OIDC_CLIENT_ID || 'pflab-node-app', spConn: process.env.SAML_SP_ENTITY_ID || 'pflab-node-app',
};
const ADAPTERS = { ldap: 'htmlformopendj', local: 'htmlformsimplepcv', radius: 'htmlformradius' };

async function api(method, path, body) {
  const res = await fetch(ADMIN + path, {
    method, dispatcher: agent,
    headers: { Authorization: AUTH, 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}
const fail = (what, r) => { throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 800)}`); };

async function upsert(label, collection, id, body) {
  const cur = await api('GET', `${collection}/${encodeURIComponent(id)}`);
  const verb = cur.ok ? 'PUT' : 'POST';
  console.log(`  ${APPLY ? '' : '[dry-run] '}${verb} ${collection}${cur.ok ? '/' + id : ''}  (${label})`);
  if (!APPLY) return;
  const r = cur.ok ? await api('PUT', `${collection}/${encodeURIComponent(id)}`, body) : await api('POST', collection, body);
  if (!r.ok) fail(label, r);
  return r.data;
}
const adapterAttr = (adapter, value) => ({ source: { type: 'ADAPTER', id: adapter }, value });
const text = (value) => ({ source: { type: 'TEXT' }, value });

const steps = {
  // 1. Federation info: base URL reachable from other machines + SAML entity ID
  async federation() {
    const body = { ...(await api('GET', '/serverSettings/federationInfo')).data, baseUrl: `https://${VM}:9031`, saml2EntityId: process.env.SAML_IDP_ENTITY_ID || 'pingfed-lab-idp' };
    console.log(`  ${APPLY ? '' : '[dry-run] '}PUT /serverSettings/federationInfo  baseUrl=${body.baseUrl} saml2EntityId=${body.saml2EntityId}`);
    if (APPLY) { const r = await api('PUT', '/serverSettings/federationInfo', body); if (!r.ok) fail('federation info', r); }
  },

  // 2. Signing key pair (signs SAML assertions) + export its certificate for the app
  async signing() {
    const cur = await api('GET', `/keyPairs/signing/${IDS.signing}`);
    if (!cur.ok) {
      console.log(`  ${APPLY ? '' : '[dry-run] '}POST /keyPairs/signing/generate  (CN=PingFed Lab Signing, RSA 2048, 730 days)`);
      if (APPLY) {
        const r = await api('POST', '/keyPairs/signing/generate', { id: IDS.signing, commonName: 'PingFed Lab Signing', organization: 'PingFed Lab', country: 'BD', validDays: 730, keyAlgorithm: 'RSA', keySize: 2048, signatureAlgorithm: 'SHA256withRSA' });
        if (!r.ok) fail('signing key', r);
      }
    } else console.log('  signing key pair exists');
    if (APPLY) {
      const res = await fetch(`${ADMIN}/keyPairs/signing/${IDS.signing}/certificate`, { dispatcher: agent, headers: { Authorization: AUTH, 'X-XSRF-Header': 'PingFederate' } });
      if (!res.ok) throw new Error(`export certificate: HTTP ${res.status}`);
      fs.writeFileSync(process.env.SAML_IDP_CERT_FILE || './pingfed-signing.crt', await res.text());
      console.log('  wrote pingfed-signing.crt');
    }
  },

  // 3. Fix htmlformopendj: username from the adapter (was emailAddress), email from LDAP "mail"
  async adapterfix() {
    const a = (await api('GET', '/idp/adapters/htmlformopendj')).data;
    if (!a?.attributeMapping) return console.log('  htmlformopendj not found — skipped');
    const m = a.attributeMapping;
    m.attributeContractFulfillment.username = { source: { type: 'ADAPTER' }, value: 'username' };
    const src = m.attributeSources.find((s) => s.type === 'LDAP');
    if (src) {
      src.searchAttributes = Array.from(new Set([...(src.searchAttributes || []).filter((x) => x !== 'emailAddress'), 'mail']));
      m.attributeContractFulfillment.email = { source: { type: 'LDAP_DATA_STORE', id: src.id }, value: 'mail' };
    }
    await upsert('htmlformopendj: username<-adapter, email<-LDAP mail', '/idp/adapters', 'htmlformopendj', a);
  },

  // 4. Policy contract with an "adapter" attribute so the app shows which adapter ran
  async apc() {
    await upsert('policy contract pflab-app', '/authenticationPolicyContracts', IDS.apc, {
      id: IDS.apc, name: 'pflab-app', coreAttributes: [{ name: 'subject' }],
      extendedAttributes: [{ name: 'email' }, { name: 'username' }, { name: 'adapter' }],
    });
  },

  // 5. Selector on ?login=ldap|local|radius
  async selector() {
    await upsert('selector pflablogin (HTTP request parameter "login")', '/authenticationSelectors', IDS.selector, {
      id: IDS.selector, name: 'pflab-login',
      pluginDescriptorRef: { id: 'com.pingidentity.pf.selectors.http.HttpRequestParamAuthnSelector' },
      configuration: { tables: [], fields: [
        { name: 'HTTP Request Parameter Name', value: 'login' },
        { name: 'Case-Sensitive Matching', value: 'false' },
        { name: "Enable 'Any' Result Value", value: 'false' },
        { name: "Enable 'No Match' Result Value", value: 'true' },
        { name: "Enable 'Not in Request' Result Value", value: 'true' },
      ] },
      attributeContract: { extendedAttributes: Object.keys(ADAPTERS).map((name) => ({ name })) },
    });
  },

  // 6. Authentication policy tree: selector -> adapter -> contract
  async policy() {
    const branch = (context, adapter) => ({
      action: { type: 'AUTHN_SOURCE', context, authenticationSource: { type: 'IDP_ADAPTER', sourceRef: { id: adapter } } },
      children: [
        { action: { type: 'DONE', context: 'Fail' } },
        { action: { type: 'APC_MAPPING', context: 'Success', authenticationPolicyContractRef: { id: IDS.apc },
          attributeMapping: { attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, attributeContractFulfillment: {
            subject: adapterAttr(adapter, 'username'), username: adapterAttr(adapter, 'username'),
            email: adapterAttr(adapter, adapter === 'htmlformradius' ? 'username' : 'email'), adapter: text(adapter) } } } },
      ],
    });
    const cur = (await api('GET', '/authenticationPolicies/default')).data;
    const tree = { name: 'pflab-main', description: 'PingFed Lab App: ?login=ldap|local|radius picks the adapter', enabled: true,
      rootNode: { action: { type: 'AUTHN_SELECTOR', authenticationSelectorRef: { id: IDS.selector } }, children: [
        ...Object.entries(ADAPTERS).map(([ctx, ad]) => branch(ctx, ad)),
        branch('No Match', ADAPTERS.ldap), branch('Not in Request', ADAPTERS.ldap),
      ] } };
    const body = { ...cur, trackedHttpParameters: Array.from(new Set([...(cur.trackedHttpParameters || []), 'login'])),
      authnSelectionTrees: [...(cur.authnSelectionTrees || []).filter((t) => t.name !== 'pflab-main'), tree] };
    console.log(`  ${APPLY ? '' : '[dry-run] '}PUT /authenticationPolicies/default  (tree pflab-main, tracked parameter "login")`);
    console.log(`  ${APPLY ? '' : '[dry-run] '}PUT /authenticationPolicies/settings  (enable IdP authentication policies)`);
    if (APPLY) {
      let r = await api('PUT', '/authenticationPolicies/default', body); if (!r.ok) fail('policy tree', r);
      r = await api('PUT', '/authenticationPolicies/settings', { enableIdpAuthnSelection: true, enableSpAuthnSelection: false }); if (!r.ok) fail('policy settings', r);
    }
  },

  // 7. OAuth server: scopes + persistent grant attributes
  async oauthserver() {
    const s = (await api('GET', '/oauth/authServerSettings')).data;
    for (const [name, description] of [['profile', 'Basic profile'], ['email', 'E-mail address']]) if (!s.scopes.some((x) => x.name === name)) s.scopes.push({ name, description, dynamic: false });
    for (const name of ['email', 'adapter']) if (!s.persistentGrantContract.extendedAttributes.some((x) => x.name === name)) s.persistentGrantContract.extendedAttributes.push({ name });
    console.log(`  ${APPLY ? '' : '[dry-run] '}PUT /oauth/authServerSettings  (scopes profile,email; grant attributes email,adapter)`);
    if (APPLY) { const r = await api('PUT', '/oauth/authServerSettings', s); if (!r.ok) fail('auth server settings', r); }
  },

  // 8. Access token manager (reference tokens — opaque, validated by introspection)
  async atm() {
    await upsert('access token manager pflabatm (reference)', '/oauth/accessTokenManagers', IDS.atm, {
      id: IDS.atm, name: 'pflab-reference-tokens',
      pluginDescriptorRef: { id: 'org.sourceid.oauth20.token.plugin.impl.ReferenceBearerAccessTokenManagementPlugin' },
      configuration: { tables: [], fields: [{ name: 'Token Length', value: '28' }, { name: 'Token Lifetime', value: '120' }] },
      attributeContract: { extendedAttributes: [{ name: 'username' }, { name: 'email' }, { name: 'adapter' }] },
    });
  },

  // 9. Contract -> persistent grant, grant -> access token
  async mappings() {
    const apc = (v) => ({ source: { type: 'AUTHENTICATION_POLICY_CONTRACT' }, value: v });
    await upsert('policy contract grant mapping', '/oauth/authenticationPolicyContractMappings', IDS.apc, {
      id: IDS.apc, authenticationPolicyContractRef: { id: IDS.apc }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
      attributeContractFulfillment: { USER_KEY: apc('subject'), USER_NAME: apc('subject'), email: apc('email'), adapter: apc('adapter') },
    });
    const grant = (v) => ({ source: { type: 'OAUTH_PERSISTENT_GRANT' }, value: v });
    await upsert('access token mapping (default context)', '/oauth/accessTokenMappings', `default|${IDS.atm}`, {
      id: `default|${IDS.atm}`, context: { type: 'DEFAULT' }, accessTokenManagerRef: { id: IDS.atm }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
      attributeContractFulfillment: { username: grant('USER_KEY'), email: grant('email'), adapter: grant('adapter') },
    });
  },

  // 10. OpenID Connect policy (ID token claims)
  async oidc() {
    const tok = (v) => ({ source: { type: 'TOKEN' }, value: v });
    await upsert('OIDC policy pflaboidc', '/oauth/openIdConnect/policies', IDS.oidc, {
      id: IDS.oidc, name: 'pflab-oidc', accessTokenManagerRef: { id: IDS.atm },
      includeUserInfoInIdToken: true, includeSriInIdToken: false, returnIdTokenOnRefreshGrant: false,
      attributeContract: { coreAttributes: [{ name: 'sub' }], extendedAttributes: [{ name: 'email' }, { name: 'preferred_username' }, { name: 'auth_adapter' }] },
      attributeMapping: { attributeSources: [], issuanceCriteria: { conditionalCriteria: [] }, attributeContractFulfillment: {
        sub: tok('username'), email: tok('email'), preferred_username: tok('username'), auth_adapter: tok('adapter') } },
      scopeAttributeMappings: {},
    });
  },

  // 11. OAuth client for the app (secret written to .env)
  async client() {
    const cur = await api('GET', `/oauth/clients/${IDS.client}`);
    let secret = process.env.OIDC_CLIENT_SECRET;
    if (!secret || secret.startsWith('change-me')) secret = crypto.randomBytes(24).toString('base64url');
    const body = {
      clientId: IDS.client, name: 'PingFed Lab Node App', enabled: true,
      redirectUris: [`${APP_URL}/oidc/callback`], grantTypes: ['AUTHORIZATION_CODE', 'REFRESH_TOKEN'],
      clientAuth: { type: 'SECRET', secret }, requireProofKeyForCodeExchange: true, bypassApprovalPage: true, restrictScopes: false,
      defaultAccessTokenManagerRef: { id: IDS.atm },
      oidcPolicy: { idTokenSigningAlgorithm: 'RS256', policyGroup: { id: IDS.oidc }, grantAccessSessionRevocationApi: false, pingAccessLogoutCapable: false },
    };
    if (cur.ok && process.env.OIDC_CLIENT_SECRET && !process.env.OIDC_CLIENT_SECRET.startsWith('change-me')) body.clientAuth = { type: 'SECRET', secret: process.env.OIDC_CLIENT_SECRET };
    await upsert(`OAuth client ${IDS.client}`, '/oauth/clients', IDS.client, body);
    if (APPLY) { setEnv('OIDC_CLIENT_SECRET', body.clientAuth.secret); console.log('  client secret saved to .env'); }
  },

  // 12. SAML SP connection for the app
  async spconnection() {
    const apcAttr = (v) => ({ source: { type: 'AUTHENTICATION_POLICY_CONTRACT' }, value: v });
    const basic = 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic';
    await upsert('SAML SP connection pflab-node-app', '/idp/spConnections', IDS.spConn, {
      id: IDS.spConn, entityId: IDS.spConn, name: 'PingFed Lab Node App', active: true, loggingMode: 'STANDARD', type: 'SP',
      credentials: { signingSettings: { signingKeyPairRef: { id: IDS.signing }, algorithm: 'SHA256withRSA', includeCertInSignature: false } },
      spBrowserSso: {
        protocol: 'SAML20', enabledProfiles: ['SP_INITIATED_SSO', 'IDP_INITIATED_SSO'], incomingBindings: ['REDIRECT', 'POST'],
        ssoServiceEndpoints: [{ binding: 'POST', url: `${APP_URL}/saml/acs`, index: 0, isDefault: true }],
        signAssertions: true, signResponseAsRequired: true, requireSignedAuthnRequests: false,
        spSamlIdentityMapping: 'STANDARD', assertionLifetime: { minutesBefore: 5, minutesAfter: 5 },
        encryptionPolicy: { encryptAssertion: false, encryptSloSubjectNameId: false, sloSubjectNameIDEncrypted: false, encryptedAttributes: [] },
        attributeContract: {
          coreAttributes: [{ name: 'SAML_SUBJECT', nameFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified' }],
          extendedAttributes: ['email', 'username', 'adapter'].map((name) => ({ name, nameFormat: basic })),
        },
        adapterMappings: [],
        authenticationPolicyContractAssertionMappings: [{
          authenticationPolicyContractRef: { id: IDS.apc }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
          restrictVirtualEntityIds: false, restrictedVirtualEntityIds: [], abortSsoTransactionAsFailSafe: false,
          attributeContractFulfillment: { SAML_SUBJECT: apcAttr('subject'), email: apcAttr('email'), username: apcAttr('username'), adapter: apcAttr('adapter') },
        }],
      },
    });
  },
};

function setEnv(key, value) {
  const file = '.env';
  let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fs.readFileSync('.env.example', 'utf8');
  s = new RegExp(`^${key}=.*$`, 'm').test(s) ? s.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`) : s + `\n${key}=${value}\n`;
  fs.writeFileSync(file, s);
}

(async () => {
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (add --apply to make changes)'} — PingFederate admin API ${ADMIN}`);
  for (const [name, fn] of Object.entries(steps)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    console.log(`\n== ${name}`);
    try { await fn(); } catch (e) { console.error(`  ERROR: ${e.message}`); process.exitCode = 1; if (APPLY) break; }
  }
  if (APPLY && !process.exitCode) { setEnv('PF_BASE_URL', `https://${VM}:9031`); console.log('\nDone. PF_BASE_URL set in .env. Start the app with: npm start'); }
})();
