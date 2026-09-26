/* step-prompt.js - the words put in front of the model, in one place.
 *
 * This lived inside the offscreen document, which was the only thing that
 * ever talked to a model. That stopped being true when the panel started
 * answering decisions - Chrome throttles what it cannot see, and the same
 * twelve tokens took 40.7s in the hidden document and 0.5s in the visible
 * one - so both of them need to build the same prompt, and a second copy
 * would be a second thing to keep in step.
 *
 * Loaded as a plain script by the service worker and the panel, and imported
 * for its side effect by the offscreen module.
 */
// The page, what has happened, and one question: what next. Kept small on
// purpose - every token here is prefill on a 3B model, and prefill is what
// made the 8B path unusable. Controls are numbered because a number is one
// token and a name is many, and because a small model gets numbers right.
function buildStepPrompt({ goal, controls = [], history = [], observation, note, narrowedFrom = 0 }) {
  // Every line here is prefill on every turn, so a line is as short as it
  // can be and still be decidable: the number, the name, what it is, and its
  // state. "link" is left off because most controls are links and the model
  // does not need telling; anything that is not a link says so.
  // Cut to a length that still tells them apart. Truncating blindly turned
  // "Display estimated precipitation on hover" and "Display estimated
  // precipitation by county" into the same line - and the model answers by
  // number, so it was being asked to choose between two things it could not
  // distinguish. Where a short form collides, the ones that collide keep
  // their length; everything else pays the shorter price.
  const SHORT = 26;
  const short = controls.map((c) => String(c.label || "").slice(0, SHORT));
  const collides = new Set();
  const firstAt = new Map();
  short.forEach((t, i) => {
    const k = t.toLowerCase();
    if (firstAt.has(k)) { collides.add(i); collides.add(firstAt.get(k)); }
    else firstAt.set(k, i);
  });
  const list = controls.map((c, i) => {
    const kind = c.type || c.kind || "";
    // Parentheses, not angle brackets. The template below writes a
    // placeholder as <control>, and a control line ended "<button>" - so a
    // 1.5B asked to click the NWPS User Guide replied {"name":"<button>"}.
    // It had copied the right shape from the wrong place, because the two
    // notations were the same one.
    const what = !kind || kind === "link" || kind === "a" ? "" : ` (${kind})`;
    // Measured on real hardware: one decision was 32.6s of a 33.2s request
    // with page work at zero, and at that prefill rate a token is about
    // forty milliseconds of somebody waiting. Every character cut here comes
    // straight off the wait, and none of it costs the model an option -
    // which is the thing that must not be traded, since a control it cannot
    // see is one it cannot choose.
    // Three options out of fifty told the model almost nothing: a state
    // dropdown showed Alabama, Alaska, Arizona and no sign that the other
    // forty-seven were in there, so "select wyoming" had no reason to pick
    // it. More of them, and the count either way, so a list is recognisable
    // as the place a value lives even when the value itself is not shown.
    const all = c.options || [];
    const shown = all.slice(0, 8).map((o) => String(o.text || o.value).slice(0, 14));
    const opts = all.length
      ? ` [${shown.join("|")}${all.length > shown.length ? ` +${all.length - shown.length} more` : ""}]`
      : "";
    const state = typeof c.checked === "boolean" ? (c.checked ? " on" : " off") : "";
    const label = collides.has(i) ? String(c.label || "").slice(0, 52) : short[i];
    return `- ${label}${what}${state}${opts}`;
  }).join("\n");

  const done = history.length
    ? history.map((h, i) => `${i + 1}. ${h.did}${h.outcome ? ` -> ${h.outcome}` : ""}`).join("\n")
    : "nothing yet";

  return [
    "Operate this web page. Reply with one JSON object only.",
    "",
    `Request: ${goal}`,
    "",
    narrowedFrom
      // Said plainly, so the model knows the list is a shortlist and that
      // rejecting all of it is an available answer rather than a failure.
      ? `The ${controls.length} controls closest to that, of ${narrowedFrom} on the page`
        + ' (use {"do":"find","words":"..."} to look through the rest):'
      : "Controls on the page:",
    list || "(none found)",
    "",
    "Steps already taken:",
    done,
    observation ? `\nWhat the page shows now:\n${String(observation).slice(0, 1200)}` : "",
    note ? `\nNote: ${note}` : "",
    "",
    // Named rather than numbered. A 1.5B replied {"n":108,...} on a page
    // with fewer controls than that - the right format, about a control that
    // did not exist - because counting a hundred numbered lines is not
    // something a model this size does reliably. It has no trouble saying
    // which one it means.
    // Nothing in a template that could be mistaken for something to copy.
    "One action. Put a name from the list above where NAME is:",
    '  {"name":"NAME","do":"click"}  {"name":"NAME","do":"check","on":true}',
    '  {"name":"NAME","do":"select","value":"OPTION"}',
    '  {"name":"NAME","do":"type","value":"TEXT"}',
    // Searching is its own action because typing is not searching: fill
    // leaves the words sitting in the box. The page's own search box is
    // found and submitted, so the model does not have to name it or know
    // that Enter is what a search widget listens for.
    '  {"do":"search","value":"WORDS"}  to put words into this page\u2019s search',
    // The model narrowing the list itself, rather than us deciding for it
    // what is relevant. On a page of a hundred and twenty controls it can
    // say what it is looking for and get back the few that might be it.
    '  {"do":"find","words":"WHAT YOU ARE LOOKING FOR"}  to list matching controls',
    '  {"do":"read"}  {"do":"finish","answer":"ANSWER"}',
    "",
    // These lines were a third of the prompt, and the prompt is prefill on
    // every turn. Same rules, half the tokens - which is what paid for
    // showing the model the whole page instead of the first half of it.
    //
    // The rule about not stopping early matters most. It used to read "if
    // the page changed, the job is done and the next action is finish",
    // which told the model to stop after one action, so a request with two
    // halves only ever got its first half done. A request is finished when
    // everything it asked for has happened, not when something has.
    "Rules:",
    // This used to read "pick the control whose name matches the request",
    // which is an instruction to do surface word-matching - the very thing
    // the scorer does and the model is here to improve on. Asked for "last
    // month of data" it duly found a control wearing the word last, which
    // was a pagination link. Work out what is meant, then find what does it.
    "- Work out what the request means, then choose the control that does",
    "  it. The right control often shares no word with the request: a month",
    "  is 30 days, water level is gage height, flow is discharge.",
    "- Do not choose a control merely because a word in it appears in the",
    "  request.",
    // Both halves of this earned their place: the model was spending a turn
    // reading a page it was about to change, and pressing controls to
    // answer questions. Shortened, not dropped.
    "- Action: act now, do not read first. Question: read, do not press.",
    "- Not listed? Click what holds it open, look again next turn.",
    "- Looking something up on this site? Use search.",
    "- Never redo a step that worked; do the next part still outstanding.",
    "- finish only once all of it is done.",
    // A small model that names a control straight away anchors on whatever
    // word it saw first. One short phrase of thinking, before the choice,
    // costs a few tokens of decode and is the cheapest accuracy there is.
    "",
    "Put one short phrase in \"why\" saying what the request means, then the",
    "action. Example: {\"why\":\"a month is 30 days\",\"name\":\"30 days\",\"do\":\"click\"}",
  ].filter(Boolean).join("\n");
}

