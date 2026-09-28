// Entry router. The capture harness, the editor's playtest and every probe open the game with a query string
// (?mode=, ?map=, ?scenario=, ?battle=1, ?auto=, ?seed=, ...): any key other than ?screen= boots straight into the
// battle exactly as before (src/core/battleboot.js is the former body of this file; window.__GAME__ and its
// `ready` gate are published there unchanged). A bare URL, or ?screen=<title|map|results|...>, opens the campaign
// shell: title, world map, story, formation and results screens (src/campaign/shell.js), which carry no three.js.
const q = new URLSearchParams(location.search);
// Keys the campaign shell itself reads (shell.js): screen, and node (Formation's destination, so a reload returns to it).
const SHELL_KEYS = new Set(['screen', 'node']);
const shell = [...q.keys()].every((k) => SHELL_KEYS.has(k)) && (!q.has('node') || q.has('screen'));
if (shell) await import('./campaign/shell.js');
else await import('./core/battleboot.js');
