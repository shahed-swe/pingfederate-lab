// Configures the SAML side of the lab per pingfederate-lab/PingFederate_Hands-on_Checklist.md (parts 1.2, 3.2, 5.2):
// federation entity ID, IdP signing key (exported for the app), SP connection pflab-node-app with SSO + SLO,
// the app's own signing certificate for signature verification, and adapter session tracking for logout.
//   PF_ADMIN_PASSWORD=Admin123 node setup-saml-lab.js
const fs = require('fs');
const https = require('https');
const path = require('path');

const ADMIN = process.env.PF_ADMIN_URL || 'https://localhost:9999/pf-admin-api/v1';
const USER = process.env.PF_ADMIN_USER || 'admin';
const PASS = process.env.PF_ADMIN_PASSWORD || 'Admin123';
const APP_URL = (process.env.APP_URL || 'http://localhost:3100').replace(/\/$/, '');
const APP_DIR = process.env.APP_DIR || path.join(__dirname, '..', 'pingfed-test-app');
const IDP_ENTITY_ID = process.env.SAML_IDP_ENTITY_ID || 'pingfed-lab-idp';
const ID = { signing: 'pflabsigning', apc: 'labcontract', sp: 'pflab-node-app' };
const ATTRS = ['email', 'username', 'displayName', 'title', 'department', 'employeeId', 'groups', 'directory'];

function api(method, p, body, raw) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(ADMIN + p, { method, rejectUnauthorized: false,
      headers: { Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64'), 'X-XSRF-Header': 'PingFederate', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => { let d = t; if (!raw) { try { d = t ? JSON.parse(t) : null; } catch { d = t; } } resolve({ status: res.statusCode, ok: res.statusCode < 300, data: d }); }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const must = (label, r) => { if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 1200)}`); return r.data; };
async function upsert(label, collection, id, body) {
  const cur = await api('GET', `${collection}/${encodeURIComponent(id)}`);
  const r = cur.ok ? await api('PUT', `${collection}/${encodeURIComponent(id)}`, body) : await api('POST', collection, body);
  must(label, r); console.log(`  ${cur.ok ? 'updated' : 'created'} ${label}`); return r.data;
}
const apcAttr = (v) => ({ source: { type: 'AUTHENTICATION_POLICY_CONTRACT' }, value: v });
const pem = (file) => fs.readFileSync(file, 'utf8');
const pemToBase64 = (p) => p.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

(async () => {
  console.log('== 1.1 Federation info: SAML 2.0 entity ID');
  const fed = must('get federationInfo', await api('GET', '/serverSettings/federationInfo'));
  must('put federationInfo', await api('PUT', '/serverSettings/federationInfo', { ...fed, saml2EntityId: IDP_ENTITY_ID }));
  console.log(`  baseUrl=${fed.baseUrl} saml2EntityId=${IDP_ENTITY_ID}`);

  console.log('== 1.2 IdP signing key pair "PingFed Lab Signing"');
  if (!(await api('GET', `/keyPairs/signing/${ID.signing}`)).ok) {
    must('generate signing key', await api('POST', '/keyPairs/signing/generate', { id: ID.signing, commonName: 'PingFed Lab Signing', organization: 'PingFed Lab', country: 'BD', validDays: 730, keyAlgorithm: 'RSA', keySize: 2048, signatureAlgorithm: 'SHA256withRSA' }));
    console.log('  generated');
  } else console.log('  exists');
  const certFile = path.join(APP_DIR, 'pingfed-signing.crt');
  fs.writeFileSync(certFile, must('export certificate', await api('GET', `/keyPairs/signing/${ID.signing}/certificate`, null, true)));
  console.log(`  exported certificate -> ${certFile}`);

  console.log('== 3.2 + 5.2 SP connection pflab-node-app (SSO + SLO, verify app signature)');
  const spCert = pem(path.join(APP_DIR, 'sp-signing.crt'));
  const basic = 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic';
  await upsert('SP connection pflab-node-app', '/idp/spConnections', ID.sp, {
    id: ID.sp, entityId: ID.sp, name: 'PingFed Lab Node App', active: true, loggingMode: 'STANDARD', type: 'SP', baseUrl: APP_URL,
    credentials: {
      signingSettings: { signingKeyPairRef: { id: ID.signing }, algorithm: 'SHA256withRSA', includeCertInSignature: false, includeRawKeyInSignature: false },
      // Trust model "unanchored": trust exactly this certificate (the app's sp-signing.crt) for signed AuthnRequest / LogoutRequest / LogoutResponse
      certs: [{ x509File: { fileData: pemToBase64(spCert) }, activeVerificationCert: true, primaryVerificationCert: true, encryptionCert: false }],
    },
    spBrowserSso: {
      protocol: 'SAML20', enabledProfiles: ['SP_INITIATED_SSO', 'IDP_INITIATED_SSO', 'SP_INITIATED_SLO', 'IDP_INITIATED_SLO'],
      incomingBindings: ['REDIRECT', 'POST'],
      ssoServiceEndpoints: [{ binding: 'POST', url: `${APP_URL}/saml/acs`, index: 0, isDefault: true }],
      sloServiceEndpoints: [{ binding: 'REDIRECT', url: `${APP_URL}/saml/slo`, responseUrl: `${APP_URL}/saml/slo` }, { binding: 'POST', url: `${APP_URL}/saml/slo`, responseUrl: `${APP_URL}/saml/slo` }],
      signAssertions: true, signResponseAsRequired: true, requireSignedAuthnRequests: false,
      spSamlIdentityMapping: 'STANDARD', assertionLifetime: { minutesBefore: 5, minutesAfter: 5 },
      encryptionPolicy: { encryptAssertion: false, encryptSloSubjectNameId: false, sloSubjectNameIDEncrypted: false, encryptedAttributes: [] },
      attributeContract: {
        coreAttributes: [{ name: 'SAML_SUBJECT', nameFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified' }],
        extendedAttributes: ATTRS.map((name) => ({ name, nameFormat: basic })),
      },
      adapterMappings: [],
      authenticationPolicyContractAssertionMappings: [{
        authenticationPolicyContractRef: { id: ID.apc }, attributeSources: [], issuanceCriteria: { conditionalCriteria: [] },
        restrictVirtualEntityIds: false, restrictedVirtualEntityIds: [], abortSsoTransactionAsFailSafe: false,
        attributeContractFulfillment: { SAML_SUBJECT: apcAttr('subject'), ...Object.fromEntries(ATTRS.map((a) => [a, apcAttr(a)])) },
      }],
    },
  });

  console.log('== 5.2 Sessions: Track Adapter Sessions for Logout');
  const sess = must('get session settings', await api('GET', '/session/settings'));
  must('put session settings', await api('PUT', '/session/settings', { ...sess, trackAdapterSessionsForLogout: true }));
  console.log('  trackAdapterSessionsForLogout=true');
  console.log('\nDone. App .env needs SAML_IDP_ENTITY_ID=' + IDP_ENTITY_ID + ' and SAML_IDP_CERT_FILE=./pingfed-signing.crt');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