globalThis.WC_BUILD_STEP_PROMPT = buildStepPrompt;

/* A question is not an operation, and was being asked as one.
 *
 * "Explain this data" went to the model with a hundred and fifteen control
 * lines, twenty-five lines of rules about clicking, checking, selecting and
 * searching, and the page's values last - roughly eighteen hundred tokens of
 * prefill to answer a question whose whole input is the values. Prefill is
 * most of what a turn costs, so the reading was paying four hundred tokens
 * of page and fourteen hundred of things it must not do.
 *
 * It also explains the answer a 3B kept giving. Told mostly about pressing,
 * shown a list of things to press, it pressed: {"name":"Legend","do":"click"}
 * to "explain this data". The prompt was asking for the wrong kind of answer
 * and getting it.
 *
 * So a question gets its own prompt: the values, the question, and one shape
 * to answer in. Nothing about controls, because none will be touched.
 */
function buildReadPrompt({ goal, observation, note }) {
  return [
    "Answer the question using only what this page shows.",
    "Reply with one JSON object only.",
    "",
    `Question: ${goal}`,
    "",
    "What the page shows:",
    String(observation || "nothing readable").slice(0, 1800),
    note ? `\nNote: ${note}` : "",
    "",
    '{"answer":"YOUR ANSWER","do":"finish"}',
    "",
    "Rules:",
    // Said outright, because the failure to guard against is a confident
    // answer built out of what the model knows about rivers rather than out
    // of this page.
    "- Use the values above. Quote the actual numbers and their units.",
    "- Two or three sentences. Say what the values mean, not what the page is.",
    "- If the values do not answer the question, say that in the answer.",
  ].filter(Boolean).join("\n");
}

