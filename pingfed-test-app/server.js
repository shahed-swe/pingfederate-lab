// PingFed Lab App — a tiny relying party for testing PingFederate adapters and policies.
// OIDC: authorization code + PKCE S256 (confidential or public client). SAML: SP-initiated, Redirect -> POST.
// Token lab (/tokens): verify tokens locally with JWKS vs ask PingFederate via the introspection endpoint.
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { Agent, fetch } = require('undici');
const jose = require('jose');
const { SAML, ValidateInResponseTo } = require('@node-saml/node-saml');
const views = require('./views');

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const cfg = {
  pfBase: env('PF_BASE_URL', 'https://172.22.127.250:9031').replace(/\/$/, ''),
  pfIssuer: env('PF_ISSUER', ''),
  insecureTls: env('PF_TLS_INSECURE', 'true') === 'true',
  clientId: env('OIDC_CLIENT_ID', 'pflab-node-app'),
  clientSecret: env('OIDC_CLIENT_SECRET', ''),
  scopes: env('OIDC_SCOPES', 'openid profile email'),
  // Resource-server client used for token introspection (falls back to the app's own client)
  introspectClientId: env('INTROSPECT_CLIENT_ID', ''),
  introspectClientSecret: env('INTROSPECT_CLIENT_SECRET', ''),
  spEntityId: env('SAML_SP_ENTITY_ID', 'pflab-node-app'),
  idpEntityId: env('SAML_IDP_ENTITY_ID', 'pingfed-lab-idp'),
  idpCertFile: env('SAML_IDP_CERT_FILE', './pingfed-signing.crt'),
  // The app's own key pair: signs SAML logout messages (PingFederate requires signed SLO messages)
  spKeyFile: env('SAML_SP_KEY_FILE', './sp-signing.key'),
  spCertFile: env('SAML_SP_CERT_FILE', './sp-signing.crt'),
  port: Number(env('PORT', 3000)),
  appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
};

// PingFederate in the lab uses a self-signed certificate (CN=localhost); trust it only for calls to PingFederate.
const pfAgent = cfg.insecureTls ? new Agent({ connect: { rejectUnauthorized: false } }) : undefined;
const pfFetch = (url, init = {}) => fetch(url, { ...init, dispatcher: pfAgent });
if (cfg.insecureTls) console.warn('[lab] PF_TLS_INSECURE=true — TLS certificate of PingFederate is NOT verified');

// ---------------------------------------------------------------- OIDC discovery
let oidc = null;          // { issuer, authorization_endpoint, token_endpoint, userinfo_endpoint, jwks, end_session_endpoint }
async function discover() {
  if (oidc) return oidc;
  const res = await pfFetch(`${cfg.pfBase}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Discovery failed: HTTP ${res.status} from ${cfg.pfBase}/.well-known/openid-configuration`);
  const meta = await res.json();
  // If PingFederate's Base URL is e.g. https://localhost:9031, its endpoints are unreachable from here:
  // keep the issuer for token validation, but call the endpoints on PF_BASE_URL.
  const issuer = cfg.pfIssuer || meta.issuer;
  const rebase = (u) => (u ? cfg.pfBase + new URL(u).pathname : u);
  oidc = {
    issuer,
    authorization_endpoint: rebase(meta.authorization_endpoint),
    token_endpoint: rebase(meta.token_endpoint),
    userinfo_endpoint: rebase(meta.userinfo_endpoint),
    end_session_endpoint: rebase(meta.ping_end_session_endpoint || meta.end_session_endpoint),
    introspection_endpoint: rebase(meta.introspection_endpoint),
    jwks_uri: rebase(meta.jwks_uri),
    jwks:jose.createRemoteJWKSet(new URL(rebase(meta.jwks_uri)), { [jose.customFetch]: (u, o) => pfFetch(u, o) }),
  };
  return oidc;
}

const b64url = (buf) => buf.toString('base64url');
const basicAuth = (id, secret) => 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');

// Change one claim but keep the original signature — what an attacker editing a token would produce
function tamper(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.directory = 'TAMPERED';
    return [parts[0], b64url(Buffer.from(JSON.stringify(payload))), parts[2]].join('.');
  } catch { return null; }
}

