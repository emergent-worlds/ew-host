import { expect, it } from 'vitest';
import { EngineInterface, SaveInspection, SaveInspectionDeclaration } from '../src/interface.js';
it('declares an optional engine module with exact unique input paths', () => {
  expect(EngineInterface.parse({ calls: ['load'] }).saveInspection).toBeUndefined();
  expect(EngineInterface.parse({ calls: ['load'], saveInspection: { module: 'dist/save-inspection.js', files: ['state/engine.json'] } }).saveInspection?.files).toEqual(['state/engine.json']);
  for (const path of ['/header', '../header', 'state/../header', 'state//header', 'state/./header', 'state\\header', 'https:header', 'state/%2e/header', 'header?x', 'header#x']) expect(SaveInspectionDeclaration.safeParse({ module: path, files: [path] }).success).toBe(false);
  expect(SaveInspectionDeclaration.safeParse({ module: 'inspect.js', files: ['header', 'header'] }).success).toBe(false);
});
it('validates semantic inspection statuses without trusting unknown fields or incompatible formats', () => {
  for (const value of [{ status: 'empty', savedFormat: null, currentFormat: 2 }, { status: 'ready', savedFormat: 2, currentFormat: 2 }, { status: 'update', savedFormat: 1, currentFormat: 2 }, { status: 'refused', savedFormat: 3, currentFormat: 2, reason: 'Future format' }]) expect(SaveInspection.safeParse(value).success).toBe(true);
  for (const value of [{ status: 'empty', savedFormat: 1, currentFormat: 2 }, { status: 'ready', savedFormat: 1, currentFormat: 2 }, { status: 'update', savedFormat: null, currentFormat: 2 }, { status: 'update', savedFormat: 2, currentFormat: 2 }, { status: 'ready', savedFormat: 2, currentFormat: 2, host: true }, { status: 'refused', savedFormat: -1, currentFormat: 2 }, { status: 'refused', savedFormat: null, currentFormat: Number.MAX_SAFE_INTEGER + 1 }, { status: 'refused', savedFormat: null, currentFormat: 2, reason: 'x'.repeat(501) }]) expect(SaveInspection.safeParse(value).success).toBe(false);
});