globalThis.WC_BUILD_READ_PROMPT = buildReadPrompt;

/* The model's reply, as an object.
 *
 * Shared for the same reason the prompt is: the panel answers decisions now,
 * and whoever asked has to turn one sentence of model output into a step
 * whichever window produced it. A second copy of this would be a second
 * thing to keep in step, and the first version of the panel path forgot to
 * parse at all - it handed back raw text where the caller reads .step, so
 * every decision the panel served would have looked like the model planning
 * nothing.
 */
// Small models do not reliably obey "JSON only" - they add a preamble, wrap
// the object in ``` fences, or continue talking afterwards. Taking the first
// balanced object tolerates all three, where JSON.parse on the whole reply
// fails on any of them. Braces inside string values are respected, since a
// gauge name or a selector can legitimately contain one.
function firstJsonObject(text) {
  const start = (text || "").indexOf("{");
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      const slice = text.slice(start, i + 1);
      const ok = (() => { try { return JSON.parse(slice); } catch (e) { return null; } })();
      return ok || repairJson(slice);
    }
  }
  // The walk never closed. A missing quote does that: in
  // {"why":"...",name":"Alaska",...} the stray quote opens a string that
  // runs to the end, so the closing brace is never seen as one and the
  // object looks unterminated rather than malformed. Repair what is there,
  // up to the last brace in the text.
  const lastBrace = text.lastIndexOf("}");
  return lastBrace > start ? repairJson(text.slice(start, lastBrace + 1)) : null;
}

/* One character short of right.
 *
 * A 3B replied {"why":"selecting a state",name":"Alaska","do":"select"} -
 * the answer entirely correct, one opening quote missing from a key - and it
 * was thrown away as unusable. The model had understood the page and chosen
 * the right control; a parser gave up over a typo. That is the most damaging
 * pattern this project has: the model is right and the layer around it
 * discards the answer.
 *
 * Small models drop and double punctuation. Repairing that is not guessing
 * at meaning - the structure says where a quote belongs - and anything that
 * still will not parse is still refused.
 */
function repairJson(slice) {
  const tries = [
    // A key missing its opening quote: ,name": -> ,"name":
    (t) => t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":'),
    // A key with no quotes at all: ,name: -> ,"name":
    (t) => t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'),
    // Single quotes where double belong.
    (t) => t.replace(/'/g, '"'),
    // A trailing comma before the close.
    (t) => t.replace(/,\s*([}\]])/g, "$1"),
  ];
  // Each repair alone, then all of them together: one is usually enough, and
  // applying them all to something already valid can make it worse.
  for (const fix of tries) {
    try { return JSON.parse(fix(slice)); } catch (e) { /* next */ }
  }
  try {
    return JSON.parse(tries.reduce((t, fix) => fix(t), slice));
  } catch (e) { return null; }
}

globalThis.WC_FIRST_JSON_OBJECT = firstJsonObject;
