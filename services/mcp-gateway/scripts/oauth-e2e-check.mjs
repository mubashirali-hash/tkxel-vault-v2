// End-to-end OAuth 2.1 check for the MCP gateway against a real authorization server (Keycloak).
// Behaves like an MCP client that has never seen this gateway (FR-61, FR-90, FR-91):
//   discovery (RFC 9728 -> RFC 8414) -> dynamic client registration (RFC 7591)
//   -> authorization code with PKCE (S256) and a resource indicator (RFC 8707) -> token -> MCP calls.
//
// Opt-in; needs a running gateway and Keycloak. Environment:
//   GATEWAY_URL            e.g. http://localhost:53001
//   KEYCLOAK_URL           e.g. http://localhost:58080
//   KEYCLOAK_REALM         default tkxel-vault
//   KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD   bootstrap admin, used only by --setup
//   E2E_USER_EMAIL / E2E_USER_PASSWORD         the test user who signs in
//   E2E_VAULT_ID           optional: a vault the user can read, for a tool call
//
//   node scripts/oauth-e2e-check.mjs --setup   create the realm, audience scope, policies and user
//   node scripts/oauth-e2e-check.mjs           run the client flow
import crypto from 'node:crypto';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};
const GATEWAY = env('GATEWAY_URL').replace(/\/+$/, '');
const KEYCLOAK = env('KEYCLOAK_URL').replace(/\/+$/, '');
const REALM = env('KEYCLOAK_REALM', 'tkxel-vault');
const USER_EMAIL = env('E2E_USER_EMAIL');
const USER_PASSWORD = env('E2E_USER_PASSWORD');
// The gateway's resource identifier (RFC 9728), which is also the audience of its access tokens
const RESOURCE = `${GATEWAY}/mcp`;
const REDIRECT_URI = 'http://127.0.0.1:53999/callback'; // never opened: the redirect is read, not followed

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
  return ok;
};
const json = async (res) => {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 300) }; }
};
const form = (fields) => new URLSearchParams(fields).toString();

async function setup() {
  const adminToken = (await json(await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'password', client_id: 'admin-cli', username: env('KEYCLOAK_ADMIN'), password: env('KEYCLOAK_ADMIN_PASSWORD') }),
  }))).access_token;
  if (!adminToken) throw new Error('Could not sign in to Keycloak as the bootstrap admin');
  const admin = (path, init = {}) => fetch(`${KEYCLOAK}/admin${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  let res = await admin('/realms', { method: 'POST', body: JSON.stringify({ realm: REALM, enabled: true }) });
  console.log(`realm ${REALM}: ${res.status === 201 ? 'created' : res.status === 409 ? 'already exists' : `HTTP ${res.status}`}`);

  // Every client of the realm, including dynamically registered ones, gets the gateway as audience
  res = await admin(`/realms/${REALM}/client-scopes`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'mcp-gateway-audience', protocol: 'openid-connect',
      attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
      protocolMappers: [{
        name: 'mcp-gateway-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
        config: { 'included.custom.audience': RESOURCE, 'access.token.claim': 'true', 'id.token.claim': 'false' },
      }],
    }),
  });
  const scopes = await json(await admin(`/realms/${REALM}/client-scopes`));
  const scope = scopes.find((s) => s.name === 'mcp-gateway-audience');
  res = await admin(`/realms/${REALM}/default-default-client-scopes/${scope.id}`, { method: 'PUT' });
  console.log(`audience scope: default for new clients (HTTP ${res.status})`);

  // Anonymous registration is limited to trusted hosts by default; the test client registers from this machine
  const components = await json(await admin(`/realms/${REALM}/components?type=org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy`));
  for (const component of components.filter((c) => c.subType === 'anonymous' && c.providerId === 'trusted-hosts')) {
    component.config = {
      'host-sending-registration-request-must-match': ['false'],
      'client-uris-must-match': ['true'],
      'trusted-hosts': ['127.0.0.1', 'localhost'],
    };
    res = await admin(`/realms/${REALM}/components/${component.id}`, { method: 'PUT', body: JSON.stringify(component) });
    console.log(`trusted-hosts policy updated (HTTP ${res.status})`);
  }
  for (const component of components.filter((c) => c.subType === 'anonymous' && c.providerId === 'allowed-client-templates')) {
    component.config = { ...component.config, 'allow-default-scopes': ['true'], 'allowed-client-scopes': ['mcp-gateway-audience'] };
    await admin(`/realms/${REALM}/components/${component.id}`, { method: 'PUT', body: JSON.stringify(component) });
  }

  res = await admin(`/realms/${REALM}/users`, {
    method: 'POST',
    body: JSON.stringify({
      username: USER_EMAIL, email: USER_EMAIL, emailVerified: true, enabled: true, firstName: 'E2E', lastName: 'Reader',
      credentials: [{ type: 'password', value: USER_PASSWORD, temporary: false }],
    }),
  });
  console.log(`user ${USER_EMAIL}: ${res.status === 201 ? 'created' : res.status === 409 ? 'already exists' : `HTTP ${res.status}`}`);
}

async function mcp(token, method, params, id = 1) {
  const res = await fetch(`${GATEWAY}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: res.status, headers: res.headers, body: await json(res) };
}

