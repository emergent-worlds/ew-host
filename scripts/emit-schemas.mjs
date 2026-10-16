// Writes the JSON Schemas of manifest.json, interface.json, and contract.json into schemas/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Manifest, EngineInterface, FolderContract, RemoteClientFrame, RemoteServerFrame, BuildList, SignedBuild, SaveInspection } from '../dist/index.js';

mkdirSync('schemas', { recursive: true });
for (const [name, schema] of [['manifest', Manifest], ['interface', EngineInterface], ['save-inspection', SaveInspection], ['contract', FolderContract], ['remote-client-frame', RemoteClientFrame], ['remote-server-frame', RemoteServerFrame], ['build-list', BuildList], ['signed-build', SignedBuild]]) {
  writeFileSync(`schemas/${name}.schema.json`, JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: 'none' }), null, 2) + '\n');
}
console.log('schemas written');
