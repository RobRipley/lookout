// General definitions describe a concept, never the current state of a project.
export const commonGlossary = [
  ['PR', 'Pull request: a proposed set of code changes for others to review. Opening or approving one does not mean the changes are deployed.'],
  ['CI', 'Continuous integration: automated checks run against code changes, such as builds and tests. Passing checks is different from verifying the live app.'],
  ['LP', 'Liquidity provider, or liquidity-providing position: money supplied to a trading pool so other people can trade. The exact pool and position depend on the project.'],
  ['RPC', 'Remote procedure call: a way for an app to ask a blockchain service for information or submit a request. A response alone may not prove final settlement.'],
  ['API', 'Application programming interface: the defined requests that one piece of software can make to another.'],
  ['ABI', 'Application binary interface: the exact format software uses to encode and understand requests and responses. A version label identifies a particular format.'],
  ['Wasm', 'WebAssembly: the compiled program file that runs inside an ICP canister. Building the file is separate from installing it on the live network.'],
  ['Candid', 'The interface description used by ICP canisters: it defines the available methods and the types of information they accept and return.'],
  ['PocketIC', 'A local testing environment that imitates ICP so canister behavior can be checked without changing the live app.'],
  ['hashes', 'Digital fingerprints of files or data. Matching fingerprints help verify that the exact same bytes were used; they do not by themselves prove the software works.'],
  ['hash', 'A digital fingerprint of a file or piece of data. Matching fingerprints help verify exact bytes; they do not by themselves prove the software works.'],
  ['source pins', 'Recorded references or fingerprints used to identify the exact source files or versions checked.'],
  ['source pin', 'A recorded reference or fingerprint used to identify the exact source file or version checked.'],
  ['snapshot', 'A saved view of a board at a particular point in time. Its publication time and the time its source changed can differ.'],
  ['devnet', 'A public test blockchain used to rehearse behavior with test assets. A devnet result is not proof of a main-network transaction.'],
  ['mainnet', 'The live blockchain network, where real assets and permanent transactions are involved.'],
  ['escrow', 'Assets held under defined release rules while an operation is pending. Holding them does not mean the destination has received its assets.'],
  ['quorum', 'The required number of independent responses that must agree before the software accepts an observation.'],
  ['finality', 'The point at which the project’s rules consider a blockchain result settled enough to rely on. The exact rule depends on the network.'],
  ['nonce', 'A sequence number used to distinguish and order transaction attempts. Reusing or replacing it has rules specific to the chain.'],
  ['idempotent', 'Safe to repeat without performing the same logical action twice. This must be demonstrated for the particular operation.'],
  ['reorg', 'A blockchain history change that can remove or replace a recently observed transaction.'],
].map(([term, definition]) => ({ term, definition }));

function scopeOf(entry) {
  return Array.isArray(entry.cardId) ? entry.cardId[0] : entry.cardId;
}
export function definitionsFor(glossary = [], cardId) {
  const result = new Map(commonGlossary.map(entry => [entry.term, entry]));
  for (const entry of glossary) if (!scopeOf(entry)) result.set(entry.term, entry);
  for (const entry of glossary) if (cardId && scopeOf(entry) === cardId) result.set(entry.term, entry);
  return [...result.values()].filter(entry => entry.term && entry.definition).sort((a,b) => b.term.length - a.term.length);
}
const word = char => Boolean(char && /[\p{L}\p{N}_]/u.test(char));
export function explainText(text, definitions) {
  if (!text) return [];
  const output = [];
  let cursor = 0, plain = '';
  while (cursor < text.length) {
    const entry = definitions.find(item => text.startsWith(item.term, cursor)
      && !(word(item.term[0]) && word(text[cursor - 1]))
      && !(word(item.term.at(-1)) && word(text[cursor + item.term.length])));
    if (!entry) { plain += text[cursor++]; continue; }
    if (plain) { output.push({ text: plain }); plain = ''; }
    output.push({ text: entry.term, definition: entry.definition });
    cursor += entry.term.length;
  }
  if (plain) output.push({ text: plain });
  return output;
}
