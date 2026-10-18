import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const omitted = [['C++', 'CHERT_TEST_CPP_CLIENT'], ['Rust', 'CHERT_TEST_RUST_CLIENT']]
  .filter(([, variable]) => !process.env[variable!]).map(([name]) => name).join(', ');
test(`real language transports use the actual authenticated inventory route${omitted ? ` (skipped unconfigured: ${omitted})` : ' (all four languages)'}`,  async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./language-http.fixture.mjs', import.meta.url))], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env,
      NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 45000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const clients = ['javascript', 'python'];
    const skipped: string[] = [];
    for (const [name, variable] of [['cpp', 'CHERT_TEST_CPP_CLIENT'], ['rust', 'CHERT_TEST_RUST_CLIENT']]) {
      if (process.env[variable!]) clients.push(name!); else skipped.push(name!);
    }
    expect(JSON.parse(stdout)).toEqual({ passed: true, cases: 1 + clients.length * 4,
      clients, skipped, writes: 0, deviceRequests: 0, actualAuth: true });
  } finally { clearTimeout(timeout); }
}, 50000);
