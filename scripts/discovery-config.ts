/**
 * Prints the `spacetime call` commands that load the module's C8 allowlists from the same config the app
 * coarsens and validates against (src/lib/discovery/config.ts). Prints only; never calls anything.
 * Usage: node scripts/discovery-config.ts [database] [--enable]
 */
import { AREA_KEYS, DISCOVERY_TAGS, launchConfigValid } from '../src/lib/discovery/config.ts';

if (!launchConfigValid()) {
  console.error('discovery config fails the module slug rules; fix src/lib/discovery/config.ts');
  process.exit(1);
}
const db = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dor';
const call = (key: string, values: readonly string[]) =>
  `spacetime call ${db} set_discovery_config '${JSON.stringify(key)}' '${JSON.stringify(values)}'`;
console.log(call('areas', AREA_KEYS));
console.log(call('tags', DISCOVERY_TAGS));
if (process.argv.includes('--enable')) console.log(call('enabled', ['true']));
