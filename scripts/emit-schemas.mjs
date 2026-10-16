// Writes the JSON Schemas of manifest.json, interface.json, and contract.json into schemas/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Manifest, EngineInterface, FolderContract, RemoteClientFrame, RemoteServerFrame, BuildList, SignedBuild, SaveInspection, StudioValidationResult, StudioRenderDeclaration, StudioScenarioResult, StudioScenarioSuite, StudioSamplingDeclaration, StudioSamplingCorpus } from '../dist/index.js';

mkdirSync('schemas', { recursive: true });
for (const [name, schema] of [['manifest', Manifest], ['interface', EngineInterface], ['save-inspection', SaveInspection], ['studio-validation', StudioValidationResult], ['studio-render', StudioRenderDeclaration], ['studio-scenario', StudioScenarioResult], ['studio-scenario-suite', StudioScenarioSuite], ['studio-sampling', StudioSamplingDeclaration], ['studio-sampling-corpus', StudioSamplingCorpus], ['contract', FolderContract], ['remote-client-frame', RemoteClientFrame], ['remote-server-frame', RemoteServerFrame], ['build-list', BuildList], ['signed-build', SignedBuild]]) {
  writeFileSync(`schemas/${name}.schema.json`, JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: 'none' }), null, 2) + '\n');
}
console.log('schemas written');
