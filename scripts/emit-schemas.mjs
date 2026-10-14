// Writes the JSON Schemas of manifest.json, interface.json, and contract.json into schemas/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Manifest, EngineInterface, FolderContract } from '../dist/index.js';

mkdirSync('schemas', { recursive: true });
for (const [name, schema] of [['manifest', Manifest], ['interface', EngineInterface], ['contract', FolderContract]]) {
  writeFileSync(`schemas/${name}.schema.json`, JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: 'none' }), null, 2) + '\n');
}
console.log('schemas written');
