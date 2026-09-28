// Barrel for the pure map core. Import from here, not from the individual files, so a later file
// split does not ripple through the editor and the analysers.
//
// The re-exports below are COMMENTED OUT until their owner lands the file. That is not caution, it
// is the wave rule: a bare `export * from './compile.js'` against a file that does not exist yet
// makes this module — and therefore every module that imports it — a hard failure, and wave 0 must
// leave the tree runnable at every single moment. Each wave-1/2 worker uncomments exactly their own
// line as part of their own commit; nobody edits anybody else's.
export * from './schema.js';
// export * from './propspec.js';   // W1-A
// export * from './normalize.js';  // W1-A
// export * from './serialize.js';  // W1-A
// export * from './graph.js';      // W1-B
// export * from './compile.js';    // W1-B
// export * from './legacy.js';     // W1-B
// export * from './validate.js';   // W2-A
