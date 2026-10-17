'use strict';

function parseArgs(argv) {
  const options = { url: process.env.APP_URL || '', timeoutMs: 10000, help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg.startsWith('--timeout-ms=')) {
      const value = Number(arg.slice('--timeout-ms='.length));
      if (!Number.isInteger(value) || value < 1000 || value > 60000) throw new Error('--timeout-ms must be between 1000 and 60000.');
      options.timeoutMs = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    'Read-only production smoke check',
    '',
    'APP_URL=https://your-app.onrender.com npm run verify:production',
    'npm run verify:production -- --url=https://your-app.onrender.com',
    '',
    'Checks only /api/health and /api/ready. It never logs in, changes data, or calls financial endpoints.'
  ].join('\n'));
}

async function checkEndpoint(baseUrl, endpoint, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { endpoint, httpStatus: response.status, success: Boolean(body?.success), status: body?.status || null, readiness: body?.readiness || null };
  } finally {
    clearTimeout(timer);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return { help: true }; }
  let parsed;
  try { parsed = new URL(String(options.url || '').trim()); } catch { throw new Error('A valid APP_URL or --url is required.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('APP_URL must use http or https.');
  const baseUrl = parsed.toString().replace(/\/$/, '');
  const results = [];
  for (const endpoint of ['/api/health', '/api/ready']) results.push(await checkEndpoint(baseUrl, endpoint, options.timeoutMs));
  console.log(JSON.stringify({ baseUrl, readOnly: true, results }, null, 2));
  if (results.some(result => result.httpStatus < 200 || result.httpStatus >= 300 || !result.success)) {
    throw new Error('Production smoke check failed. Review the endpoint results above.');
  }
  return { baseUrl, results };
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Production smoke check failed: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, checkEndpoint, main };
