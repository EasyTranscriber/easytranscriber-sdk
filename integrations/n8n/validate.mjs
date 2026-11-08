import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { configuration, transcript, summary, metadata } from './fixture-data.mjs';

const root = new URL('./', import.meta.url);
const workflow = JSON.parse(await readFile(new URL('youtube-transcript-summary.json', root), 'utf8'));
const byName = new Map(workflow.nodes.map(node => [node.name, node]));
assert.equal(byName.size, workflow.nodes.length);
assert.equal(new Set(workflow.nodes.map(node => node.id)).size, workflow.nodes.length);
assert.equal(workflow.active, false);
assert.deepEqual(workflow.pinData, {});
for (const [from, connection] of Object.entries(workflow.connections)) {
  assert.ok(byName.has(from));
  for (const output of connection.main) for (const edge of output) {
    assert.ok(byName.has(edge.node));
    assert.equal(edge.type, 'main');
    assert.equal(edge.index, 0);
  }
}
for (const node of workflow.nodes.filter(node => node.type.endsWith('.httpRequest'))) {
  assert.equal(node.typeVersion, 4.4);
  assert.equal(node.retryOnFail, false);
  assert.equal(node.onError, 'stopWorkflow');
  assert.ok(node.parameters.options.timeout >= 300000);
  assert.equal(node.parameters.specifyBody, 'json');
  assert.ok(Object.values(node.credentials).every(credential => credential.id.startsWith('REPLACE_WITH_')));
}
for (const name of ['Get transcript', 'Summarize transcript']) {
  const p = byName.get(name).parameters;
  assert.equal(p.authentication, 'genericCredentialType');
  assert.equal(p.genericAuthType, 'httpHeaderAuth');
  assert.ok(p.url.startsWith('https://www.easytranscriber.com/api/v1/'));
  assert.ok(!p.url.includes('stream=true'));
}

function runCode(name, inputs, previous = {}) {
  return vm.runInNewContext('(function () {\n' + byName.get(name).parameters.jsCode + '\n})()', {
    $input: { first: () => ({ json: inputs[0] }), all: () => inputs.map(json => ({ json })) },
    $: key => ({ first: () => ({ json: previous[key] }) }),
  }, { timeout: 10000 });
}
function expression(value, json) {
  assert.ok(value.startsWith('={{') && value.endsWith('}}'));
  return vm.runInNewContext(value.slice(3, -2), { $json: json, JSON, encodeURIComponent });
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function prepare(destination, t = transcript, s = summary) {
  const c = { ...configuration, destination };
  const validated = runCode('Validate input', [c])[0].json;
  const preserved = runCode('Preserve transcript', [t], { 'Validate input': validated })[0].json;
  assert.deepEqual(JSON.parse(expression(byName.get('Get transcript').parameters.jsonBody, c)), { url: c.video_url });
  assert.deepEqual(JSON.parse(expression(byName.get('Summarize transcript').parameters.jsonBody, preserved)), {
    transcript: t.transcript, video_id: t.video_id, language: c.summary_language,
  });
  return plain(runCode('Prepare destination writes', [s], { 'Preserve transcript': preserved }));
}
export function checkNotion(bodies, expectedMetadata = metadata, expectedTranscript = transcript.transcript, expectedSummary = summary.summary) {
  const recovered = { metadata: '', summary: '', transcript: '' };
  let section;
  for (const body of bodies) {
    assert.equal(body.parent.page_id, configuration.notion_parent_page_id);
    assert.ok(body.children.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 500000);
    for (const block of body.children) {
      const texts = block[block.type].rich_text.map(r => r.text.content);
      for (const text of texts) {
        assert.ok(text.length <= 2000);
        assert.ok(text.isWellFormed());
      }
      if (block.type === 'heading_2') section = texts.join('');
      else { assert.ok(section in recovered); recovered[section] += texts.join(''); }
    }
  }
  assert.deepEqual(JSON.parse(recovered.metadata), expectedMetadata);
  assert.equal(recovered.summary, expectedSummary);
  assert.equal(recovered.transcript, expectedTranscript);
}
export function checkSheets(bodies, expectedMetadata = metadata, expectedTranscript = transcript.transcript, expectedSummary = summary.summary) {
  const recovered = { metadata: [], summary: [], transcript: [] };
  for (const body of bodies) {
    assert.equal(body.majorDimension, 'ROWS');
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 2000000);
    for (const row of body.values) {
      assert.equal(row.length, 6);
      assert.equal(row[0], configuration.run_key);
      assert.equal(row[1], transcript.video_id);
      assert.ok(row[2] in recovered);
      assert.equal(row[3], recovered[row[2]].length + 1);
      for (const cell of row) if (typeof cell === 'string') {
        assert.ok(cell.length <= 40000);
        assert.ok(cell.isWellFormed());
      }
      recovered[row[2]].push(row[5]);
    }
  }
  const rows = bodies.flatMap(body => body.values);
  for (const row of rows) assert.equal(row[4], recovered[row[2]].length);
  assert.deepEqual(JSON.parse(recovered.metadata.join('')), expectedMetadata);
  assert.equal(recovered.summary.join(''), expectedSummary);
  assert.equal(recovered.transcript.join(''), expectedTranscript);
}

