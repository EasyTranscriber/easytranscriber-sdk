import { writeFile } from "node:fs/promises";

// This scope makes both .js and .d.ts files CommonJS for Node and TypeScript.
await writeFile(new URL("../dist/cjs/package.json", import.meta.url), '{"type":"commonjs"}\n');
