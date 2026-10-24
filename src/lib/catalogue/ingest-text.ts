/** Browser-safe text checks shared by ingestion and the Events page. */

/**
 * Instruction-like or markup-heavy titles (DS fixture `act-injection-text`). Rendering is already inert; these are
 * dropped so the catalogue never shows text addressed to an agent or the reader as a command.
 */
const INSTRUCTION_RES = [
  /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|all)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i,
  /\b(system|assistant|developer)\s*(prompt|message|:)/i,
  /\byou (are|must|should) (now )?(an?|the) (ai|assistant|agent|model)\b/i,
  /\b(send|share|reveal|post)\b.{0,30}\b(journal|password|token|api key|location|address|phone)\b/i,
  /```|<\/?\w+[^>]*>|\{\{|\}\}/,
];
export function looksLikeInstruction(title: string): boolean {
  return INSTRUCTION_RES.some((re) => re.test(title));
}
