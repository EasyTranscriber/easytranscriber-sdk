# EasyTranscriber SDK

[![CI](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/EasyTranscriber/easytranscriber-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PyPI version](https://img.shields.io/pypi/v/easytranscriber-sdk.svg)](https://pypi.org/project/easytranscriber-sdk/)

Python and JavaScript/TypeScript REST clients for EasyTranscriber, plus an optional sanitized n8n workflow for transcription and summarization.

- [Python SDK](sdk/python/README.md): Python 3.10+, synchronous and asynchronous clients; distribution `easytranscriber-sdk`, import `easytranscriber_sdk`.
- [JavaScript / TypeScript SDK](sdk/js/README.md): Node.js 22+, server-side ESM and CommonJS; package `easytranscriber`.
- [n8n workflow](integrations/n8n/README.md): optional importable example, setup instructions, and local fixtures. Configure credentials privately in your own n8n instance.

Both SDKs are version 0.1.0. See the [API](https://www.easytranscriber.com/api) and [REST documentation](https://www.easytranscriber.com/docs/api) for service details.

## Install Python from PyPI

```sh
pip install easytranscriber-sdk
```

The Python package is available on [PyPI](https://pypi.org/project/easytranscriber-sdk/).
The Python package named `easytranscriber` is unrelated; use `easytranscriber-sdk`.

## Local checkout: Python development and JavaScript installation

Python users can install from source as an alternative for development.
JavaScript / TypeScript installation uses a local checkout and tarball until an npm release:

```sh
git clone https://github.com/EasyTranscriber/easytranscriber-sdk.git
cd easytranscriber-sdk
```

Alternatively, use an existing local checkout. From the repository root, install Python in a virtual environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install ./sdk/python
```

For JavaScript / TypeScript, build and pack the client:

```sh
cd sdk/js
npm ci
npm pack
```

`npm pack` builds the package; it does not publish it. From your server application's directory, install the generated tarball, replacing the path with your checkout's actual location:

```sh
npm install /absolute/path/to/easytranscriber-sdk/sdk/js/easytranscriber-0.1.0.tgz
```

## Quickstarts

Configure `EASYTRANSCRIBER_API_KEY` in your process environment or server secret manager using an API key from your EasyTranscriber account. Never commit a real key, put it in browser code, or log it. These examples make live API requests and may spend credits; they are not test commands.

### Python

```python
import os
from easytranscriber_sdk import EasyTranscriber
with EasyTranscriber(os.environ["EASYTRANSCRIBER_API_KEY"]) as client:
    result = client.transcribe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    print(result["transcript"])
```

### JavaScript / TypeScript

Run as server-side ESM, for example in an `.mjs` file:

```js
import { EasyTranscriber } from "easytranscriber";

const apiKey = process.env.EASYTRANSCRIBER_API_KEY;
if (!apiKey) throw new Error("Configure EASYTRANSCRIBER_API_KEY on the server");

const client = new EasyTranscriber({ apiKey });
const result = await client.transcribe({
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
});
console.log(result.transcript);
```

REST `/transcribe` does **not** include a summary. Every `/summarize` request costs **1 additional credit**, even when the transcript was cached. Both SDK READMEs include separate summary examples, response types, error handling, and pagination details.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and checks, and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Development checks use fixtures and local loopback servers, not production credentials or API calls. Package publication is a separate, explicit action.

## License and affiliation

[MIT License](LICENSE). Copyright (c) 2026 EasyTranscriber.

EasyTranscriber is not affiliated with or endorsed by YouTube or Google.
