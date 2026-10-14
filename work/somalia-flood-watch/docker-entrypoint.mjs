// Container entrypoint. Starts as root only long enough to make the report
// storage writable by the unprivileged node user, then drops to that user and
// starts the server. Hosts that mount a blank volume (Bunny Magic Containers,
// Kubernetes) often hand it over owned by root, which otherwise leaves every
// community write failing with 503.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const NODE_UID = 1000, NODE_GID = 1000;
const dataDir = process.env.COMMUNITY_DATA_DIR || '/app/data';

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  try {
    fs.mkdirSync(dataDir, {recursive: true});
    const stat = fs.statSync(dataDir);
    if (stat.uid !== NODE_UID || stat.gid !== NODE_GID) {
      fs.chownSync(dataDir, NODE_UID, NODE_GID);
      console.log(`Report storage ${dataDir} handed to the node user.`);
    }
  } catch (error) {
    console.error(`Could not prepare report storage ${dataDir}: ${error.message}`);
  }
  process.setgroups([NODE_GID]);
  process.setgid(NODE_GID);
  process.setuid(NODE_UID);
}

// server.mjs listens only when it is the script node was started with, so
// present it as that script; its own PORT/HOST checks then run unchanged.
process.argv[1] = fileURLToPath(new URL('./server.mjs', import.meta.url));
await import('./server.mjs');
