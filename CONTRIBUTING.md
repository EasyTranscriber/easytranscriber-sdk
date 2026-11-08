# Contributing

Keep changes focused, update relevant examples and tests, and describe the behavior changed and checks performed in your pull request. For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Python

Requires Python 3.10+. Starting at the repository root:

```sh
cd sdk/python
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
python -m mypy
python -m ruff check .
python -m pytest
python -m build
python -m twine check dist/*
```

The tests use fixtures, mocked HTTP responses, and a local loopback server. See the [Python README](sdk/python/README.md) for the optional built-wheel smoke check.

## JavaScript / TypeScript

Requires Node.js 22+. Starting at the repository root in a separate shell:

```sh
cd sdk/js
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run test:package
```

Build before running tests. The package check installs a locally packed tarball in a temporary consumer and checks ESM, CommonJS, and TypeScript declarations using local loopback HTTP.

## Safe development

- Keep tests fixture-based or on local loopback only. Do not call the production API for development checks or spend real credits.
- Never use real API keys in tests or commit credentials, authorization headers, personal data, or unsanitized workflow exports.
- The optional [n8n integration](integrations/n8n/README.md) documents its local fixture setup; keep shared exports credential-free.
- Building, packing, and checking packages must not automatically publish them. Publication requires a separate explicit maintainer action; do not add automatic publication to contribution checks.
