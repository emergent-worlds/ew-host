import { z } from 'zod';
/** The calls an engine answers (the engines matrix, Section 2.2). Pause and resume are the host's, not the engine's. */
export const EngineCall = z.enum(['load', 'save', 'advance', 'input', 'read', 'query', 'explain', 'forecast', 'change']);
export type EngineCall = z.infer<typeof EngineCall>;