// ---------------------------------------------------------------- SAML
let saml = null;
cfg.samlReady = false;
const readOptional = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const spKey = readOptional(cfg.spKeyFile);
const spCert = readOptional(cfg.spCertFile);
cfg.sloReady = Boolean(spKey && spCert);
const spSigning = cfg.sloReady
  ? { privateKey: spKey, publicCert: spCert, signatureAlgorithm: 'sha256' }
  : {};
try {
  const idpCert = fs.readFileSync(cfg.idpCertFile, 'utf8');
  saml = new SAML({
    ...spSigning,
    logoutUrl: `${cfg.pfBase}/idp/SLO.saml2`,
    logoutCallbackUrl: `${cfg.appUrl}/saml/slo`,
    entryPoint: `${cfg.pfBase}/idp/SSO.saml2`,
    issuer: cfg.spEntityId,
    idpIssuer: cfg.idpEntityId,
    callbackUrl: `${cfg.appUrl}/saml/acs`,
    idpCert,
    audience: cfg.spEntityId,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
    validateInResponseTo: ValidateInResponseTo.ifPresent,   // allows IdP-initiated too
    acceptedClockSkewMs: 60_000,
  });
  cfg.samlReady = true;
} catch (e) {
  cfg.samlProblem = `cannot read IdP signing certificate "${cfg.idpCertFile}" (${e.code || e.message})`;
}

// ---------------------------------------------------------------- app
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: env('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

app.get('/', (req, res) => res.send(views.home({ user: req.session.user, cfg })));

app.get('/profile', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.send(views.profile({ user: req.session.user }));
});

// ---- OIDC: start
app.get('/oidc/login', async (req, res) => {
  try {
    const o = await discover();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const nonce = b64url(crypto.randomBytes(16));
    req.session.oidc = { verifier, state, nonce, adapter: req.query.login || '' };

    const scope = [cfg.scopes, req.query.scope_extra].filter(Boolean).join(' ');
    const params = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: `${cfg.appUrl}/oidc/callback`,
      scope, state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    });
    // Extra parameters PingFederate selectors can act on
    for (const k of ['login', 'prompt', 'acr_values', 'login_hint']) if (req.query[k]) params.set(k, req.query[k]);
    const url = `${o.authorization_endpoint}?${params}`;
    req.session.oidc.authorizeUrl = url;
    res.redirect(url);
  } catch (e) {
    res.status(502).send(views.error('Could not reach PingFederate', { message: e.message, cause: e.cause?.code }, 'Check PF_BASE_URL in .env, that the VM is running, and that the licence is valid. Open /diagnostics.'));
  }
});

