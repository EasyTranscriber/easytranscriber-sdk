import assert from 'node:assert/strict';
import http from 'node:http';
import { configuration, transcript, summary } from './fixture-data.mjs';
import { checkNotion, checkSheets } from './validate.mjs';

const state = { transcribe: 0, summarize: 0, notion: [], sheets: [], errors: [] };
const server = http.createServer(async (request, response) => {
  function send(status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
  }
  try {
    const url = new URL(request.url, 'http://127.0.0.1:15679');
    if (request.method === 'GET' && url.pathname === '/verify') {
      assert.deepEqual(state.errors, []);
      assert.equal(state.transcribe, 2, 'Execute exactly one fixture per destination');
      assert.equal(state.summarize, 2);
      checkNotion(state.notion);
      checkSheets(state.sheets);
      send(200, { ok: true, transcript_requests: state.transcribe, summary_requests: state.summarize,
        notion_pages: state.notion.length, sheets_requests: state.sheets.length,
        message: 'Both actual-engine branches preserved the complete fixture text and metadata.' });
      return;
    }
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, undefined, 'Offline fixture must not send credentials');
    request.setEncoding('utf8');
    let text = '';
    for await (const chunk of request) {
      text += chunk.toString();
      assert.ok(text.length < 5000000, 'Unexpected fixture payload size');
    }
    const body = JSON.parse(text);
    // Optional failure-path smoke: add ?status=429 (or 500) to an API fixture node URL.
    if (url.searchParams.has('status')) {
      const status = Number(url.searchParams.get('status'));
      assert.ok([400, 401, 402, 429, 500].includes(status));
      send(status, { error: { code: 'fixture_failure', message: 'Deliberate local failure; no credit used.' } });
      return;
    }
    switch (url.pathname) {
      case '/transcribe':
        assert.deepEqual(body, { url: configuration.video_url });
        state.transcribe++;
        send(200, transcript);
        break;
      case '/summarize':
        assert.deepEqual(body, { transcript: transcript.transcript, video_id: transcript.video_id, language: configuration.summary_language });
        state.summarize++;
        send(200, summary);
        break;
      case '/notion':
        assert.equal(request.headers['notion-version'], '2022-06-28');
        assert.ok(body.children.length <= 100);
        assert.ok(Buffer.byteLength(text) < 500000);
        state.notion.push(body);
        send(200, { object: 'page', id: 'offline-page-' + state.notion.length });
        break;
      case '/sheets':
        assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
        assert.equal(url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
        state.sheets.push(body);
        send(200, { spreadsheetId: configuration.sheets_spreadsheet_id,
          updates: { updatedRows: body.values.length, updatedColumns: 6, updatedCells: body.values.length * 6 } });
        break;
      default:
        throw new Error('Unexpected mock request path');
    }
  } catch (error) {
    state.errors.push(error.message);
    send(500, { error: { code: 'fixture_assertion', message: error.message } });
  }
});
server.listen(15679, '127.0.0.1', () => console.log('Offline n8n fixture server listening on http://127.0.0.1:15679'));
