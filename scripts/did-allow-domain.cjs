/**
 * Authorize a domain on Morgan's D-ID avatar client key.
 *
 * Why this exists: the D-ID browser SDK authorizes connections using a *client
 * key* that is scoped to an explicit `allowed_domains` list (an API-only feature,
 * not exposed in the D-ID Studio UI). If a deployment's domain is not on the
 * key's list, the browser gets HTTP 401 + a CORS-looking error when connecting,
 * even though the API key, agent, and client key are all valid.
 *
 * This script reads DID_API_KEY / DID_AGENT_ID / DID_CLIENT_KEY from .env (or the
 * environment) and PATCHes the client key to ADD a domain to allowed_domains,
 * preserving the existing domains (so other deployments keep working). The client
 * key value does not change, so no app-setting update or redeploy is required.
 *
 * Usage:
 *   node scripts/did-allow-domain.cjs https://your-app.azurewebsites.net
 *   node scripts/did-allow-domain.cjs            # defaults to the D-CFO web app
 *
 * Secrets are read at runtime and never printed.
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = { ...process.env };
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in env) || !env[m[1]]) env[m[1]] = v;
    }
  }
  return env;
}

function normalizeDomain(input) {
  let d = String(input || '').trim();
  if (!d) return '';
  if (!/^https?:\/\//i.test(d)) d = 'https://' + d;
  return d.replace(/\/$/, '');
}

async function main() {
  const env = loadEnv();
  const apiKey = env.DID_API_KEY;
  const agentId = env.DID_AGENT_ID;
  const clientKey = env.DID_CLIENT_KEY;
  if (!apiKey || !agentId || !clientKey) {
    console.error('Missing DID_API_KEY, DID_AGENT_ID, or DID_CLIENT_KEY in .env / environment.');
    process.exit(1);
  }

  const target = normalizeDomain(process.argv[2] || 'https://morganfinanceagent-webapp.azurewebsites.net');
  if (!target) {
    console.error('Provide a domain, e.g. node scripts/did-allow-domain.cjs https://your-app.azurewebsites.net');
    process.exit(1);
  }

  const headers = { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' };
  const base = `https://api.d-id.com/agents/${agentId}/client-keys`;

  const listResp = await fetch(base, { headers });
  if (!listResp.ok) {
    console.error(`Could not list client keys: ${listResp.status} ${listResp.statusText}`);
    process.exit(1);
  }
  const list = await listResp.json();
  const keys = Array.isArray(list) ? list : (list.client_keys || list.keys || []);
  const current = keys.find((k) => k.client_key === clientKey);
  if (!current) {
    console.error('Configured DID_CLIENT_KEY was not found among this agent\u2019s client keys.');
    process.exit(1);
  }

  const existing = current.allowed_domains || [];
  if (existing.includes(target)) {
    console.log(`Domain already authorized: ${target}`);
    console.log('allowed_domains:', JSON.stringify(existing));
    return;
  }

  const desired = Array.from(new Set([...existing, target]));
  const patchResp = await fetch(`${base}/${encodeURIComponent(clientKey)}`, {
    method: 'PATCH', headers, body: JSON.stringify({ allowed_domains: desired }),
  });
  if (patchResp.status !== 204 && !patchResp.ok) {
    console.error(`PATCH failed: ${patchResp.status} ${patchResp.statusText} ${(await patchResp.text()).slice(0, 200)}`);
    process.exit(1);
  }

  // Verify
  const verifyResp = await fetch(base, { headers });
  const vlist = await verifyResp.json();
  const vkeys = Array.isArray(vlist) ? vlist : (vlist.client_keys || vlist.keys || []);
  const updated = vkeys.find((k) => k.client_key === clientKey);
  const ok = (updated?.allowed_domains || []).includes(target);
  console.log(`Authorized domain on D-ID client key: ${target} -> ${ok ? 'OK' : 'NOT APPLIED'}`);
  console.log('allowed_domains:', JSON.stringify(updated?.allowed_domains || []));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error('did-allow-domain failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