// ---- OIDC: callback
app.get('/oidc/callback', async (req, res) => {
  const st = req.session.oidc;
  if (req.query.error) return res.status(400).send(views.error('PingFederate returned an error', req.query));
  if (!st || req.query.state !== st.state) return res.status(400).send(views.error('State mismatch', { expected: st?.state, got: req.query.state }, 'Start the login again from the home page.'));
  try {
    const o = await discover();
    // Confidential client (secret set): client_secret_basic + PKCE.
    // Public client (OIDC_CLIENT_SECRET empty): no secret, client_id in the body — PKCE alone protects the code.
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const form = { grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${cfg.appUrl}/oidc/callback`, code_verifier: st.verifier };
    if (cfg.clientSecret) {
      headers.Authorization = basicAuth(cfg.clientId, cfg.clientSecret);
    } else {
      form.client_id = cfg.clientId;
    }
    const tokenRes = await pfFetch(o.token_endpoint, { method: 'POST', headers, body: new URLSearchParams(form) });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) return res.status(400).send(views.error(`Token endpoint returned HTTP ${tokenRes.status}`, tokens));

    const { payload: claims } = await jose.jwtVerify(tokens.id_token, o.jwks, { issuer: o.issuer, audience: cfg.clientId });
    if (claims.nonce !== st.nonce) throw new Error('Nonce mismatch in ID token');

    let userinfo = null;
    if (o.userinfo_endpoint) {
      const ui = await pfFetch(o.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      userinfo = ui.ok ? await ui.json() : { error: `HTTP ${ui.status}`, body: await ui.text() };
    }
    let accessTokenClaims;
    try { accessTokenClaims = jose.decodeJwt(tokens.access_token); } catch { accessTokenClaims = { type: 'reference token (opaque — not a JWT)', value: tokens.access_token }; }

    req.session.user = {
      protocol: 'OIDC', subject: claims.sub, adapter: st.adapter, at: new Date().toISOString(),
      claims, userinfo, accessTokenClaims, idToken: tokens.id_token, accessToken: tokens.access_token,
      raw: {
        'Authorization request': st.authorizeUrl,
        'PKCE (S256)': [
          `code_verifier  (kept secret by the app, sent only to the token endpoint): ${st.verifier}`,
          `code_challenge (sent in the authorization request) = BASE64URL(SHA256(code_verifier)): ${b64url(crypto.createHash('sha256').update(st.verifier).digest())}`,
          `client type: ${cfg.clientSecret ? 'confidential (secret + PKCE)' : 'public (PKCE only)'}`,
        ].join('\n'),
        'Token response': JSON.stringify({ ...tokens, id_token: tokens.id_token?.slice(0, 40) + '…', access_token: tokens.access_token?.slice(0, 20) + '…' }, null, 2),
        'ID token header': JSON.stringify(jose.decodeProtectedHeader(tokens.id_token), null, 2),
      },
    };
    delete req.session.oidc;
    res.redirect('/profile');
  } catch (e) {
    res.status(400).send(views.error('OIDC login failed', { message: e.message, code: e.code }));
  }
});

// ---- SAML: start
app.get('/saml/login', async (req, res) => {
  if (!cfg.samlReady) return res.status(503).send(views.error('SAML not configured', { problem: cfg.samlProblem }, 'Export the PingFederate signing certificate to the file named in SAML_IDP_CERT_FILE.'));
  const adapter = req.query.login || '';
  const relay = JSON.stringify({ adapter, n: b64url(crypto.randomBytes(6)) });
  const additionalParams = adapter ? { login: adapter } : {};
  try {
    const url = await saml.getAuthorizeUrlAsync(relay, undefined, { additionalParams });
    req.session.samlRequestUrl = url;
    res.redirect(url);
  } catch (e) {
    res.status(500).send(views.error('Could not build AuthnRequest', { message: e.message }));
  }
});

// ---- SAML: ACS (HTTP-POST)
app.post('/saml/acs', async (req, res) => {
  if (!cfg.samlReady) return res.status(503).send(views.error('SAML not configured', { problem: cfg.samlProblem }));
  try {
    const { profile } = await saml.validatePostResponseAsync(req.body);
    let adapter = '';
    try { adapter = JSON.parse(req.body.RelayState || '{}').adapter || ''; } catch { /* IdP-initiated: free-form RelayState */ }
    const { issuer, nameID, nameIDFormat, sessionIndex, getAssertionXml, getSamlResponseXml, ...attrs } = profile;
    req.session.user = {
      protocol: 'SAML', subject: nameID, adapter, at: new Date().toISOString(),
      // Needed later to build a LogoutRequest that PingFederate can match to this SSO session
      samlSession: { issuer, nameID, nameIDFormat, sessionIndex },
      claims: { issuer, nameID, nameIDFormat, sessionIndex, ...Object.fromEntries(Object.entries(attrs).filter(([k]) => !k.startsWith('attributes'))) },
      raw: {
        'AuthnRequest (redirect URL)': req.session.samlRequestUrl || '(IdP-initiated — no request)',
        'RelayState': req.body.RelayState || '',
        'SAML Response (decoded XML)': getSamlResponseXml ? getSamlResponseXml() : Buffer.from(req.body.SAMLResponse, 'base64').toString(),
      },
    };
    res.redirect('/profile');
  } catch (e) {
    res.status(400).send(views.error('SAML response rejected', { message: e.message }, 'Common causes: wrong IdP signing certificate, entity ID / audience mismatch, clock skew.'));
  }
});

app.get('/saml/metadata', (req, res) => {
  // Includes the SingleLogoutService endpoint and the app's signing certificate (when sp-signing.* exist)
  const meta = new SAML({ ...spSigning, issuer: cfg.spEntityId, callbackUrl: `${cfg.appUrl}/saml/acs`,
    logoutCallbackUrl: `${cfg.appUrl}/saml/slo`, idpCert: 'unused', audience: cfg.spEntityId,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified', wantAssertionsSigned: true })
    .generateServiceProviderMetadata(null, cfg.sloReady ? spCert : null);
  res.type('application/xml').send(meta);
});

// ---- SAML Single Logout, SP-initiated: app -> PingFederate (signed LogoutRequest, HTTP-Redirect)
app.get('/saml/logout', async (req, res) => {
  const user = req.session.user;
  if (user?.protocol !== 'SAML' || !user.samlSession) return res.redirect('/logout');
  if (!cfg.sloReady) return res.status(503).send(views.error('SLO not configured', { problem: 'sp-signing.key / sp-signing.crt missing' }));
  try {
    const url = await saml.getLogoutUrlAsync(user.samlSession, 'slo-from-app', {});
    req.session.sloRequestUrl = url;
    res.redirect(url);
  } catch (e) {
    res.status(500).send(views.error('Could not build LogoutRequest', { message: e.message }));
  }
});

// ---- SAML SLO endpoint: receives either
//  (a) LogoutResponse — PingFederate finished the logout we started, or
//  (b) LogoutRequest  — logout started elsewhere (IdP-initiated / another app); we must answer with a LogoutResponse
async function handleSlo(req, res, viaPost) {
  try {
    const params = viaPost ? req.body : req.query;
    const isRequest = Boolean(params.SAMLRequest);
    let result;
    if (!viaPost) result = await saml.validateRedirectAsync(req.query, req.originalUrl.split('?')[1] || '');
    else if (isRequest) result = await saml.validatePostRequestAsync(req.body);
    else result = await saml.validatePostResponseAsync(req.body);
    const who = req.session.user?.subject;
    req.session.destroy(() => {});
    if (isRequest) {
      // Logout initiated by PingFederate: confirm back with a signed LogoutResponse
      const url = await saml.getLogoutResponseUrlAsync(result.profile, params.RelayState || '', {}, true);
      return res.redirect(url);
    }
    res.send(views.loggedOut({ who, kind: 'SP-initiated SAML Single Logout completed' }));
  } catch (e) {
    req.session.destroy(() => {});
    res.status(400).send(views.error('SAML logout message rejected', { message: e.message },
      'Common causes: PingFederate does not have the app signing certificate (sp-signing.crt), or SLO is not enabled in the SP connection.'));
  }
}
app.get('/saml/slo', (req, res) => handleSlo(req, res, false));
app.post('/saml/slo', (req, res) => handleSlo(req, res, true));

// ---- Logout (local session; OIDC also ends the PingFederate session if supported)
app.get('/logout', async (req, res) => {
  const user = req.session.user;
  req.session.destroy(() => {});
  if (user?.protocol === 'OIDC') {
    try {
      const o = await discover();
      if (o.end_session_endpoint) {
        const p = new URLSearchParams({ id_token_hint: user.idToken, post_logout_redirect_uri: cfg.appUrl + '/' });
        return res.redirect(`${o.end_session_endpoint}?${p}`);
      }
    } catch { /* fall through */ }
  }
  res.redirect('/');
});

// ---- Token lab: JWKS (verify signatures locally) vs introspection (ask PingFederate)
const introspector = () => (cfg.introspectClientId
  ? { id: cfg.introspectClientId, secret: cfg.introspectClientSecret, kind: 'resource server client (INTROSPECT_CLIENT_ID)' }
  : { id: cfg.clientId, secret: cfg.clientSecret, kind: "the app's own OIDC client (INTROSPECT_CLIENT_ID is empty)" });

app.get('/tokens', async (req, res) => {
  const user = req.session.user;
  if (user?.protocol !== 'OIDC' || !user.accessToken) return res.redirect('/');
  try {
    const o = await discover();
    const jwksRes = await pfFetch(o.jwks_uri);
    const jwks = jwksRes.ok ? await jwksRes.json() : { error: `HTTP ${jwksRes.status}` };
    const header = (t) => { try { return jose.decodeProtectedHeader(t); } catch { return null; } };
    // Local verification: only the public keys from JWKS are used, PingFederate is not asked about the token
    const verify = async (label, token, opts, expectFail = false) => {
      if (!token) return { label, ok: false, expectFail, detail: 'not a JWT (reference token?)' };
      try {
        const { payload, protectedHeader } = await jose.jwtVerify(token, o.jwks, opts);
        return { label, ok: true, expectFail, detail: `signature valid (kid ${protectedHeader.kid}, alg ${protectedHeader.alg}); expires ${new Date(payload.exp * 1000).toLocaleTimeString()}` };
      } catch (e) {
        return { label, ok: false, expectFail, detail: `${e.code || 'ERROR'}: ${e.message}` };
      }
    };
    const tampered = tamper(user.accessToken);
    const results = [
      await verify('ID token', user.idToken, { issuer: o.issuer, audience: cfg.clientId }),
      await verify('Access token (JWT)', user.accessToken, {}),
      await verify('Tampered access token (directory = "TAMPERED", old signature)', tampered, {}, true),
    ];
    res.send(views.tokens({
      jwksUri: o.jwks_uri, jwks, results,
      kids: { 'ID token': header(user.idToken)?.kid, 'Access token': header(user.accessToken)?.kid },
      introspection: req.session.introspection, introspectionEndpoint: o.introspection_endpoint, client: introspector(),
    }));
  } catch (e) {
    res.status(502).send(views.error('Token lab failed', { message: e.message, cause: e.cause?.code }));
  }
});

app.post('/tokens/introspect', async (req, res) => {
  const user = req.session.user;
  if (user?.protocol !== 'OIDC' || !user.accessToken) return res.redirect('/');
  const which = req.body.which;
  const token = { access: user.accessToken, tampered: tamper(user.accessToken), id: user.idToken, custom: (req.body.token || '').trim() }[which];
  const c = introspector();
  try {
    const o = await discover();
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const form = { token: token || '' };
    if (which === 'access' || which === 'tampered') form.token_type_hint = 'access_token';
    if (c.secret) headers.Authorization = basicAuth(c.id, c.secret); else form.client_id = c.id;
    const r = await pfFetch(o.introspection_endpoint, { method: 'POST', headers, body: new URLSearchParams(form) });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    req.session.introspection = { which, client: c.id, status: r.status, body, at: new Date().toLocaleTimeString() };
  } catch (e) {
    req.session.introspection = { which, client: c.id, status: 'network error', body: { message: e.message, cause: e.cause?.code } };
  }
  res.redirect('/tokens#introspection');
});

// ---- Diagnostics
app.get('/diagnostics', async (req, res) => {
  const checks = [];
  const check = async (name, fn) => { try { checks.push({ name, ok: true, detail: await fn() }); } catch (e) { checks.push({ name, ok: false, detail: e.cause?.code || e.message }); } };
  await check('Runtime heartbeat', async () => {
    const r = await pfFetch(`${cfg.pfBase}/pf/heartbeat.ping`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} (503 usually = expired licence)`);
    return (await r.text()).trim();
  });
  await check('OIDC discovery', async () => { oidc = null; const o = await discover(); return `issuer ${o.issuer}`; });
  await check('OIDC client type', async () => (cfg.clientSecret
    ? `${cfg.clientId}: confidential (client secret + PKCE S256)`
    : `${cfg.clientId}: public (no secret, PKCE S256 only)`));
  await check('Introspection client', async () => { const c = introspector(); if (cfg.introspectClientId && !c.secret) throw new Error(`${c.id}: INTROSPECT_CLIENT_SECRET is empty`); return `${c.id} — ${c.kind}`; });
  await check('SAML IdP certificate', async () => { if (!cfg.samlReady) throw new Error(cfg.samlProblem); return cfg.idpCertFile; });
  await check('SAML SLO signing key (app)', async () => { if (!cfg.sloReady) throw new Error(`missing ${cfg.spKeyFile} / ${cfg.spCertFile}`); return cfg.spCertFile; });
  res.send(views.diagnostics(checks));
});

app.listen(cfg.port, () => console.log(`PingFed Lab App on ${cfg.appUrl}  (PingFederate: ${cfg.pfBase})`));
