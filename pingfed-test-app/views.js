// Minimal server-rendered HTML. No front-end framework on purpose: every request is visible.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (v) => `<pre>${esc(JSON.stringify(v, null, 2))}</pre>`;

// Must match the result values of the PingFederate selector "login-selector" (policy lab-main)
const ADAPTERS = [
  { value: 'ldap', label: 'OpenDJ', hint: 'opendj-form → opendj-pcv (e.g. ayesha.rahman)' },
  { value: 'ad', label: 'Active Directory', hint: 'ad-form → ad-pcv (e.g. karim.hossain)' },
  { value: 'xyz', label: 'Unknown value', hint: 'login=xyz → "No Match" branch' },
];

function layout(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · PingFed Lab App</title>
<style>
  :root { --bg:#f6f5fa; --card:#fff; --ink:#1f1f2e; --muted:#5f6272; --accent:#4B2C91; --line:#e3e0ee; --ok:#1c7c54; --bad:#b42318; --code:#f1eff7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14131a; --card:#1d1c25; --ink:#ecebf3; --muted:#a3a1b3; --accent:#b49cff; --line:#2e2c3a; --ok:#5fd39b; --bad:#ff8a80; --code:#262433; } }
  * { box-sizing:border-box; }
  body { margin:0; font-family: system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  header { background:var(--accent); color:#fff; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; }
  header a { color:#fff; }
  main { max-width:1000px; margin:0 auto; padding:24px 16px 60px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin-bottom:18px; }
  h1 { font-size:20px; margin:0; } h2 { font-size:17px; margin:0 0 12px; color:var(--accent); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
  .btn { display:inline-block; padding:10px 14px; border-radius:8px; border:1px solid var(--accent); color:var(--accent); text-decoration:none; font-weight:600; background:transparent; cursor:pointer; font-size:14px; }
  .btn.primary { background:var(--accent); color:#fff; }
  .opt { border:1px solid var(--line); border-radius:8px; padding:12px; }
  .opt small { display:block; color:var(--muted); margin-top:6px; }
  pre { background:var(--code); padding:12px; border-radius:8px; overflow:auto; font-size:12.5px; margin:0; white-space:pre-wrap; word-break:break-all; }
  table { width:100%; border-collapse:collapse; font-size:14px; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; width:32%; }
  .ok { color:var(--ok); font-weight:600; } .bad { color:var(--bad); font-weight:600; }
  .muted { color:var(--muted); font-size:13px; }
  label { font-size:13px; color:var(--muted); display:block; margin:8px 0 4px; }
  input, select { width:100%; padding:8px; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--ink); }
  details summary { cursor:pointer; color:var(--accent); font-weight:600; margin:8px 0; }
</style></head>
<body><header><h1>PingFed Lab App</h1><nav><a href="/">Home</a> · <a href="/diagnostics">Diagnostics</a> · <a href="/saml/metadata">SP metadata</a></nav></header>
<main>${body}</main></body></html>`;
}

function home({ user, cfg }) {
  const adapterButtons = (proto) => ADAPTERS.map((a) => `
    <div class="opt"><a class="btn primary" href="/${proto}/login?login=${a.value}">${proto === 'oidc' ? 'OIDC' : 'SAML'}: ${esc(a.label)}</a>
    <small>login=${a.value} · ${esc(a.hint)}</small></div>`).join('');
  return layout('Home', `
  ${user ? `<div class="card"><h2>Signed in</h2><p>You are signed in as <b>${esc(user.subject)}</b> via <b>${esc(user.protocol)}</b>${user.adapter ? ` (requested adapter: <b>${esc(user.adapter)}</b>)` : ''}.</p>
    <a class="btn primary" href="/profile">View claims &amp; tokens</a> ${logoutButtons(user)}</div>` : ''}
  <div class="card"><h2>1 · OpenID Connect (authorization code + PKCE)</h2>
    <div class="grid">${adapterButtons('oidc')}
      <div class="opt"><a class="btn" href="/oidc/login">OIDC: no hint</a><small>"Not in Request" branch</small></div></div>
    <p class="muted">After an OIDC login: Profile → <b>Token lab</b> to practise JWKS and introspection.</p></div>
  <div class="card"><h2>2 · SAML 2.0 (SP-initiated, HTTP-Redirect → HTTP-POST)</h2>
    <div class="grid">${adapterButtons('saml')}
      <div class="opt"><a class="btn" href="/saml/login">SAML: no hint</a><small>no login= → "Not in Request" branch</small></div></div>
    ${cfg.samlReady ? '' : `<p class="bad">SAML is not configured yet: ${esc(cfg.samlProblem)}</p>`}</div>
  <div class="card"><h2>3 · Custom request</h2>
    <form action="/oidc/login" method="get">
      <div class="grid">
        <div><label>login (HTTP Request Parameter selector)</label><input name="login" placeholder="ldap | ad"></div>
        <div><label>prompt</label><select name="prompt"><option value="">(none)</option><option>login</option><option>none</option><option>consent</option></select></div>
        <div><label>acr_values (Requested AuthN Context selector)</label><input name="acr_values" placeholder="e.g. urn:pflab:mfa"></div>
        <div><label>login_hint</label><input name="login_hint" placeholder="e.g. testa"></div>
        <div><label>extra scopes</label><input name="scope_extra" placeholder="e.g. offline_access"></div>
      </div><p><button class="btn primary" type="submit">Start OIDC login</button></p></form>
    <p class="muted">prompt=login forces a fresh login even if PingFederate already has a session — use it when switching adapters.</p></div>`);
}

function profile({ user }) {
  const rows = Object.entries(user.claims || {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('');
  return layout('Profile', `
  <div class="card"><h2>${esc(user.protocol)} login result</h2>
    <table><tr><th>Subject</th><td><b>${esc(user.subject)}</b></td></tr>
    <tr><th>Requested adapter (login=)</th><td>${esc(user.adapter || '(none)')}</td></tr>
    <tr><th>Logged in at</th><td>${esc(user.at)}</td></tr></table></div>
  <div class="card"><h2>${user.protocol === 'SAML' ? 'Assertion attributes' : 'ID token claims (signature verified)'}</h2><table>${rows}</table></div>
  ${user.userinfo ? `<div class="card"><h2>UserInfo endpoint</h2>${json(user.userinfo)}</div>` : ''}
  ${user.accessTokenClaims ? `<div class="card"><h2>Access token</h2>${json(user.accessTokenClaims)}</div>` : ''}
  ${user.raw ? `<div class="card"><h2>Raw</h2>${Object.entries(user.raw).map(([k, v]) => `<details><summary>${esc(k)}</summary><pre>${esc(v)}</pre></details>`).join('')}</div>` : ''}
  <p><a class="btn" href="/">Home</a> ${user.protocol === 'OIDC' ? '<a class="btn primary" href="/tokens">Token lab (JWKS &amp; introspection)</a> ' : ''}${logoutButtons(user)}</p>`);
}

// JWKS = check the signature yourself with PingFederate's public keys; introspection = ask PingFederate
function tokens({ jwksUri, jwks, results, kids, introspection, introspectionEndpoint, client }) {
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const usedBy = (kid) => Object.entries(kids).filter(([, k]) => k && k === kid).map(([n]) => n).join(', ');
  const keyRows = keys.map((k) => `<tr><td>${esc(k.kid)}</td><td>${esc(k.kty)}${k.crv ? ' ' + esc(k.crv) : ''}</td><td>${esc(k.alg || '')}</td><td>${esc(k.use || '')}</td><td class="ok">${esc(usedBy(k.kid))}</td></tr>`).join('');
  const verdict = (r) => (r.expectFail
    ? (r.ok ? '<span class="bad">ACCEPTED (bad!)</span>' : '<span class="ok">REJECTED (expected)</span>')
    : (r.ok ? '<span class="ok">VALID</span>' : '<span class="bad">INVALID</span>'));
  const verifyRows = results.map((r) => `<tr><th>${esc(r.label)}</th><td>${verdict(r)}</td><td>${esc(r.detail)}</td></tr>`).join('');
  const choice = (v, label, checked) => `<label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:14px"><input type="radio" name="which" value="${v}" style="width:auto" ${checked ? 'checked' : ''}> ${label}</label>`;
  const active = introspection && typeof introspection.body === 'object' ? introspection.body.active : undefined;
  return layout('Token lab', `
  <div class="card"><h2>1 · JWKS — PingFederate's public keys</h2>
    <p>jwks_uri: <a href="${esc(jwksUri)}" target="_blank" rel="noopener">${esc(jwksUri)}</a> <span class="muted">(open it in the browser too)</span></p>
    <table><tr><th>kid</th><th>kty</th><th>alg</th><th>use</th><th>signed your token</th></tr>${keyRows || '<tr><td colspan="5" class="bad">no keys</td></tr>'}</table>
    <p class="muted">Each token's header carries a <b>kid</b>. The app picks the key with the same kid from this list and checks the signature. Only public keys are here — anyone may read them; the private key never leaves PingFederate.</p>
    <details><summary>Raw JWKS JSON</summary>${json(jwks)}</details></div>
  <div class="card"><h2>2 · Verify locally with JWKS (no call to PingFederate about the token)</h2>
    <table><tr><th>Token</th><th>Result</th><th>Detail</th></tr>${verifyRows}</table>
    <p class="muted">Reload this page after the ID token lifetime (5 min) or access token lifetime (60 min): verification then fails with "exp" — local checks cannot know about logout or revocation, only signature and expiry.</p></div>
  <div class="card" id="introspection"><h2>3 · Introspection — ask PingFederate "is this token active?"</h2>
    <p>Endpoint: <code>${esc(introspectionEndpoint || '(not in discovery)')}</code><br>Authenticating as <b>${esc(client.id)}</b> — <span class="muted">${esc(client.kind)}</span></p>
    <form action="/tokens/introspect" method="post">
      ${choice('access', 'My access token', !introspection || introspection.which === 'access')}
      ${choice('tampered', 'Tampered access token (directory = "TAMPERED")', introspection?.which === 'tampered')}
      ${choice('id', 'My ID token (needs "Allow ID Token Introspection" in the OIDC policy)', introspection?.which === 'id')}
      ${choice('custom', 'Paste a token:', introspection?.which === 'custom')}
      <input name="token" placeholder="eyJ... (any token, e.g. one copied from another login)">
      <p><button class="btn primary" type="submit">Introspect</button></p></form>
    ${introspection ? `<p>Result for <b>${esc(introspection.which)}</b> at ${esc(introspection.at || '')} → HTTP <b>${esc(introspection.status)}</b>
      ${active === true ? '<span class="ok">active: true</span>' : active === false ? '<span class="bad">active: false</span>' : ''}</p>${json(introspection.body)}` : ''}
    <p class="muted">HTTP 401 / invalid_client = the introspecting client is wrong or lacks the "Access Token Validation (Client is a Resource Server)" grant type.</p></div>
  <p><a class="btn" href="/profile">Profile</a> <a class="btn" href="/">Home</a></p>`);
}

// SAML users get two choices so the difference between "app only" and "Single Logout" is visible
function logoutButtons(user) {
  if (user.protocol === 'SAML') {
    return `<a class="btn primary" href="/saml/logout" title="App + PingFederate (+ other apps)">Single Logout (SLO)</a>
      <a class="btn" href="/logout" title="Only this app; the PingFederate session stays">Log out of app only</a>`;
  }
  return `<a class="btn" href="/logout">Log out</a>`;
}

function loggedOut({ who, kind }) {
  return layout('Logged out', `<div class="card"><h2 class="ok">Logged out</h2>
    <p>${esc(kind)}${who ? ` for <b>${esc(who)}</b>` : ''}.</p>
    <p class="muted">Both the app session and the PingFederate session were ended. The next SAML login should ask for a password again.</p>
    <p><a class="btn primary" href="/">Home</a></p></div>`);
}

function error(title, err, hint) {
  return layout('Error', `<div class="card"><h2 class="bad">${esc(title)}</h2>${json(err)}${hint ? `<p class="muted">${esc(hint)}</p>` : ''}<p><a class="btn" href="/">Home</a></p></div>`);
}

function diagnostics(checks) {
  const rows = checks.map((c) => `<tr><th>${esc(c.name)}</th><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'OK' : 'FAIL'}</td><td>${esc(c.detail)}</td></tr>`).join('');
  return layout('Diagnostics', `<div class="card"><h2>Connection checks</h2><table>${rows}</table></div><p><a class="btn" href="/">Home</a></p>`);
}

module.exports = { home, profile, tokens, error, diagnostics, loggedOut, ADAPTERS };
