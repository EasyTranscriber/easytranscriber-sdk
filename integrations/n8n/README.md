# YouTube video → transcript + summary → Notion / Google Sheets

Import [`youtube-transcript-summary.json`](./youtube-transcript-summary.json) into n8n. This manual workflow calls the real EasyTranscriber REST API, then writes the complete transcript, JSON-response summary, and metadata to **one selected destination**. It is inactive by default; no credentials, accounts, packages, or integrations have been provisioned for you.

**Target runtime:** n8n **2.32.5**, using bundled Manual Trigger v1, Code v2, If v1, and HTTP Request v4.4 nodes. Node contracts were checked against official documentation and the 2.32.5 source tag. Run the validation below on your instance before using real credentials; source-level checks alone do not establish runtime compatibility.

## Import and configure

1. In n8n, create a workflow and choose the workflow menu's **Import from File**. Select `youtube-transcript-summary.json`.
2. Create a **Header Auth** credential named `EasyTranscriber Authorization`. Set **Name** to `Authorization` and **Value** to `Bearer et_xxx`, replacing `et_xxx` with your existing EasyTranscriber API key. Select that credential in both **Get transcript** and **Summarize transcript**. The JSON contains unresolved credential references, not usable secrets.
3. Configure the selected destination as described below. Credentials belong in n8n's credential store, never in Code nodes, request headers typed directly into the workflow, exported JSON, screenshots, or browser-side JavaScript.
4. Open **Configure input** and edit its non-secret values:
   - `video_url`: an HTTPS YouTube video URL; blank deliberately prevents accidental paid requests.
   - `summary_language`: an exact display name, such as `English`, `Spanish`, or `Japanese`; `Auto` matches source content. The API supports 65 named summary languages. Do **not** use `en`/`es`; the server otherwise silently ignores unsupported values. The workflow validates the supported names before any request.
   - `destination`: `notion` or `sheets`, not both.
   - `run_key`: your own stable, unique label for this intentional export, 1–80 letters, digits, underscores, or hyphens. Search the destination for this label **before running**. It is a reconciliation key, not an idempotency guarantee.
   - Set the destination ID(s) below; fields for the unused destination may remain blank.
5. Keep **Retry On Fail disabled** and **On Error → Stop Workflow** on all HTTP nodes. Each request has a 360,000 ms timeout, allowing the API's 300-second maximum. Ensure the n8n instance/workflow execution timeout permits at least both API calls plus destination writes; large exports need additional time.
6. Execute the workflow manually once. Inspect **Preserve transcript**, **Prepare destination writes**, and the selected write node's results. Only one video is supported per execution. Do not replace the input with multiple items without redesigning the explicitly single-item references.

The HTTP sequence is `POST https://www.easytranscriber.com/api/v1/transcribe` with `{url}`, followed by `POST https://www.easytranscriber.com/api/v1/summarize` with `{transcript, video_id, language}`. Summary uses default **non-streaming JSON**, with no `stream=true` query. Successful responses are plain JSON, **not** a `data` envelope. The workflow keeps transcript data before the summary HTTP node replaces the current item, using the named **Preserve transcript** output when preparing writes.

## Notion destination

- Use an existing Notion internal integration/connection with **Insert content** capability and access to a normal parent **page**. In Notion, add that connection to the parent page. No database or data-source schema is required.
- Create a second **Header Auth** credential named `Notion Authorization`, with Name `Authorization` and Value `Bearer <your-existing-Notion-token>`. Select it in **Create Notion pages**. Do not reuse the EasyTranscriber credential.
- Set `notion_parent_page_id` to the page's 32-character or hyphenated UUID, not its full URL, a database ID, or a data-source ID.
- The workflow sends `POST https://api.notion.com/v1/pages` with `Notion-Version: 2022-06-28`, a `page_id` parent, a title, and paragraph/heading children. The pinned version intentionally uses the plain parent-page contract, independent of newer data-source APIs.

A long result creates **multiple sibling pages**, titled `run_key | video_id | part N/total`. In page order, their blocks contain `metadata`, `summary`, then `transcript`. Continuation pages can start with a paragraph continuing the previous page's section. Text is stored literally, including summary Markdown, rather than translated into formatting that could lose content.

