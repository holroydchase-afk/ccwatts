// Copies the built CLI (packages/cli/dist/index.js, core and dashboard bundled in) into the
// Claude Code plugin. An installed plugin is copied out of the repo, so it can't reach
// packages/, and the bundle is committed. CI fails if it is out of date.
import { chmodSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
const to = fileURLToPath(new URL("../plugins/ccwatts/bin/ccwatts.js", import.meta.url));
copyFileSync(from, to);
chmodSync(to, 0o755);
console.log("Wrote plugins/ccwatts/bin/ccwatts.js");
