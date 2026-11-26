// The notebook's bookkeeping tables of the old-file copies (due-copy.mjs, world-copy.mjs): one list,
// so the importer, the assistant's write fence and the query tables cannot disagree about them.
export const DUE_COPY_TYPE = 'due_copies';
export const WORLD_COPY_TYPE = 'world_copies';
export const COPY_TYPES = [DUE_COPY_TYPE, WORLD_COPY_TYPE];