Each text chunk is at most **1,600 UTF-16 units** (below Notion's 2,000-character limit), with surrogate pairs kept together. Each page has at most **80 children** (below 100). Serialized children are additionally bounded so the complete request remains below Notion's 500 KB payload limit even for Unicode or heavily escaped text. No text is truncated. Writes are sent one at a time with a one-second interval. Workspace capacity or rate limits can still reject a write; see partial-failure recovery below.

## Google Sheets destination

- Use an existing spreadsheet and a dedicated, otherwise empty tab. Give the connected Google account edit access. Set `sheets_spreadsheet_id` to the ID between `/d/` and `/edit` in its URL and `sheets_tab` to the exact tab name.
- Add these six column headers to **A1:F1**, in this exact order:

  ```text
  run_key | video_id | section | chunk_index | chunk_count | text
  ```

- Select a **Google Sheets OAuth2 API** credential in **Append Google Sheets rows**. Follow n8n's OAuth setup, enabling Google Sheets API (and Google Drive API when using its standard Google credential setup). No API key is used for Google.
- This direct values-append call only needs `https://www.googleapis.com/auth/spreadsheets`. n8n 2.32.5's default Sheets credential additionally requests `drive.file` and `drive.metadata`; its Custom Scopes setting can narrow this HTTP-only workflow to the spreadsheets scope. Authenticate again after changing scopes. Organization OAuth policies can require administrator approval.

Each section (`metadata`, `summary`, `transcript`) spans as many rows as needed. `metadata` is JSON containing the full original video title, URL, video ID, transcription method, cache flag, both credit charges, their total, returned summary video ID (possibly null), selected language, and run key. Keeping metadata in chunked text rows avoids overflowing a separate title/metadata cell.

Text cells contain at most **40,000 UTF-16 units**, conservatively below the 50,000-character boundary. Unicode surrogate pairs remain intact. Requests are batched below 2 MB; very long content can require multiple appends. The A1 tab name is quoted/escaped and URL-encoded. `valueInputOption=RAW` preserves text that starts with `=`, `+`, or other formula-looking content without evaluating it. There is no silent clipping.

To reconstruct a section, filter by `run_key` and `section`, sort numerically by `chunk_index`, confirm indexes `1…chunk_count` appear exactly once, and concatenate `text` **without inserting separators**. Decode the concatenated metadata section as JSON. Keep each tab as a single contiguous table: blank separator rows or unrelated tables can change the Sheets append API's table detection.

## Costs, language, failures, and repeat runs

- A new transcript costs **1 API credit**, or **2 for videos longer than two hours**; the maximum supported duration is four hours. Cached transcripts cost **0**. Use the returned `credits_used` rather than predicting the charge.
- **Every REST summary costs 1 additional API credit**, including a new summary of a cached transcript. REST transcription does not include a summary. A usual new-video workflow therefore uses 2 credits (3 for a long video), or 1 when transcription is cached. Destination vendor charges/quotas are separate.
- Summary language does not translate the transcript. Captions retain their source language; videos without captions can use speech-to-text. Speech-to-text transcripts do not have timestamps.
- Errors use `{error: {code, message}}`. A 400 means fix the input; 401 means check credentials; 402 means insufficient balance. For 429, wait for the indicated rate-limit window before manually retrying the failed API node. Auth rate limiting happens before credit deduction, making an API 429 safe to retry. This template intentionally implements **no automatic retry**, including on 429.
- Never blindly retry a timeout, network failure, or 5xx: the API request may already have spent credits, or a destination write may already have committed. Inspect the service/account history and destination before deciding what to do. Do not turn on n8n's generic retry policy for credit-charging requests.
- Re-running the entire workflow generates another separately billed summary and can create duplicate pages/rows. `run_key` helps you find duplicates but does not prevent them automatically. Serialize executions; do not launch concurrent exports with the same key.
- Before the initial run, search Notion titles or Sheets column A for `run_key`. For an intentional new export, use a new key. For a retry, keep the original key so you can reconcile existing writes.
- If a destination fails partway, **do not restart from the trigger**. Retain/export the successful **Prepare destination writes** output from the execution; it includes every request body and `part`/`parts`. First inspect the remote destination for every expected page part or section/chunk index, including the failed request (a lost response does not prove the write failed). Remove confirmed duplicates if present. In a temporary copy, pin only the confirmed missing prepared items on **Prepare destination writes**, disconnect the upstream API chain, then run only the selected destination branch. For a partially observed Sheets append, inspect individual rows and reconcile the batch before replaying it. Do not rerun an already-successful batch.
- Manual data pinning is for recovery/testing only and can expose transcript content. Remove pinned data before sharing. Configure execution retention deliberately: transcripts and summaries appear in n8n execution data, including failure records. Never share raw execution exports without reviewing sensitive content.

## Local validation without spending credits

Requires Node.js with `String.prototype.isWellFormed()` (Node 22+ recommended) and, for the engine smoke, n8n 2.32.5. The scripts have no npm dependencies. Run from the repository root:

```sh
node integrations/n8n/validate.mjs --fixtures
```

This validates workflow wiring, Code-node execution and expressions, JSON request fields, invalid-input/error handling, nullable metadata, cached credits, Unicode boundaries, escaped control characters, multi-page/multi-request payload limits, and exact text reconstruction. It emits two derived, credential-free workflows under ignored `integrations/n8n/.smoke/`; **only these fixtures** redirect all HTTP nodes to localhost. The distributable workflow still uses real production APIs. This validator is not an n8n-engine substitute.

Start the mock server in another terminal:

```sh
node integrations/n8n/mock-server.mjs
```

Then run the actual n8n engine in an isolated user folder. These commands execute only the local fixtures, never touch your normal n8n database, and never need credentials. The original workflow is imported/exported but **never executed**:

```sh
export N8N_USER_FOLDER="$PWD/integrations/n8n/.smoke/n8n"
export N8N_DIAGNOSTICS_ENABLED=false
export N8N_VERSION_NOTIFICATIONS_ENABLED=false
n8n import:workflow --input=integrations/n8n/.smoke/notion.json
n8n import:workflow --input=integrations/n8n/.smoke/sheets.json
n8n execute --id=etOfflineNotion01
n8n execute --id=etOfflineSheets01
curl --fail http://127.0.0.1:15679/verify
n8n export:workflow --id=etOfflineNotion01 --output=integrations/n8n/.smoke/notion-exported.json
n8n export:workflow --id=etOfflineSheets01 --output=integrations/n8n/.smoke/sheets-exported.json
n8n import:workflow --input=integrations/n8n/youtube-transcript-summary.json
n8n export:workflow --id=etYouTubeSummary01 --output=integrations/n8n/.smoke/original-exported.json
```

If `n8n` is not on PATH, replace each invocation with `npm exec --yes --package=n8n@2.32.5 -- n8n …` using a Node version supported by n8n. This downloads the runtime but does not make EasyTranscriber or destination calls. Run the server and engine on the same host; containerized n8n cannot reach a host server via its own `127.0.0.1` without an explicit local networking arrangement. Hosted n8n cannot use these localhost fixtures as-is.

`/verify` must return HTTP 200 with `ok: true`, exactly two transcript requests and two summary requests, and complete reconstructed data for both destinations. Restart the mock server to clear its state before repeating the pair of smoke runs. Its port is 15679, avoiding n8n's default task-broker port 5679. Engine exports must retain the node/connection structure; **do not replace the distributable workflow with a localhost fixture export**.

For a failure smoke, in a generated fixture add `?status=429` or `?status=500` to **Summarize transcript**'s localhost URL, re-import it, and execute once. The summary node must fail, with no automatic retries or destination writes for that execution. Keep these changes inside `.smoke/`. The ordinary `/verify` check expects two successful runs, so use a fresh mock server afterward. Stop the mock server when finished.

Verified on n8n 2.32.5: both fixture branches executed successfully, complete text/metadata reconstructed across five Notion page payloads and two Sheets requests, and the original workflow imported/exported without changing nodes, connections, or credential selectors. A browser UI check and authenticated Notion/Sheets writes were not performed. Before production use, inspect the original workflow in the editor, select your own credentials, and authorize a small live run with your own credit and destination accounts.

## Contract sources

Official n8n docs were queried through Context7; source links pin node details where documentation is conceptual:

- [Import/export workflows](https://docs.n8n.io/workflows/export-import/) and [server CLI import, execute, export](https://docs.n8n.io/hosting/cli-commands/).
- [HTTP Request node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/), [Header Auth credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/), [Code node](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.code/), and [request batching/rate limits](https://docs.n8n.io/integrations/builtin/rate-limits/).
- n8n 2.32.5 source: [HTTP node version mapping](https://github.com/n8n-io/n8n/blob/n8n%402.32.5/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts), [request parameters](https://github.com/n8n-io/n8n/blob/n8n%402.32.5/packages/nodes-base/nodes/HttpRequest/V3/Description.ts), [If v1 conditions](https://github.com/n8n-io/n8n/blob/n8n%402.32.5/packages/nodes-base/nodes/If/V1/IfV1.node.ts), and [Google Sheets OAuth scopes](https://github.com/n8n-io/n8n/blob/n8n%402.32.5/packages/nodes-base/credentials/GoogleSheetsOAuth2Api.credentials.ts).
- [Google OAuth setup in n8n](https://docs.n8n.io/integrations/builtin/credentials/google/oauth-single-service/), [Sheets values append and scopes](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append), and [Google's spreadsheet/cell-size guidance](https://support.google.com/drive/answer/37603?hl=en).
- [Notion create page/parent schema and Insert content capability](https://developers.notion.com/reference/post-page), [Notion request/text/block limits](https://developers.notion.com/reference/request-limits).
- EasyTranscriber [REST API documentation](https://www.easytranscriber.com/docs/api) and [API overview](https://www.easytranscriber.com/api).

REST summaries are separate billed requests, not included in transcription. This workflow intentionally does not include a Make blueprint, automatic pagination, scheduling, automatic deduplication, or live-service credentials.
