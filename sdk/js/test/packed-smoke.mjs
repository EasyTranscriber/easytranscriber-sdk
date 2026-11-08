import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), "easytranscriber-package-"));
let server;
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], { cwd: packageRoot, encoding: "utf8" }));
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", join(temporary, packed[0].filename)], { cwd: consumer, stdio: "pipe" });

  const observed = [];
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    observed.push({ path: request.url, method: request.method, authorization: request.headers.authorization, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/v1/credits") {
      response.end(JSON.stringify({ balance: 5 }));
    } else if (request.url === "/api/v1/transcribe") {
      response.end(JSON.stringify({ video_id: "abc12345678", video_title: null, transcript: "Some words", method: "innertube", cached: true, credits_used: 0 }));
    } else if (request.url === "/api/v1/summarize") {
      response.end(JSON.stringify({ summary: "Summary", video_id: null, credits_used: 1 }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
  const consumerCode = `
const client = new EasyTranscriber({ apiKey: "et_loopback_only", baseUrl: ${JSON.stringify(baseUrl)} });
assert.deepEqual(await client.credits(), { balance: 5 });
assert.equal((await client.transcribe({ url: "https://youtu.be/abc12345678" })).credits_used, 0);
assert.equal((await client.summarize({ transcript: "Some words" })).credits_used, 1);
`;
  await writeFile(join(consumer, "esm.mjs"), `import assert from "node:assert/strict";\nimport { EasyTranscriber } from "easytranscriber";\n${consumerCode}`);
  await writeFile(join(consumer, "commonjs.cjs"), `const assert = require("node:assert/strict");\nconst { EasyTranscriber } = require("easytranscriber");\n(async () => { ${consumerCode} })().catch((error) => { console.error(error); process.exitCode = 1; });`);

  // Child processes must be asynchronous so the loopback server can respond.
  const { spawn } = await import("node:child_process");
  for (const entry of ["esm.mjs", "commonjs.cjs"]) {
    const child = spawn(process.execPath, [join(consumer, entry)], { cwd: consumer, stdio: "inherit" });
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${entry} failed`);
  }
  assert.equal(observed.length, 6);
  for (const request of observed) {
    assert.equal(request.authorization, "Bearer et_loopback_only");
    if (request.path === "/api/v1/transcribe") {
      assert.equal(request.method, "POST");
      assert.deepEqual(JSON.parse(request.body), { url: "https://youtu.be/abc12345678" });
    }
    if (request.path === "/api/v1/summarize") assert.deepEqual(JSON.parse(request.body), { transcript: "Some words" });
  }

  const typedBody = `
const client = new EasyTranscriber({ apiKey: "et_typecheck_only" });
const balance: Promise<{ balance: number }> = client.credits();
const summary: Promise<SummarizeResponse> = client.summarize({ transcript: "text" });
const channel: Promise<ResolveChannelResponse> = client.resolveChannel({ channel: "@example" });
void [balance, summary, channel];
`;
  const imports = 'import { EasyTranscriber, type SummarizeResponse, type ResolveChannelResponse } from "easytranscriber";\n';
  await writeFile(join(consumer, "types.mts"), imports + typedBody);
  await writeFile(join(consumer, "types.cts"), imports + typedBody);
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "types.mts", "types.cts"], { cwd: consumer, stdio: "inherit" });
  console.log("Packed ESM, CommonJS, declaration exports, and loopback requests passed.");
} finally {
  if (server?.listening) {
    server.closeAllConnections();
    const { promise, resolve, reject } = Promise.withResolvers();
    server.close((error) => error ? reject(error) : resolve());
    await promise;
  }
  await rm(temporary, { recursive: true, force: true });
}
