// The Claude loop (PRD 4.2 / 6.5): ask for a generator, run it in the sandbox, validate the result,
// and send problems back automatically for up to `maxRepairs` rounds.

import { systemTurn, changeTurn, repairTurn, extractCode, proseOf } from './prompt.js';

/**
 * @param o.sample   the `sample` capability (or a stand-in with the same call shape)
 * @param o.request  what the user typed
 * @param o.history  earlier [{role, content}] turns of this chat (prose only; kept by the page)
 * @param o.current  {source, params} when changing an existing generator, else null
 * @param o.run      async (source) => {design, meta}; throws on a generator error
 * @param o.check    (design) => [error strings] (validation errors that block export)
 * @param o.onStatus (text) => void, progress for the UI
 * @returns {ok, prose, source, design, meta, rounds, problems}
 */
export async function askClaude(o) {
  const { sample, request, history = [], current = null, material, machine, run, check, onText, onStatus = () => {}, signal, images, maxRepairs = 3, modelTier } = o;
  const turns = [{ role: 'user', content: systemTurn(material, machine) }];
  for (const h of history.slice(-8)) turns.push({ role: h.role, content: h.content });
  turns.push({ role: 'user', content: current && current.source ? changeTurn(request, current.source, current.params) : request });
  let prose = '', last = null;
  for (let round = 0; round <= maxRepairs; round++) {
    onStatus(round === 0 ? 'Claude is writing the generator…' : `Claude is fixing ${last.problems.length === 1 ? 'a problem' : last.problems.length + ' problems'} (round ${round} of ${maxRepairs})…`);
    const opts = { signal, cache: false, onText };
    if (modelTier) opts.modelTier = modelTier;
    if (round === 0 && images && images.length) opts.images = images;
    const reply = await sample(turns, opts);
    const text = reply.text;
    if (round === 0) prose = proseOf(text);
    const source = extractCode(text);
    if (!source) {
      if (round === 0) return { ok: false, question: true, prose: prose || text, source: null, rounds: 1, problems: [] };
      last = { ...last, problems: ['Your reply had no ```js code block. Send the complete generator.'] };
    } else {
      onStatus('Running the generator…');
      let problems = [], result = null;
      try {
        result = await run(source);
        problems = check(result.design);
      } catch (err) {
        problems = [String((err && err.message) || err)];
      }
      last = { source, result, problems };
      if (!problems.length) return { ok: true, prose, source, design: result.design, meta: result.meta, rounds: round + 1, problems: [] };
    }
    if (round === maxRepairs) break;
    turns.push({ role: 'assistant', content: text });
    turns.push({ role: 'user', content: repairTurn(last.problems.slice(0, 12)) });
  }
  return { ok: false, prose, source: last && last.source, design: last && last.result && last.result.design, meta: last && last.result && last.result.meta, rounds: maxRepairs + 1, problems: last ? last.problems : [] };
}
