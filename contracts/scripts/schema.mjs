import { writeFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import * as shapes from '../dist/index.js';
const targets = {
  'approved-signal': 'ApprovedSignalSchema', 'relationship-preset': 'RelationshipPresetSchema',
  'recipient-preset-assignment': 'RecipientPresetAssignmentSchema',
  'local-connection-profile': 'LocalConnectionProfileSchema', 'agent-ack': 'AgentAckSchema',
  'nudge': 'NudgeSchema', 'disclosure-receipt': 'DisclosureReceiptSchema',
  'private-reflection': 'PrivateReflectionSchema', 'voice-session': 'VoiceSessionSchema',
  'recipient-support-preferences': 'RecipientSupportPreferencesSchema',
  'coordination-job': 'CoordinationJobSchema', 'coordination-outcome': 'CoordinationOutcomeSchema',
  // PROPOSED (D033): C8 introduction step, not runtime-enabled.
  'introduction-shortlist': 'IntroductionShortlistSchema', 'introduction-proposal': 'IntroductionProposalSchema',
  'introduction-outcome': 'IntroductionOutcomeSchema',
};
for (const [file, symbol] of Object.entries(targets)) {
  const schema = z.toJSONSchema(shapes[symbol]);
  // Zod refinements are runtime-only unless explicitly represented in JSON Schema.
  if (file === 'approved-signal') schema.anyOf = [
    { required: ['supportMode'] }, { required: ['availability'] },
  ];
  const result = JSON.stringify(schema, null, 2) + '\n';
  const url = new URL(`../schema/${file}.schema.json`, import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(url, 'utf8') !== result) throw new Error(`Stale ${file} schema; run npm run contracts:schema`);
  } else await writeFile(url, result);
}
const count = Object.keys(targets).length;
console.log(process.argv.includes('--check') ? 'Generated schemas are current.' : `Generated ${count} shared schemas.`);