// Importing the helpers from mock-server must not run the local validation suite.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notion = prepare('notion');
  const sheets = prepare('sheets');
  assert.ok(notion.length > 1, 'Fixture must exercise multiple Notion pages');
  assert.ok(sheets.length > 1, 'Fixture must exercise multiple Sheets requests');
  checkNotion(notion.map(item => item.json.body));
  checkSheets(sheets.map(item => item.json.body));
  assert.ok(notion.every(item => expression(byName.get('Choose Notion').parameters.conditions.boolean[0].value1, item.json)));
  assert.ok(sheets.every(item => !expression(byName.get('Choose Notion').parameters.conditions.boolean[0].value1, item.json)));
  for (const item of sheets) {
    const url = new URL(expression(byName.get('Append Google Sheets rows').parameters.url, item.json));
    assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
    assert.equal(decodeURIComponent(url.pathname), "/v4/spreadsheets/offline-spreadsheet/values/'Researcher''s notes'!A:F:append");
  }
  assert.throws(() => runCode('Validate input', [{ ...configuration, destination: 'other' }]));
  assert.throws(() => runCode('Validate input', [{ ...configuration, summary_language: 'en' }]));
  assert.throws(() => runCode('Validate input', [{ ...configuration, run_key: '' }]));
  assert.throws(() => runCode('Validate input', [{ ...configuration, video_url: '' }]));
  assert.throws(() => runCode('Validate input', [configuration, configuration]));
  assert.throws(() => runCode('Preserve transcript', [{ error: { code: 'failed' } }]));
  assert.throws(() => prepare('notion', transcript, { error: { code: 'failed' } }));
  for (const destination of ['notion', 'sheets']) {
    const t = { ...transcript, transcript: 'x'.repeat(1599) + '\u{1F642}' + '\u0000'.repeat(220000), video_title: null, cached: true, credits_used: 0 };
    const s = { ...summary, summary: 'short', video_id: null };
    const expected = { ...metadata, video_title: null, cached: true, transcript_credits_used: 0, total_credits_used: 1, summary_video_id: null };
    const items = prepare(destination, t, s);
    (destination === 'notion' ? checkNotion : checkSheets)(items.map(item => item.json.body), expected, t.transcript, s.summary);
  }
  if (process.argv.includes('--fixtures')) {
    const dir = new URL('.smoke/', root);
    await mkdir(dir, { recursive: true });
    for (const destination of ['notion', 'sheets']) {
      const fixture = structuredClone(workflow);
      fixture.id = destination === 'notion' ? 'etOfflineNotion01' : 'etOfflineSheets01';
      fixture.name = 'OFFLINE ONLY - ' + destination + ' - EasyTranscriber fixture';
      fixture.nodes.find(n => n.name === 'Configure input').parameters.jsCode = 'return [{ json: ' + JSON.stringify({ ...configuration, destination }) + ' }];';
      for (const node of fixture.nodes.filter(n => n.type.endsWith('.httpRequest'))) {
        delete node.credentials;
        node.parameters.authentication = 'none';
        delete node.parameters.genericAuthType;
        delete node.parameters.nodeCredentialType;
        const paths = { 'Get transcript': '/transcribe', 'Summarize transcript': '/summarize', 'Create Notion pages': '/notion' };
        node.parameters.url = node.name === 'Append Google Sheets rows'
          ? "={{ 'http://127.0.0.1:15679/sheets?valueInputOption=RAW&insertDataOption=INSERT_ROWS' }}"
          : 'http://127.0.0.1:15679' + paths[node.name];
      }
      await writeFile(new URL(destination + '.json', dir), JSON.stringify(fixture, null, 2) + '\n');
    }
    console.log('Generated .smoke/notion.json and .smoke/sheets.json (localhost only, no credentials).');
  }
  console.log('Workflow structure, expressions, payload boundaries, Unicode, failures, and exact reconstruction passed.');
}