async function run() {
  // 1. An unauthenticated call tells the client where to look
  const unauth = await mcp(null, 'tools/list', {});
  const challenge = unauth.headers.get('www-authenticate') || '';
  check('unauthenticated call is refused with a pointer to the resource metadata', unauth.status === 401 && /resource_metadata="[^"]+"/.test(challenge), `HTTP ${unauth.status}`);
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] || `${GATEWAY}/.well-known/oauth-protected-resource`;

  // 2. Protected-resource metadata names the authorization server
  const resource = await json(await fetch(metadataUrl));
  const issuer = resource.authorization_servers?.[0];
  check('protected-resource metadata names the gateway and an authorization server', resource.resource === RESOURCE && Boolean(issuer), `resource ${resource.resource}, issuer ${issuer}`);

  // 3. Authorization-server metadata
  let meta = await json(await fetch(`${issuer}/.well-known/oauth-authorization-server`));
  if (!meta.authorization_endpoint) meta = await json(await fetch(`${issuer}/.well-known/openid-configuration`));
  check('authorization server publishes its endpoints and supports PKCE S256',
    Boolean(meta.authorization_endpoint && meta.token_endpoint && meta.registration_endpoint) && (meta.code_challenge_methods_supported || []).includes('S256'));

  // 4. Dynamic client registration, as a public client
  const registration = await json(await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'tkxel-vault e2e MCP client', redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
  }));
  if (!check('dynamic client registration returns a client', Boolean(registration.client_id), registration.error_description || registration.error || '')) return;

  // 5. Authorization code with PKCE; the user signs in on the authorization server's own form
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challengeS256 = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  const authorizeUrl = `${meta.authorization_endpoint}?${form({
    response_type: 'code', client_id: registration.client_id, redirect_uri: REDIRECT_URI, scope: 'openid email profile',
    code_challenge: challengeS256, code_challenge_method: 'S256', state, resource: RESOURCE,
  })}`;
  const loginPage = await fetch(authorizeUrl, { redirect: 'manual' });
  const cookies = loginPage.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const html = await loginPage.text();
  const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (!check('authorization endpoint shows the sign-in form', loginPage.status === 200 && Boolean(action), `HTTP ${loginPage.status}`)) return;

  // Cookie jar for the authorization server session
  const jar = new Map(loginPage.headers.getSetCookie().map((c) => c.split(';')[0].split(/=(.*)/s).slice(0, 2)));
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const remember = (res) => res.headers.getSetCookie().forEach((c) => {
    const [k, v] = c.split(';')[0].split(/=(.*)/s);
    jar.set(k, v);
  });

  let step = await fetch(action, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
    body: form({ username: USER_EMAIL, password: USER_PASSWORD, credentialId: '' }),
  });
  remember(step);
  let location = step.headers.get('location') || '';
  const trail = [];
  // The server may show further pages of its own before returning to the client. A client that
  // registered itself is unknown to the user, so the server asks for consent; the user grants it.
  for (let hop = 0; hop < 6 && !location.startsWith(REDIRECT_URI); hop++) {
    let page = step;
    if (location) {
      trail.push(new URL(location, KEYCLOAK).pathname.split('/').slice(-2).join('/'));
      page = await fetch(new URL(location, KEYCLOAK), { redirect: 'manual', headers: { Cookie: cookieHeader() } });
      remember(page);
      location = page.headers.get('location') || '';
      if (location) { step = page; continue; }
    }
    const body = await page.text();
    const nextAction = /<form[^>]*action="([^"]+)"/.exec(body)?.[1]?.replace(/&amp;/g, '&');
    if (!nextAction) { trail.push(`no form (HTTP ${page.status})`); break; }
    const isConsent = /name="accept"/.test(body);
    trail.push(isConsent ? 'consent' : `form:${/<title>([^<]*)/.exec(body)?.[1]?.trim() || '?'}`);
    if (!isConsent) break;
    step = await fetch(new URL(nextAction, KEYCLOAK), {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader() },
      body: form({ accept: 'Yes' }),
    });
    remember(step);
    location = step.headers.get('location') || '';
  }
  const redirect = location.startsWith(REDIRECT_URI) ? new URL(location) : null;
  const code = redirect?.searchParams.get('code');
  if (!check('sign-in (and consent for the new client) redirects back with a code and the same state',
    Boolean(code) && redirect.searchParams.get('state') === state, `HTTP ${step.status}${trail.length ? `, via ${trail.join(' > ')}` : ''}`)) return;

  // A code is useless without the PKCE verifier
  const stolen = await json(await fetch(meta.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: registration.client_id, code_verifier: crypto.randomBytes(48).toString('base64url') }),
  }));
  check('token endpoint rejects a wrong PKCE verifier', !stolen.access_token, stolen.error || '');

  // 6. A fresh code (the first one is now spent) exchanged with the right verifier
  const second = await fetch(authorizeUrl, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
  const code2 = new URL(second.headers.get('location') || 'http://x/').searchParams.get('code');
  const tokens = await json(await fetch(meta.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code: code2 || '', redirect_uri: REDIRECT_URI, client_id: registration.client_id, code_verifier: verifier, resource: RESOURCE }),
  }));
  if (!check('token endpoint issues an access token for the right verifier', Boolean(tokens.access_token), tokens.error_description || tokens.error || '')) return;
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf-8'));
  const audiences = [].concat(claims.aud || []);
  check('the access token is issued for this gateway', audiences.includes(RESOURCE), `aud ${JSON.stringify(claims.aud)}`);

  // 7. The gateway accepts the token and serves the user's own tools
  const init = await mcp(tokens.access_token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  check('gateway accepts the token (initialize)', init.status === 200 && Boolean(init.body.result?.serverInfo), `HTTP ${init.status}`);
  const tools = await mcp(tokens.access_token, 'tools/list', {}, 2);
  const names = (tools.body.result?.tools || []).map((t) => t.name);
  check('gateway lists tools for the signed-in user', tools.status === 200 && names.includes('list_vaults'), names.join(', '));
  const vaultId = process.env.E2E_VAULT_ID;
  if (vaultId) {
    const search = await mcp(tokens.access_token, 'tools/call', { name: 'search', arguments: { query: 'gateway', vault_id: vaultId } }, 3);
    check('a tool call runs with the user\'s vault access', search.status === 200 && !search.body.error && !search.body.result?.isError, JSON.stringify(search.body.result?.structuredContent ?? search.body.error ?? '').slice(0, 120));
    const other = await mcp(tokens.access_token, 'tools/call', { name: 'search', arguments: { query: 'gateway', vault_id: crypto.randomUUID() } }, 4);
    check('a vault the user has no access to is refused', Boolean(other.body.error || other.body.result?.isError));
  }

  // 8. Tokens that are not for this gateway are refused
  const tampered = `${tokens.access_token.slice(0, -4)}AAAA`;
  check('a token with a broken signature is refused', (await mcp(tampered, 'tools/list', {})).status === 401);
  if (tokens.id_token) {
    check('an ID token (not an access token for the gateway) is refused', (await mcp(tokens.id_token, 'tools/list', {})).status === 401);
  }
}

if (process.argv.includes('--setup')) await setup();
else {
  await run();
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.length > 0 && results.every(Boolean) ? 0 : 1);
}
