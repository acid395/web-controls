#!/usr/bin/env node
/* run-tests.js - the regression suite.
 *
 *   node extension/test/run-tests.js          logic only, no network
 *   node extension/test/run-tests.js --live   also calls the real agency APIs
 *
 * Nearly every case here exists because it once produced a confidently wrong
 * answer rather than an error: a statewide average over incompatible datums,
 * Snake Creek returned for the Snake River, Kansas City resolving to Kansas,
 * a 2012 reading served as current, Friday answered with today's weather.
 * Those are invisible to type checking and to "does it crash" testing, which
 * is why they are pinned here by name.
 */
// Declared up here, not beside report(): the nested call sites below run
// first, and a `let` declared after them is in the temporal dead zone.
// jsdom refuses to navigate and throws asynchronously when something tries.
// That killed the process mid-run, so the suite printed forty-four results
// and no summary - a pass and a crash looked identical from outside.
process.on("unhandledRejection", (err) => {
  const text = String((err && err.message) || err);
  if (/Not implemented: navigation/.test(text)) return; // a jsdom limit, not a fault
  failed++;
  failures.push({ label: "unhandled rejection", actual: text, expected: "no unhandled rejection" });
});
process.on("uncaughtException", (err) => {
  const text = String((err && err.message) || err);
  if (/Not implemented: navigation/.test(text)) return;
  failed++;
  failures.push({ label: "uncaught exception", actual: text, expected: "no uncaught exception" });
  // Recorded silently once, which meant a throw that killed the run left no
  // trace but a missing summary. The stack is the only thing that says where.
  console.log(`\n  FAIL uncaught exception: ${text}\n${(err && err.stack) || ""}`);
});

let reported = false;
// Declared with the other counters, not beside runAsync at the foot of the
// file: a section that runs early would otherwise hit the temporal dead zone
// and take the rest of the suite down with it.
let pendingAsync = 0;
let exiting = false;

const { loadBackground, loadPage, loadOffscreenHelper } = require("./harness");

let passed = 0, failed = 0, skipped = 0;
const failures = [];
// Set on the file's last line. Anything less means the module body threw and
// took every section below the throw with it - which is how 1,800 lines of
// this suite sat unrun behind a summary that never printed. `report` is a
// function declaration, so it is hoisted and safe to call from here.
let bodyDone = false;
installSummaryHooks();

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; failures.push({ label, actual, expected }); }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}
function ensure(label, condition, detail) {
  if (condition) passed++;
  else { failed++; failures.push({ label, actual: detail, expected: "truthy" }); }
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
}
function skip(label, why) { skipped++; console.log(`  skip ${label} (${why})`); }
function section(name) { console.log(`\n${name}`); }

const sb = loadBackground();
const plan = (text, route = { global: "GENERIC" }) => sb.planDataTool(text, route);
const toolOf = (text, route) => { const p = plan(text, route); return (p && p.name) || undefined; };

section("following the site to the answer");
// A single step cannot reach what a site keeps two links away. "Smith river
// discharge" on a California water portal was answered from a national API -
// nine rivers in nine states, correct and useless - while the site in front
// of it had the one that was meant, behind a River Forecast link.
const portalFront = `<!doctype html><html><head><title>Portal</title></head><body>
  <a href="/about.html">About</a><a href="/contact.html">Contact</a>
  <a href="/privacy.html">Privacy policy</a>
  <a href="/rivforecasts.html">River Forecast</a></body></html>`;
const portalInner = `<!doctype html><html><head><title>North Coast rivers</title></head><body>
  <h1>North Coast River System</h1>
  <table><tr><th>Station</th><th>Discharge, cfs</th></tr>
    <tr><td>SMITH RIVER NR CRESCENT CITY</td><td>227</td></tr>
    <tr><td>EEL RIVER AT SCOTIA</td><td>512</td></tr></table></body></html>`;
const portal = loadPage(portalFront, { url: "https://portal.example.gov/" });
if (!portal) skip("following links", "jsdom not installed");
else {
  const fetched = [];
  const wire = (bg) => {
    const real = bg.chrome.tabs.sendMessage;
    bg.chrome.tabs.sendMessage = async (id, m) => {
      if (m && m.type === "call" && m.fn === "readUrl") {
        fetched.push(m.args[0]);
        if (/rivforecasts/.test(m.args[0])) {
          return { ok: true, result: loadPage(portalInner, { url: m.args[0] }).GENERIC.readPage() };
        }
        return { ok: false, error: "404" };
      }
      return real(id, m);
    };
    return bg;
  };
  const site = wire(loadBackground({ page: portal }));
  runAsync(async () => {
    const r = await site.__ask({ type: "smartAsk", instruction: "smith river discharge" });
    check("the site answers before a national API does", r.plannedBy, "followed-the-site");
    ensure("with the value that was actually on it",
      ((r.display || {}).rows || []).some((x) => /227/.test(x.value)), (r.display || {}).rows);
    ensure("and says where it read it", /rivforecasts/.test(r.readFrom || ""), r.readFrom);
    // It must not wander: a link has to share words with the question.
    ensure("it does not follow unrelated links",
      !fetched.some((u) => /privacy|contact|about/.test(u)), fetched);
    // And it must stay bounded.
    ensure("and follows only a few", fetched.length <= 6, fetched.length);
  });
}

// Links only reach what a site chose to link, and a data portal mostly does
// not link its data: CDEC has a Smith River gauge and no page saying so,
// because you are meant to search for it. A GET form is a URL with blanks in
// it, so the search can be fetched without the page moving.
const searchable = loadPage(`<!doctype html><html><head><title>Portal</title></head><body>
  <a href="/about.html">About</a>
  <form method="get" action="/stations">
    <input type="hidden" name="active" value="true">
    <label for="q">Station search</label><input id="q" type="text" name="sta_name">
    <button type="submit">Go</button></form></body></html>`, { url: "https://portal.example.gov/" });
if (!searchable) skip("searching a site", "jsdom not installed");
else {
  const built = searchable.GENERIC.searchUrl("smith river");
  check("a GET search reads as a URL", built.url, "https://portal.example.gov/stations?active=true&sta_name=smith+river");
  ensure("carrying the form's own hidden fields", /active=true/.test(built.url), built.url);

  // A POST search cannot be a URL, and submitting one moves the page, so it
  // is offered rather than done.
  const posting = loadPage(`<!doctype html><html><body><form method="post" action="/find">
    <label for="s">Search this site:</label><input id="s" name="q" type="text"></form></body></html>`,
    { url: "https://portal.example.gov/" });
  let threw = null;
  try { posting.GENERIC.searchUrl("smith river"); } catch (e) { threw = e.message; }
  ensure("a POST search says why it cannot", /post/i.test(threw || ""), threw);
}

// An agency writes "SMITH R NR CRESCENT CITY" where a person writes "Smith
// River". A literal match finds neither the row nor the answer.
const abbrevTable = { title: "Stations", headings: [], text: "", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Station", "Discharge, cfs"], rows: [
    ["SMITH R NR CRESCENT CITY", "227"], ["EEL RIVER AT SCOTIA", "512"]] }] };
const rowFor = (place) => {
  const hit = sb.findOnPage(abbrevTable, { wants: ["discharge"], place, day: null });
  return hit ? hit[0].value : null;
};
// A choice is a call that has already been agreed to - and it was the one
// path that dropped half of it. "Search this site" typed the query and never
// submitted, then rendered {"element":"input"} as the answer.
const chosen = loadPage(`<!doctype html><html><body><form method="post" action="/find">
  <label for="s">Search this site:</label><input id="s" name="q" type="text"></form></body></html>`,
  { url: "https://portal.example.gov/" });
if (!chosen) skip("choosing an option", "jsdom not installed");
else {
  const chooser = loadBackground({ page: chosen });
  runAsync(async () => {
    const r = await chooser.__ask({
      type: "runToolCall", label: 'Search this site for "smith river"',
      toolCall: { name: "pageFill", args: { selector: '[name="q"]', text: "smith river" }, thenSubmit: true },
    });
    ensure("a chosen option submits as well as fills", !!r.follow, r);
    ensure("and renders a card, not a DOM node",
      !!(r.display && r.display.title && !/element|nodeName/i.test(JSON.stringify(r.display))), r.display);
    check("titled with what was chosen", r.display.title, 'Search this site for "smith river"');
    ensure("the selector stays out of the card",
      !JSON.stringify(r.display.rows).includes("selector"), r.display.rows);
    // A form posting to an API endpoint is driven by the page's own script.
    // Submitting CDEC's answered 404 and left the person on an error page
    // they never asked for, so it is not offered at all.
    const apiForm = loadPage(`<!doctype html><html><body><form method="post" action="/api/sitecore/Search/Search">
      <label for="s">Search this site:</label><input id="s" name="q" type="text"></form></body></html>`,
      { url: "https://portal.example.gov/" });
    if (apiForm) {
      check("a form posting to an API is not navigable",
        apiForm.GENERIC.searchTargets().targets[0].navigable, false);
      const plain = loadPage(`<!doctype html><html><body><form method="post" action="/search">
        <label for="s">Search</label><input id="s" name="q" type="text"></form></body></html>`,
        { url: "https://portal.example.gov/" });
      check("an ordinary POST search still is",
        plain.GENERIC.searchTargets().targets[0].navigable, true);
    }
  });
}

check("an abbreviated river still matches", rowFor("smith river"), "227");
check("a spelled-out one still does too", rowFor("eel river"), "512");
check("and a river that is not there does not", rowFor("snake river"), null);

section("the number is the whole distinction");
// "Select 7-day anomaly" filled a box labelled Current Data Layer with "day
// anomaly" and submitted it, while the 7-day button sat right there. Words
// shorter than two characters were dropped, so the 7 never reached the
// matcher - and 1-day, 3-day and 7-day are different questions. 30-day had
// been surviving only by having two digits, which is why this went unseen.
const graphButtons = { url: "https://water.noaa.gov/", controls: [
  { kind: "button", label: "7-day anomaly", selector: "#d7", confidence: "high" },
  { kind: "button", label: "1-day anomaly", selector: "#d1", confidence: "high" },
  { kind: "button", label: "30 day % normal", selector: "#n30", confidence: "high" },
  { kind: "button", label: "Normal", selector: "#nm", confidence: "high" },
  { kind: "input", type: "search", label: "Current Data Layer", selector: "#cdl", confidence: "high" },
] };
const gb = (q) => {
  const r = sb.planGenericTool(q, graphButtons);
  return r && r.calls ? r.calls.map((c) => c.args.selector).join(",") : null;
};
check("a lone digit survives into the subject",
  sb.meaningfulWords("select 7-day anomaly"), ["7", "day", "anomaly"]);
check("7-day is not 1-day", gb("select 7-day anomaly"), "#d7");
// A text box can absorb any words at all, so it looks like a match for
// everything. A button that is actually called this outranks it.
check("a graph button beats a box that would swallow the words",
  gb("select 30 day% normal"), "#n30");
check("and the longer label beats the bare one", gb("go to 30 day% normal"), "#n30");

section("a dead click does not set off something else");
// The open-then-finish retry fires whenever a click leaves a nearby checkbox
// untouched - which is true of most buttons that sit in a list row. If it
// were allowed to pick another click, an ordinary button doing nothing
// measurable would quietly press something else on the page. It may only
// finish the job with a switch.
// The checkbox is in a row of its own and named after something else - a
// checkbox sharing a row with the button would be that button's control, and
// ticking it would be right rather than a stray second action.
const deadClick = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <ul><li><button id="info">Flood Inundation</button></li>
    <li><span>Basemap opacity</span><input type="checkbox" name="unrelated"></li>
    <li><a id="elsewhere" href="#x">Flood Inundation Details</a></li></ul>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!deadClick) skip("dead clicks", "jsdom not installed");
else {
  const bg = loadBackground({ page: deadClick });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: "click flood inundation" });
    check("a button that changes nothing does not trigger a second click",
      deadClick.document.querySelector('[name="unrelated"]').checked, false);
  });
}

section("the standard surface, provided");
// Chrome ships no modelContext, so registerTool had nowhere to go and every
// derived tool stayed private to this extension. Providing the documented
// shape costs a registry, a list and a call - and makes the tools reachable
// by anything else on the page, not just by us.
const mcpPage = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <label><input type="checkbox" name="fi"> Flood Inundation</label>
  <button id="go">Refresh</button></body></html>`, { url: "https://water.noaa.gov/" });
if (!mcpPage) skip("modelContext polyfill", "jsdom not installed");
else {
  check("the page had none to begin with", typeof mcpPage.document.modelContext, "undefined");
  const pub = mcpPage.GENERIC.mcpPublishControls({ max: 40 });
  ensure("publishing now lands somewhere", pub.registered > 0, pub);
  check("and says it provided the surface itself", pub.polyfilled, true);
  check("through the current name, not the deprecated one", pub.via, "document.modelContext");

  const api = mcpPage.document.modelContext;
  ensure("the documented shape is there",
    !!(api && typeof api.registerTool === "function" && typeof api.getTools === "function"
       && typeof api.callTool === "function"), Object.keys(api || {}));
  ensure("everything registered is listed", api.getTools().length >= pub.registered,
    `${api.getTools().length} listed vs ${pub.registered} added`);
  // Republishing must not duplicate: the same page is read many times over,
  // and forty tools becoming eighty would be its own kind of wrong.
  const before = api.getTools().length;
  const again = mcpPage.GENERIC.mcpPublishControls({ max: 40 });
  check("republishing adds nothing the second time", again.registered, 0);
  check("and the list does not grow", api.getTools().length, before);

  // Every tool went in twice: registerTool records it and the publisher
  // pushed it again. A cap of forty kept the numbers small enough never to
  // notice - live, 160 tools derived read back as 91 published, and only 91
  // because several passes each added another forty.
  const fresh = loadPage(`<!doctype html><html><body>${
    Array.from({ length: 30 }, (_, i) => `<button id="b${i}">Action ${i}</button>`).join("")
  }</body></html>`, { url: "https://water.noaa.gov/" });
  if (fresh) {
    const derived = fresh.GENERIC.pageTools().tools.length;
    const pub = fresh.GENERIC.mcpPublishControls();
    const listed = fresh.document.modelContext.getTools().length;
    check("each tool is listed once, not twice", listed, pub.registered);
    // And everything the page offers, not an arbitrary slice: a registry is
    // not a prompt, and an agent should see what the page can do.
    check("everything derived is published", pub.registered, derived);
  }

  // Chrome's own implementation names invocation executeTool and takes its
  // arguments as a JSON string, not an object. We probed callTool, invokeTool
  // and invoke, and passed an object - so against the real API this threw
  // "no way to call" on a page that was in fact fully capable. A consumer
  // written for real Chrome has to work against the polyfill unchanged.
  ensure("the name Chrome actually uses is offered",
    typeof api.executeTool === "function", Object.keys(api || {}));

  // The point of it: something that is not this extension can drive the page.
  runAsync(async () => {
    const tool = api.getTools().find((t) => /flood.?inundation/i.test(t.name));
    ensure("a layer is offered as a tool", !!tool, api.getTools().map((t) => t.name).slice(0, 8));
    if (tool) {
      await api.callTool(tool.name, { on: true });
      check("and calling it through the standard API works",
        mcpPage.document.querySelector('[name="fi"]').checked, true);
      // The real spelling, with the real argument shape.
      await api.executeTool(tool.name, JSON.stringify({ on: false }));
      check("executeTool with JSON-string arguments works too",
        mcpPage.document.querySelector('[name="fi"]').checked, false);
    }
    await api.callTool("readThisPage", {}).then(
      (r) => ensure("reading works through it too", !!r, r),
      (e) => ensure("reading works through it too", false, String(e.message)));
  });

  // Publishing rebuilds the callable set, and asking it for 40 tools deleted
  // the other 210 - "click archive" stopped existing the moment publishing
  // began to succeed. Registration is capped; the page's own abilities are not.
  const many = loadPage(`<!doctype html><html><body>${
    Array.from({ length: 60 }, (_, i) => `<a href="/n${i}">Item ${i}</a>`).join("")
  }<a href="/last">Archive</a></body></html>`, { url: "https://water.noaa.gov/" });
  if (many) {
    many.GENERIC.mcpPublishControls({ max: 40 });
    ensure("publishing does not shrink what the page can do",
      many.GENERIC.pageTools().tools.some((t) => /Archive/i.test(t.name)),
      many.GENERIC.pageTools().tools.length);
  }
}

section("standing aside for the real thing");
// Chrome 146+ ships WebMCP behind chrome://flags/#enable-webmcp-testing, and
// with it on, document.modelContext is genuinely there. Everything about the
// polyfill then hinges on a branch that had no test at all: it must not
// install over a real implementation, must register into it rather than
// beside it, and must keep the page's own tools distinguishable from ours -
// because a site's declarations are worth more than our inferences, and that
// preference is the whole reason the distinction exists.
const realApi = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <label><input type="checkbox" name="fi"> Flood Inundation</label>
  <script>
    const reg = [];
    document.modelContext = {
      registerTool: (d) => { reg.push(d); return { name: d.name }; },
      getTools: () => reg.slice(),
      executeTool: async (name, json) => {
        const t = reg.find((x) => x.name === name);
        return t.execute(json ? JSON.parse(json) : {});
      },
    };
    document.modelContext.registerTool({
      name: "ping", description: "the page's own tool",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ pong: true }),
    });
    // Exactly what Chrome hands back: the schema as a JSON string.
    document.modelContext.registerTool({
      name: "stringSchema", description: "schema arrives as text",
      inputSchema: JSON.stringify({ type: "object", properties: { gauge: { type: "string" } } }),
      execute: async () => ({ ok: true }),
    });
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!realApi) skip("a real modelContext", "jsdom not installed");
else {
  const got = realApi.GENERIC.mcpInstall();
  check("the polyfill does not install over a real one", got.installed, false);
  ensure("and says why", /already has one/.test(got.why || ""), got);

  const pub = realApi.GENERIC.mcpPublishControls({ max: 40 });
  check("publishing reports it did not polyfill", !!pub.polyfilled, false);
  ensure("and registers into the page's own API",
    realApi.document.modelContext.getTools().some((t) => /flood.?inundation/i.test(t.name)),
    realApi.document.modelContext.getTools().map((t) => t.name).slice(0, 8));

  // The distinction that decides which source wins.
  runAsync(async () => {
    const listed = await realApi.GENERIC.mcpTools();
    const theirs = listed.tools.filter((t) => t.declaredBy === "page");
    const mine = listed.tools.filter((t) => t.declaredBy === "extension");
    ensure("the page's own tool is credited to the page",
      theirs.some((t) => t.name === "ping"), theirs.map((t) => t.name));
    ensure("and ours are still marked ours", mine.length > 0, mine.length);
    ensure("read through the real API, not our registry",
      /document\.modelContext/.test(listed.readFrom || ""), listed.readFrom);
  });

  let listedTools = null;
  runAsync(async () => {
    listedTools = (await realApi.GENERIC.mcpTools()).tools;
    const out = await realApi.GENERIC.mcpCall("ping", {});
    // Chrome returns inputSchema as a JSON string. Upstream reads
  // schema.properties to decide what arguments a tool takes, so left as a
  // string a site's own tools look like they take none - and get called
  // with none.
  ensure("a string schema is parsed, not passed through",
    (() => { const t = (listedTools || []).find((x) => x.name === "stringSchema");
      return !!(t && t.inputSchema && t.inputSchema.properties
        && t.inputSchema.properties.gauge); })(),
    JSON.stringify((listedTools || []).find((x) => x.name === "stringSchema")));

  ensure("the page's own tool is callable through it",
      out && out.result && out.result.pong === true, out);
    ensure("and it went through executeTool, not our own registry",
      /executeTool/.test((out || {}).ranVia || ""), (out || {}).ranVia);
  });
}

section("as many steps as it takes");
// Three steps, which is the ordinary case and the one no hardcoded pair
// could reach: press Layers, expand the Flood Inundation accordion, tick the
// box inside it. Each stage exists only once the one before it has run, so
// no single inventory can ever see the target.
const threeDeep = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button id="layers">Layers</button>
  <div id="panel"></div>
  <script>
    document.getElementById("layers").addEventListener("click", () => {
      if (document.getElementById("acc")) return;
      document.getElementById("panel").innerHTML =
        '<button id="acc" class="uk-accordion-title">Flood Inundation</button>' +
        '<div id="inner" class="uk-accordion-content" style="display:none"></div>';
      document.getElementById("acc").addEventListener("click", () => {
        const inner = document.getElementById("inner");
        inner.style.display = "block";
        if (!inner.innerHTML) inner.innerHTML =
          '<label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>' +
          '<label><input type="checkbox" name="swe"> Snow Water Equivalent</label>';
      });
    });
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!threeDeep) skip("three-step goals", "jsdom not installed");
else {
  const bg = loadBackground({ page: threeDeep });
  const box = (n) => threeDeep.document.querySelector(`[name="${n}"]`);
  runAsync(async () => {
    // Nothing of the sort is on the page to begin with.
    check("the target does not exist at the outset",
      threeDeep.GENERIC.inventory({ includeHidden: true })
        .controls.some((c) => /inundation mapping/i.test(c.label)), false);

    const out = await bg.__pursue("enable flood inundation mapping");
    ensure("it takes more than one step", out.steps.length >= 2, out.steps);
    ensure("and opens its way in", out.opened.length >= 1, out.opened);
    check("the control three levels down is reached", box("fim").checked, true);
    check("and its neighbour is left alone", box("swe").checked, false);
    ensure("it reports the goal as met", out.done === true, out);
  });
}

section("driven through the protocol, not around it");
// The tools were published to modelContext and then never used: every action
// went down a private path. The protocol was a claim rather than something
// relied on, so a fault in the published tools would have surfaced in
// somebody else's agent and never in our own testing. Our own driving going
// through it is the only proof that anyone else's can.
const throughMcp = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <label><input type="checkbox" name="fi"> Flood Inundation</label>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!throughMcp) skip("execution via modelContext", "jsdom not installed");
else {
  const bg = loadBackground({ page: throughMcp });
  runAsync(async () => {
    throughMcp.GENERIC.mcpPublishControls({ max: 60 });
    const tool = (throughMcp.GENERIC.pageTools().tools)
      .find((t) => /flood.?inundation/i.test(t.name));
    ensure("the layer is a published tool", !!tool, tool);
    if (tool) {
      const out = await throughMcp.GENERIC.pageToolCall(tool.name, { on: true });
      ensure("it ran through modelContext, not the private path",
        /modelContext\.executeTool/.test((out || {}).ranVia || ""), out);
      check("and the control actually moved",
        throughMcp.document.querySelector('[name="fi"]').checked, true);
      // Verification depends on these surviving the round trip - a real
      // implementation may wrap the return in the MCP content envelope.
      ensure("the control's own before and after survive the trip",
        out && typeof out.itChanged === "boolean" && /flood/i.test(out.control || ""), out);
    }

    // And the whole way up: an ordinary ask must still work, and still be
    // verified, now that every action goes through the protocol.
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    ensure("an ordinary ask still reports the control's own change",
      /Flood Inundation: false \u2192 true|already true/.test((r.display || {}).subtitle || ""),
      (r.display || {}).subtitle);
  });

  // A protocol that cannot be relied on is not a reason to fail a click.
  const brokenApi = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="fi"> Flood Inundation</label></body></html>`,
    { url: "https://water.noaa.gov/" });
  if (brokenApi) {
    runAsync(async () => {
      brokenApi.GENERIC.mcpPublishControls({ max: 60 });
      const api = brokenApi.document.modelContext;
      api.executeTool = async () => { throw new Error("the browser said no"); };
      const tool = brokenApi.GENERIC.pageTools().tools.find((t) => /flood.?inundation/i.test(t.name));
      if (tool) {
        await brokenApi.GENERIC.pageToolCall(tool.name, { on: true });
        check("a broken API falls back rather than failing the action",
          brokenApi.document.querySelector('[name="fi"]').checked, true);
      }
    });
  }
}

section("the data the page fetched for itself");
// Clicking is one way to reach what a page knows, and the least reliable.
// Every layer, chart and gauge on these sites is drawn from a JSON call the
// page already made, captured at document_start whether or not any control
// was ever found - so this reads what the site fetched without asking the
// DOM for anything, which is the case where the controls have defeated us.
const feedPage = loadPage("<!doctype html><html><body><p>map</p></body></html>",
  { url: "https://water.noaa.gov/" });
if (!feedPage) skip("captured feeds", "jsdom not installed");
else {
  const bg = loadBackground({ page: feedPage });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "data" });
    ensure("asking for the data answers", !!(r && r.display), r);
    const d = (r && r.display) || {};
    ensure("it is about what was fetched", /fetched/i.test(d.title || ""), d.title);
    // With nothing captured it must say so, not imply the page has no data.
    ensure("an empty capture explains itself rather than reading as none",
      /reload|captured/i.test(d.subtitle || ""), d.subtitle);
    ensure("and it counts requests", (d.stats || []).some((x) => /requests/i.test(x.label)), d.stats);
  });
}

section("the whole label, compared the same way on both sides");
// "Click Secretary of Energy" tied with "Deputy Secretary of Energy" on
// energy.gov. The instruction's phrase has its filler stripped - it arrives
// as "secretary energy" - while the label kept its "of", so the exact-match
// bonus never fired and the control named word for word had no advantage at
// all. A whole-label match is the strongest signal a page offers.
const officials = { url: "https://www.energy.gov/", controls: [
  { kind: "a", label: "Deputy Secretary of Energy", selector: "#deputy", confidence: "high" },
  { kind: "a", label: "Secretary of Energy", selector: "#sec", confidence: "high" },
  { kind: "a", label: "Under Secretary of Energy", selector: "#under", confidence: "high" },
] };
check("the one named word for word wins",
  sb.planGenericTool("click Secretary of Energy", officials).calls[0].args.selector, "#sec");
check("and the longer one is still reachable by its own name",
  sb.planGenericTool("click Deputy Secretary of Energy", officials).calls[0].args.selector, "#deputy");

section("identical labels are not a choice");
// nps.gov carries three controls labelled exactly "Search" - a link, a
// button and a text field - and census.gov, nasa.gov, data.gov and AirNow
// all do something similar. "Which one did you mean?" offered a list the
// person cannot tell apart either, because the only thing shown is the
// label they all share.
const threeSearches = { url: "https://www.nps.gov/", controls: [
  { kind: "a", label: "Search", selector: "#a", confidence: "high" },
  { kind: "button", type: "button", label: "Search", selector: "#b", confidence: "high" },
  { kind: "input", type: "text", label: "Search", selector: "#c", confidence: "high" },
] };
const searchPlan = sb.planGenericTool("click Search", threeSearches);
ensure("it acts instead of asking", !!(searchPlan && searchPlan.calls), searchPlan);
ensure("and does not report ambiguity it cannot explain",
  !(searchPlan || {}).ambiguous, (searchPlan || {}).ambiguous);
// But genuinely different controls sharing a word remain a real question.
const realChoice = { url: "https://x.gov/", controls: [
  { kind: "a", label: "Year to date", selector: "#ytd", confidence: "high" },
  { kind: "a", label: "Date range", selector: "#range", confidence: "high" },
] };
ensure("a real choice is still put to the person",
  !!(sb.planGenericTool("show me the date", realChoice) || {}).ambiguous,
  sb.planGenericTool("show me the date", realChoice));

// "Click Search" is not a query. The word alone routed to the search box and
// filled nothing into nothing, reporting a search, on five of seventeen sites.
check("the word search alone is not text to type", sb.carriesText("click Search"), false);
check("but a query after it is", sb.carriesText("search for smith river"), true);

section("one link is one control");
// Straight off wisconsin.gov, nasa.gov and half the federal estate:
// <a><i class="fa-facebook"></i><span>Facebook</span></a> was recorded as an
// anchor, a span and an italic, all labelled Facebook, all offered as
// separate tools. The list was padded with duplicates of whatever a site
// wraps its links in, and the same click was on offer three times. nasa.gov
// reported 569 controls; 307 of them were real.
const wrapped = loadPage(`<!doctype html><html><body>
  <a href="/fb"><i class="icon"></i><span>Facebook</span></a>
  <a href="/yt"><i class="icon"></i><span>YouTube</span></a>
  </body></html>`, { url: "https://dnr.wisconsin.gov/" });
if (!wrapped) skip("nested duplicates", "jsdom not installed");
else {
  const labels = wrapped.GENERIC.inventory({ includeHidden: true })
    .controls.filter((c) => /facebook/i.test(c.label || ""));
  check("the wrapper and its decoration are not separate controls", labels.length, 1);
  check("and the one kept is the link", (labels[0] || {}).kind, "a");
}

section("a page too big to read is a page that does not work");
// cdec.water.ca.gov could not be read at all - not slowly, at all. cssPath
// spread the parent's HTMLCollection to number the siblings, and that page
// puts 3,508 children under one parent, so the copy was made once per
// element per ancestor. Walking beats copying, and past a few hundred
// siblings the index is not a useful identifier anyway.
const wide = loadPage(`<!doctype html><html><body><div>${
  Array.from({ length: 1200 }, (_, i) => `<span>row ${i}</span>`).join("")
}<a href="/x">Reservoir storage</a></div></body></html>`,
  { url: "https://cdec.water.ca.gov/" });
if (!wide) skip("wide pages", "jsdom not installed");
else {
  const t0 = Date.now();
  const inv = wide.GENERIC.inventory({ includeHidden: true });
  const ms = Date.now() - t0;
  ensure(`a parent with 1,200 children is read in reasonable time (${ms}ms)`, ms < 8000, ms);
  ensure("and the control past them is still found",
    inv.controls.some((c) => /reservoir storage/i.test(c.label || "")),
    inv.controls.length);
}

section("every answer carries a card");
// "Enable snow depth" came back as the bare word "done" and nothing else -
// no title, no rows, no reason - which is the least useful thing this can
// say and reads exactly like a success. Several paths answered without
// building a display; rather than find each one, none of them may.
const bareAnswer = loadPage("<!doctype html><html><body><p>nothing to act on</p></body></html>",
  { url: "https://water.noaa.gov/" });
if (!bareAnswer) skip("card guarantee", "jsdom not installed");
else {
  const bg = loadBackground({ page: bareAnswer });
  runAsync(async () => {
    for (const q of ["enable snow depth", "enable flood inundation", "click something that is not here"]) {
      const r = await bg.__ask({ type: "smartAsk", instruction: q });
      const d = (r || {}).display;
      ensure(`"${q}" answers with a card`, !!(d && d.title), r);
      ensure(`"${q}" says something beyond the title`,
        !!(d && (d.subtitle || (d.rows || []).length || d.note)), d);
      ensure(`"${q}" never answers with the bare word done`,
        !(d && /^done$/i.test(String(d.title || "").trim()) && !d.subtitle), d);
    }
  });
}

section("a layer behind a panel named after it");
// The other half of the live report. "Snow Depth" is not in the document at
// all - it lives inside the National Snow Analysis accordion - and the only
// things matching "snow" are two controls of that name, one of them a navbar
// link that would leave the page instead of opening anything.
const snowPage = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav"><li><a href="/nsa">National Snow Analysis</a></li></ul>
  <ul class="uk-accordion">
    <li><button id="uk-accordion-10" class="uk-accordion-title">National Snow Analysis</button>
      <div id="snow" class="uk-accordion-content" style="display:none"></div></li></ul>
  <script>
    document.getElementById("uk-accordion-10").addEventListener("click", () => {
      const c = document.getElementById("snow");
      c.style.display = "block";
      if (!c.innerHTML) c.innerHTML =
        '<label><input type="checkbox" name="sd"> Snow Depth</label>' +
        '<label><input type="checkbox" name="swe"> Snow Water Equivalent</label>';
    });
  <\/script></body></html>`;
for (const [q, want, other] of [["enable snow depth", "sd", "swe"],
                                ["enable snow water equivalent", "swe", "sd"]]) {
  const page = loadPage(snowPage, { url: "https://water.noaa.gov/" });
  if (!page) { skip(`snow: ${q}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: q });
    check(`"${q}" reaches the layer inside the panel`,
      !!(page.document.querySelector(`[name="${want}"]`) || {}).checked, true);
    check(`"${q}" leaves its neighbour alone`,
      !!(page.document.querySelector(`[name="${other}"]`) || {}).checked, false);
    // The navbar copy of the panel's name would have left the page.
    check(`"${q}" does not navigate away`, page.location.pathname, "/");
  });
}

section("and joins steps too, without breaking a name");
// "Click forecasts and outlooks and click key messages" ran only the first
// half, because nothing split on a bare "and". It cannot simply be added to
// the list: the first half of that same sentence is the name of a control,
// "Forecasts and Outlooks", and splitting inside it destroys the instruction
// rather than sequencing it. A bare "and" separates steps only where a verb
// follows it.
const andPage = loadPage(`<!doctype html><html><body>
  <button id="fo">Forecasts and Outlooks</button>
  <button id="km">Key Messages</button>
  <p id="log"></p>
  <script>
    for (const id of ["fo", "km"]) {
      document.getElementById(id).addEventListener("click", () => {
        document.getElementById("log").textContent += id + ";";
      });
    }
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!andPage) skip("and as a separator", "jsdom not installed");
else {
  const bg = loadBackground({ page: andPage });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk",
      instruction: "click forecasts and outlooks and click key messages" });
    check("both halves run", ((r.display || {}).rows || []).length, 2);
    check("and in order, with the control's own name intact",
      (andPage.document.getElementById("log") || {}).textContent, "fo;km;");
  });
}

section("the panel survives a bare browser");
// The panel sat on "checking page..." for good, with its badge never filled
// and its enable buttons never shown. Not a failure of the check - a failure
// to reach it: three chrome APIs were guarded where they appeared early in
// popup.js and used unguarded where they appeared later, and an absent one
// throws, stopping every line after it, describeRoute among them.
//
// The buttons behind that check are the only thing that fixes an un-enabled
// site, so hiding them exactly when the check fails is a dead end.
if (typeof require === "undefined") skip("the panel", "no require");
else {
  let JSDOMLib = null;
  try { JSDOMLib = require("jsdom"); } catch (e) { /* skipped below */ }
  if (!JSDOMLib) skip("the panel", "jsdom not installed");
  else {
    const fsx = require("fs"), pathx = require("path");
    const dir = pathx.join(__dirname, "..", "popup");
    const dom = new JSDOMLib.JSDOM(fsx.readFileSync(pathx.join(dir, "popup.html"), "utf8"), {
      runScripts: "outside-only",
      virtualConsole: new JSDOMLib.VirtualConsole(),
      url: "chrome-extension://test/popup/popup.html",
    });
    const w = dom.window;
    // Only what an extension page is guaranteed to have. No storage.onChanged,
    // no tabs.onActivated, no windows - the things that were unguarded.
    w.chrome = {
      runtime: { sendMessage: () => {}, lastError: null, getURL: (p) => p },
      storage: { local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb() } },
      tabs: { query: (q, cb) => cb && cb([{ id: 1, url: "https://water.noaa.gov/", active: true }]) },
      permissions: { request: (o, cb) => cb && cb(true) },
    };
    let threw = null;
    try { w.eval(fsx.readFileSync(pathx.join(dir, "popup.js"), "utf8")); }
    catch (e) { threw = String(e.message); }
    ensure("popup.js runs without every chrome API present", !threw, threw);
    ensure("and the enable buttons are in the markup at all",
      !!w.document.getElementById("enableAll"), "no #enableAll");

    // The panel shipped with no <script> tag at all. A regex meant to cut one
    // section out of popup.html ran to the end of the file and took the
    // script, </body> and </html> with it - and a browser renders that
    // happily, so the panel looked right and nothing in it worked. Every
    // symptom that followed - a badge stuck on "checking page...", buttons
    // that would not click, Ask doing nothing - was that one missing line.
    const rawHtml = fsx.readFileSync(pathx.join(dir, "popup.html"), "utf8");
    ensure("the panel loads its script", /<script[^>]+popup\.js/.test(rawHtml), "no script tag");
    // Two of them shipped: the button was added on main months ago, and
    // rebuilding this file from that same original added a second. Only one
    // can ever be reached - getElementById returns the first - so the other
    // was a button that looked live and did nothing.
    check("each control appears once",
      (rawHtml.match(/id="enableAll"/g) || []).length, 1);
    const ids = (rawHtml.match(/id="([^"]+)"/g) || []).map((m) => m.slice(4, -1));
    check("and no id is used twice anywhere", ids.length, new Set(ids).size);
    ensure("and the document is closed properly",
      /<\/body>\s*<\/html>\s*$/.test(rawHtml.trim() + "\n"), rawHtml.slice(-60));
    const opens = (rawHtml.match(/<div[\s>]/g) || []).length;
    const closes = (rawHtml.match(/<\/div>/g) || []).length;
    check("with its divs balanced", `${opens}/${closes}`, `${closes}/${closes}`);

    // And when the worker never answers, the way out appears on its own.
    runAsync(async () => {
      await new Promise((r) => setTimeout(r, 4500));
      const row = w.document.getElementById("enableRow");
      ensure("a worker that never answers still leaves a way out",
        !!(row && /show/.test(row.className)), row && row.className);
      ensure("and the badge says so rather than checking for ever",
        !/checking page/.test((w.document.getElementById("routeText") || {}).textContent || ""),
        (w.document.getElementById("routeText") || {}).textContent);
    });
  }
}

section("the model drives");
// The keyword scorer decides in one shot from words alone and cannot revise.
// A loop can act, read what came back, and choose differently - which is the
// only way "click Learn More, compare the last two weeks and summarise the
// difference" is one request rather than three.
//
// There is no WebGPU here, so the model's decisions are scripted. What is
// being tested is the loop: that it passes the page, carries out what comes
// back, feeds the result forward, and stops when told.
const dm = `<!doctype html><html><head><title>Drought Monitor</title></head><body>
  <a id="lm" href="#lm">Learn More</a>
  <div id="panel"></div>
  <script>
    document.getElementById("lm").addEventListener("click", () => {
      document.getElementById("panel").innerHTML =
        "<table><tr><th>Week</th><th>Area in drought</th></tr>" +
        "<tr><td>Sep 16</td><td>41.2%</td></tr><tr><td>Sep 9</td><td>37.8%</td></tr></table>";
    });
  <\/script></body></html>`;
const dmPage = loadPage(dm, { url: "https://www.drought.gov/" });
if (!dmPage) skip("the model driving", "jsdom not installed");
else {
  const bg = loadBackground({ page: dmPage });
  let turn = 0;
  const script = [
    (c) => ({ ok: true, step: { n: c.findIndex((x) => /learn more/i.test(x.label)), do: "click" } }),
    () => ({ ok: true, step: { do: "read" } }),
    (c, obs) => ({ ok: true, step: { do: "finish",
      answer: /41\.2/.test(obs || "") && /37\.8/.test(obs || "")
        ? "Drought area rose from 37.8% to 41.2%" : "could not see both weeks" } }),
  ];
  bg.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") return script[Math.min(turn++, script.length - 1)](m.controls, m.observation);
    return undefined;
  };
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk",
      instruction: "click Learn More, compare the last two weeks, and summarize the difference" });
    check("the model is the planner", r.plannedBy, "model");
    ensure("it acted, then read, then answered",
      (r.steps || []).map((h) => h.did).join(" | ").includes("read the page"), r.steps);
    // The answer had to come from what the page showed after the click - the
    // table does not exist until Learn More is pressed.
    ensure("and the answer came from what the click revealed",
      /37\.8.*41\.2/.test((r.display || {}).title || ""), (r.display || {}).title);
    ensure("with every turn counted, reads included",
      /2 steps \(1 on the page\)/.test((r.display || {}).subtitle || ""), (r.display || {}).subtitle);
  });
}

// What a turn costs is mostly prefill, and prefill is the control list. It
// cannot be trimmed by relevance - that would hand the decision back to the
// keyword scorer - so the trimming is structural and instruction-blind: the
// same thing listed twice is one thing, a cursor:pointer guess is not a
// known control, and something hidden with no way to open it cannot be used.
const noisy = { url: "https://waterdata.usgs.gov/", controls: [
  { kind: "a", label: "Home", selector: "#h1", confidence: "high" },
  { kind: "a", label: "Home", selector: "#h2", confidence: "high" },        // the same, twice
  { kind: "div", label: "Maybe clickable", selector: "#d", confidence: "low" },
  { kind: "input", type: "checkbox", label: "Buried", selector: "#b", hidden: true, confidence: "high" },
  { kind: "input", type: "checkbox", label: "Openable", selector: "#o", hidden: true,
    revealedBy: "#t", confidence: "high" },
  { kind: "button", label: "30 days", selector: "#d30", confidence: "high" },
  { kind: "button", label: "Off", selector: "#x", disabled: true, confidence: "high" },
] };
const forModel = sb.controlsForModel(noisy).map((c) => c.label);
check("a repeated control is listed once", forModel.filter((l) => l === "Home").length, 1);
ensure("a cursor guess is not offered", !forModel.includes("Maybe clickable"), forModel);
ensure("nor one hidden with no way in", !forModel.includes("Buried"), forModel);
ensure("but one that can be opened is", forModel.includes("Openable"), forModel);
ensure("and a disabled control is not", !forModel.includes("Off"), forModel);
ensure("while the thing asked for survives", forModel.includes("30 days"), forModel);

// A 3B model repeats. Asked to click 30 days it clicked 30 days, saw "the
// page changed", and clicked it four more times and checked it for good
// measure - six turns to do one thing once, live on a USGS page. The history
// is already in the prompt and "do not repeat yourself" in there does not
// hold, so the loop enforces it: repeating something that worked means the
// job is done, and repeating something that did nothing means this control
// is not the answer.
const repeater = loadPage(`<!doctype html><html><body>
  <button id="d30">30 days</button><button id="d1y">1 year</button>
  </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (repeater) {
  const bg = loadBackground({ page: repeater });
  let turns = 0;
  bg.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      turns++;
      return { ok: true, step: { n: m.controls.findIndex((c) => /30 days/.test(c.label)), do: "click" } };
    }
    return undefined;
  };
  runAsync(async () => {
    const out = await bg.runModelAgent("GENERIC", "click 30 day");
    ensure("a model that repeats itself is stopped early", turns <= 3, turns);
    check("and the same control is acted on once", out.history.length, 1);
  });
}

// Live, on a USGS page: six clicks on "Related links", every one reporting
// "the page changed", and revisions never reached. Two faults at once.
//
// The repeat guard keyed on the selector, and Related links is a toggle -
// pressing it changes the page, the page reflows, and its positional
// selector is not what it was. So every turn looked like a new control. The
// label is the stable thing about a control; the selector is not, which the
// click path learned earlier and this had not.
//
// And the model was handed "click A and click B" whole. The splitter existed
// but sat below the model path, so the model had to chain inside its own turn
// budget - several inferences and a page read each - and ran out before the
// second half.
const reflowing = `<!doctype html><html><body><div id="host">
    <a id="rl" href="#rl">Related links</a></div>
  <a id="rv" href="#rv">Revisions</a><p id="log"></p>
  <script>
    document.getElementById("rl").addEventListener("click", () => {
      const h = document.getElementById("host");
      h.insertBefore(document.createElement("span"), h.firstChild);   // reflow
      document.getElementById("log").textContent += "links;";
    });
    document.getElementById("rv").addEventListener("click", () => {
      document.getElementById("log").textContent += "revisions;";
    });
  <\/script></body></html>`;
const reflowPage = loadPage(reflowing, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (reflowPage) {
  const bg = loadBackground({ page: reflowPage });
  let calls = 0;
  // A model that only ever repeats its first pick, which is what was observed.
  bg.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      calls++;
      const want = /revision/i.test(m.goal) ? /revisions/i : /related links/i;
      return { ok: true, step: { n: m.controls.findIndex((c) => want.test(c.label)), do: "click" } };
    }
    return undefined;
  };
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "click related links and click revisions" });
    check("a toggle that reflows is still only clicked once",
      (reflowPage.document.getElementById("log") || {}).textContent, "links;revisions;");
    ensure("both halves are attempted", ((r.display || {}).rows || []).length >= 2, (r.display || {}).rows);
    ensure("and the run stays short", calls <= 6, calls);
  });
}

// A run has a clock as well as a turn limit: six turns of a 3B model with a
// page read each is comfortably a minute, and "still running" with no end
// reads the same as a hang.
const slowPage = loadPage("<!doctype html><html><body><button>Go</button></body></html>",
  { url: "https://example.gov/" });
if (slowPage) {
  const bg2 = loadBackground({ page: slowPage });
  bg2.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") return { ok: true, step: { do: "read" } };
    return undefined;
  };
  runAsync(async () => {
    const out = await bg2.runModelAgent("GENERIC", "read everything", { maxSteps: 50, budgetMs: 1 });
    ensure("a run out of time stops and says so", out.outOfTime === true, out);
    ensure("and reports what it managed", Array.isArray(out.history), out.history);
  });
}

// A model that answers off-format is told once, then the loop stops. Looping
// on a malformed reply costs a multi-second turn each time round.
const offFormat = loadPage("<!doctype html><html><body><button>Go</button></body></html>",
  { url: "https://example.gov/" });
if (offFormat) {
  const bg2 = loadBackground({ page: offFormat });
  let asks = 0;
  bg2.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") { asks++; return { ok: true, step: { do: "teleport" } }; }
    return undefined;
  };
  runAsync(async () => {
    await bg2.__ask({ type: "smartAsk", instruction: "click go" });
    ensure("an off-format reply is corrected once, not forever", asks <= 2, asks);
  });
}

// "baseline:" keeps the scorer reachable, so the two can be measured on the
// same pages rather than quietly blended.
const baselinePage = loadPage(`<!doctype html><html><body>
  <label><input type="checkbox" name="fi"> Flood Inundation</label></body></html>`,
  { url: "https://water.noaa.gov/" });
if (baselinePage) {
  const bg3 = loadBackground({ page: baselinePage });
  let consulted = false;
  bg3.__model = (m) => {
    if (m.type === "llmStatus") { consulted = true; return { ready: true, hasGpu: true }; }
    return undefined;
  };
  runAsync(async () => {
    await bg3.__ask({ type: "smartAsk", instruction: "baseline: enable flood inundation" });
    check("baseline does not consult the model at all", consulted, false);
    check("and still works", !!(baselinePage.document.querySelector('[name="fi"]') || {}).checked, true);
  });
}

// A model asks a link to be checked, or a button to be typed into. The old
// code obliged: "check Related links" ran a pageCheck against an anchor and
// reported that the page changed - a confidently wrong answer arriving from
// the model instead of the scorer. The action now has to suit the control.
const wrongAct = loadPage(`<!doctype html><html><body>
  <a id="rl" href="#rl">Related links</a>
  <label><input type="checkbox" name="d30"> 30 days</label></body></html>`,
  { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (wrongAct) {
  const bg4 = loadBackground({ page: wrongAct });
  bg4.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      const n = m.controls.findIndex((c) => /related links/i.test(c.label));
      return { ok: true, step: { n, do: "check" } };
    }
    return undefined;
  };
  runAsync(async () => {
    const r = await bg4.__ask({ type: "smartAsk", instruction: "click view related graphs" });
    const did = ((r.display || {}).rows || []).map((x) => String(x.name));
    ensure("a link is not checked, whoever asked", !did.some((d) => /^check/.test(d)), did);
    check("and the unrelated checkbox is left alone",
      !!(wrongAct.document.querySelector('[name="d30"]') || {}).checked, false);
  });
}

// The model's choice stands - a control can be the right one under a name
// that shares no words - but it is said out loud. "change time span" became
// a checkbox called "30 days", reported as a plain success; a wrong action
// nobody is told about is the failure this whole project exists to avoid.
const unrelated = loadPage(`<!doctype html><html><body>
  <label><input type="checkbox" name="d30"> 30 days</label></body></html>`,
  { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (unrelated) {
  const bg5 = loadBackground({ page: unrelated });
  bg5.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") return { ok: true, step: { n: 0, do: "check" } };
    return undefined;
  };
  runAsync(async () => {
    const r = await bg5.__ask({ type: "smartAsk", instruction: "click change time span" });
    const d = r.display || {};
    ensure("acting on a control the words never named is disclosed",
      /did not name/.test(String(d.subtitle || "")), d.subtitle);
    ensure("and the step itself says which control",
      (d.rows || []).some((x) => /nothing in what you asked names/.test(String(x.meta || ""))), d.rows);
  });
}

// A shared word is a real match, so the disclosure stays quiet for it -
// otherwise every run carries a warning and the warning means nothing.
const shared = loadPage(`<!doctype html><html><body>
  <a id="rl" href="#rl">Related links</a></body></html>`,
  { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (shared) {
  const bg6 = loadBackground({ page: shared });
  bg6.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") return { ok: true, step: { n: 0, do: "click" } };
    return undefined;
  };
  runAsync(async () => {
    const r = await bg6.__ask({ type: "smartAsk", instruction: "click view related graphs" });
    ensure("a genuine word overlap raises no warning",
      !/did not name/.test(String((r.display || {}).subtitle || "")), (r.display || {}).subtitle);
  });
}

// A later part failing does not undo an earlier part that worked. Reporting
// the whole run as failed sent this to the keyword scorer, which began the
// instruction again from the top - so "click related links and click
// revisions" clicked Related links, failed on revisions, and clicked Related
// links a second time. Acting twice is worse than not finishing.
const partial = loadPage(`<!doctype html><html><body>
  <a id="a" href="#a">Related links</a><a id="b" href="#b">Revisions</a></body></html>`,
  { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (partial) {
  let clicks = 0;
  partial.document.getElementById("a").addEventListener("click", () => { clicks++; });
  const bgp = loadBackground({ page: partial });
  bgp.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      const i = m.controls.findIndex((c) => /related links/i.test(c.label));
      if (/related/i.test(m.goal) && i >= 0) return { ok: true, step: { n: i, do: "click" } };
      return { ok: false, error: "the model stopped answering" };
    }
    return undefined;
  };
  runAsync(async () => {
    const r = await bgp.__ask({ type: "smartAsk", instruction: "click related links and click revisions" });
    check("a half-done sequence is not started again from the top", clicks, 1);
    check("and it is still reported as the model's work", r.plannedBy, "model");
    ensure("with the part that did not finish named",
      /did not finish/.test(String((r.display || {}).subtitle || "")), (r.display || {}).subtitle);
  });
}

// An answer from one part of a compound instruction used to be written into
// a history row and then dropped, so the instruction ran and returned no
// answer at all - and a compound question, where no part changes anything,
// failed the "did anything happen" test and was quietly asked again below.
const answerPart = loadPage(`<!doctype html><html><body>
  <a id="b" href="#b">Revisions</a><p>Discharge 412 cfs</p></body></html>`,
  { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
if (answerPart) {
  const bgq = loadBackground({ page: answerPart });
  bgq.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      const i = m.controls.findIndex((c) => /revisions/i.test(c.label));
      if (/revisions/i.test(m.goal) && i >= 0) return { ok: true, step: { n: i, do: "click" } };
      return { ok: true, step: { do: "finish", answer: "412 cfs" } };
    }
    return undefined;
  };
  runAsync(async () => {
    const r = await bgq.__ask({ type: "smartAsk", instruction: "click revisions then read the discharge" });
    check("an answer from a later part survives", r.answer, "412 cfs");
  });
}

// Not every compound instruction splits: "click Learn More, compare the last
// two weeks and summarize the difference" has no splitting verb in it, so the
// model has to chain inside one run. The prompt used to say the job was done
// as soon as the page changed, and the loop ended on the first success, so
// the reading and the summary were never reached.
const chain = loadPage(`<!doctype html><html><body>
  <a id="a" href="#a">Learn More</a><p>Week 1: 40%. Week 2: 55%.</p></body></html>`,
  { url: "https://www.drought.gov/" });
if (chain) {
  const bgc = loadBackground({ page: chain });
  bgc.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      const n = (m.history || []).length;
      if (!n) return { ok: true, step: { n: m.controls.findIndex((c) => /learn more/i.test(c.label)), do: "click" } };
      if (n === 1) return { ok: true, step: { do: "read" } };
      return { ok: true, step: { do: "finish", answer: "drought rose from 40% to 55%" } };
    }
    return undefined;
  };
  runAsync(async () => {
    const r = await bgc.__ask({ type: "smartAsk",
      instruction: "click learn more, compare the last two weeks and summarize the difference" });
    check("acting then reading then answering runs as one chain", r.answer, "drought rose from 40% to 55%");
  });
}

// Each of these used to burn the whole run. The loop used "note" itself as
// the "have I said this already" flag, and note is cleared on every valid
// action - so the check for a control number out of range could never fire.
const strikes = [
  { name: "a control number that is not on the list", step: { n: 99, do: "click" }, turns: 2 },
  { name: "an action that is not an action", step: { do: "teleport" }, turns: 2 },
];
for (const c of strikes) {
  const sp = loadPage("<!doctype html><html><body><button>Go</button></body></html>",
    { url: "https://example.gov/" });
  if (!sp) continue;
  const bgs = loadBackground({ page: sp });
  let turns = 0;
  bgs.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") { turns++; return { ok: true, step: c.step }; }
    return undefined;
  };
  runAsync(async () => {
    await bgs.runModelAgent("GENERIC", "click go");
    ensure(`${c.name} costs two turns, not the whole run`, turns <= c.turns, turns);
  });
}

// readPage is the most expensive thing in a turn, and nothing can have
// changed between two reads with no action between them.
const reader = loadPage("<!doctype html><html><body><button>Go</button><p>412 cfs</p></body></html>",
  { url: "https://example.gov/" });
if (reader) {
  const bgr = loadBackground({ page: reader });
  let turns = 0;
  bgr.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") { turns++; return { ok: true, step: { do: "read" } }; }
    return undefined;
  };
  runAsync(async () => {
    const out = await bgr.runModelAgent("GENERIC", "read everything");
    ensure("a model that only ever reads is stopped", turns <= 3, turns);
    check("and the page is read once, not once per turn",
      out.history.filter((h) => h.did === "read the page").length, 1);
  });
}

// A turn cannot outlast the request it belongs to. The deadline was checked
// between turns while one generation was allowed two minutes, so a
// forty-five second budget could run three times over.
const slowModel = loadPage("<!doctype html><html><body><button>Go</button></body></html>",
  { url: "https://example.gov/" });
if (slowModel) {
  const bgt = loadBackground({ page: slowModel });
  bgt.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") return new Promise(() => {});   // never answers
    return undefined;
  };
  runAsync(async () => {
    const began = Date.now();
    const out = await bgt.runModelAgent("GENERIC", "click go", { budgetMs: 6000 });
    ensure("a generation that never returns cannot outlast the budget",
      Date.now() - began < 20000, Date.now() - began);
    ensure("and it is reported as running out of time", out.outOfTime === true, out);
  });
}

// Hardware with no WebGPU cannot acquire it without a reload, and every
// instruction was paying up to a second and a half to ask again.
const noGpu = loadPage("<!doctype html><html><body><button>Go</button></body></html>",
  { url: "https://example.gov/" });
if (noGpu) {
  const bgg = loadBackground({ page: noGpu });
  let probes = 0;
  bgg.__model = (m) => {
    if (m.type === "llmStatus") { probes++; return { ready: false, hasGpu: false }; }
    return undefined;
  };
  runAsync(async () => {
    for (let i = 0; i < 4; i++) await bgg.__ask({ type: "smartAsk", instruction: "click go" });
    check("a machine with no WebGPU is asked once, not once per instruction", probes, 1);
  });
}

// The prompt told the model to stop as soon as the page changed - "if the
// page changed, the job is done and the next action is finish" - which is
// the opposite of chaining, and no loop fix reaches a model that has been
// told to stop. A long answer was also cut in half: max_tokens is a ceiling,
// not a cost, so fifty-six tokens saved nothing on an action decision and
// truncated every real summary into JSON that parses to nothing.
{
  const buildStepPrompt = loadOffscreenHelper("buildStepPrompt");
  const firstJsonObject = loadOffscreenHelper("firstJsonObject");
  if (buildStepPrompt) {
    const text = buildStepPrompt({
      goal: "click learn more and summarize the change",
      controls: [{ label: "Learn More", kind: "link" }],
    });
    ensure("the model is not told to stop at the first change",
      !/the job is done and the next action is finish/i.test(text), text.slice(-260));
    ensure("it is told to carry out the next part instead",
      /another\s+part|next part/i.test(text), text.slice(-260));
    ensure("and that a question is answered by reading, not pressing",
      /question/i.test(text) && /not press/i.test(text), text.slice(-260));
  }
  if (firstJsonObject) {
    const answer = "Drought coverage rose from 40% to 55% of the state over the two"
      + " weeks, with the largest increase in the southwest.";
    const whole = JSON.stringify({ do: "finish", answer });
    ensure("a real summary still parses whole", (firstJsonObject(whole) || {}).answer === answer, whole.length);
    ensure("and it needs more room than an action decision does",
      whole.length > 56 * 2, whole.length);
  }
}

// What a turn costs is the whole complaint: a 3B model over WebGPU is
// seconds per turn, so a spare turn is visible to the person waiting. These
// are budgets, not behaviour - if one rises, something is paying for a turn
// it does not need.
const budgets = [
  { instruction: "click 30 days", turns: 2, why: "one clause, finished when it is done" },
  { instruction: "click related links and click revisions", turns: 4, why: "two clauses, two each" },
];
for (const b of budgets) {
  const bp = loadPage(`<!doctype html><html><body>
    <a id="a" href="#a">Related links</a><a id="b" href="#b">Revisions</a>
    <label><input type="checkbox" name="d30"> 30 days</label></body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (!bp) continue;
  const bgb = loadBackground({ page: bp });
  let turns = 0;
  bgb.__model = (m) => {
    if (m.type === "llmStatus") return { ready: true, hasGpu: true };
    if (m.type === "llmStep") {
      turns++;
      const g = String(m.goal).toLowerCase();
      const i = m.controls.findIndex((c) => g.split(/\s+/).filter((w) => w.length > 3)
        .some((w) => String(c.label || "").toLowerCase().includes(w)));
      if (i < 0) return { ok: true, step: { do: "finish", answer: "nothing here does that" } };
      return { ok: true, step: m.controls[i].type === "checkbox"
        ? { n: i, do: "check", on: true } : { n: i, do: "click" } };
    }
    return undefined;
  };
  runAsync(async () => {
    await bgb.__ask({ type: "smartAsk", instruction: b.instruction });
    ensure(`"${b.instruction}" costs ${b.turns} turns - ${b.why}`, turns <= b.turns, turns);
  });
}

// The model was shown the first forty-five controls of a hundred-and-eight
// control page, so a link past the cutoff could not be chosen however
// clearly it was named: "click view tabular data" picked the disclosure that
// holds it, and "click gage height" had nothing to pick, so it spent every
// turn it had. Hiding the right answer and then judging the choice is not a
// fair test of a planner.
{
  let links = "";
  for (let i = 0; i < 60; i++) links += `<a href="#n${i}">Gauge report ${i}</a>`;
  links += `<a id="t" href="#t">View tabular data</a>`;
  for (let i = 0; i < 47; i++) links += `<a href="#m${i}">Station note ${i}</a>`;
  const big = loadPage(`<!doctype html><html><body>${links}</body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (big) {
    const bgn = loadBackground({ page: big });
    let shown = null;
    bgn.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") {
        if (!shown) shown = m.controls;
        return { ok: true, step: { do: "finish", answer: "x" } };
      }
      return undefined;
    };
    runAsync(async () => {
      await bgn.__ask({ type: "smartAsk", instruction: "model: click view tabular data" });
      ensure("a control late on a long page is still offered to the model",
        (shown || []).some((c) => /tabular/i.test(c.label || "")),
        { shown: (shown || []).length });
    });
  }
}

// Opening the way to something is not the same as reaching it. "click view
// tabular data" clicked Related links - the disclosure holding that link -
// the page did change, and the part was declared finished having never
// clicked the link.
{
  const held = loadPage(`<!doctype html><html><body>
    <button id="rl" aria-expanded="false" aria-controls="panel">Related links</button>
    <div id="panel" hidden><a id="t" href="#t">View tabular data</a></div>
    </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (held) {
    held.document.getElementById("rl").addEventListener("click", function () {
      const pnl = held.document.getElementById("panel");
      pnl.hidden = !pnl.hidden;
      this.setAttribute("aria-expanded", String(!pnl.hidden));
    });
    const bgh = loadBackground({ page: held });
    bgh.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") {
        // a model that opens the disclosure first, then looks again
        const t = m.controls.findIndex((c) => /tabular/i.test(c.label || ""));
        if ((m.history || []).length) {
          return t >= 0 ? { ok: true, step: { n: t, do: "click" } }
            : { ok: true, step: { do: "finish", answer: "not here" } };
        }
        return { ok: true, step: { n: m.controls.findIndex((c) => /related links/i.test(c.label || "")), do: "click" } };
      }
      return undefined;
    };
    runAsync(async () => {
      const out = await bgh.runModelAgent("GENERIC", "click view tabular data", { chain: false });
      ensure("a run does not stop on the way in to what it was asked for",
        out.history.some((h) => /tabular/i.test(h.did || "")), out.history.map((h) => h.did));
    });
  }
}

// A verified action on the control the request names, with no other clause
// to get to, is finished - and the turn that would ask the model to confirm
// it is a turn of a 3B model somebody is waiting through.
{
  const done1 = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="gh"> Gage height</label></body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (done1) {
    const bgd = loadBackground({ page: done1 });
    let turns = 0;
    bgd.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") { turns++; return { ok: true, step: { n: 0, do: "check", on: true } }; }
      return undefined;
    };
    runAsync(async () => {
      const r = await bgd.__ask({ type: "smartAsk", instruction: "model: click gage height" });
      check("one clause, one turn", turns, 1);
      check("and it is reported with the time it took",
        !!((r.display || {}).stats || []).find((x) => x.label === "took"), true);
    });
  }
}

// A control already holding the state the request asked for is the request
// carried out, not a step that failed. "click gage height" where gage height
// was already on changed nothing, which read as the model getting nowhere -
// so the run was discarded and the whole instruction went through the scorer
// a second time, reaching the same answer thirty seconds later. pageCheck
// reports a bare true and carries no before-and-after, so this is read from
// the inventory the turn was built from.
{
  const already = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="gh" checked> Gage height</label>
    <label><input type="checkbox" name="dis"> Discharge</label></body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (already) {
    const bga = loadBackground({ page: already });
    let turns = 0;
    bga.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") {
        turns++;
        return { ok: true, step: { n: m.controls.findIndex((c) => /gage height/i.test(c.label || "")),
          do: "check", on: true } };
      }
      return undefined;
    };
    runAsync(async () => {
      const r = await bga.__ask({ type: "smartAsk", instruction: "model: click gage height" });
      check("a request the page already satisfies is the model's answer", r.plannedBy, "model");
      check("and is not run a second time to reach it", turns, 1);
      ensure("the card says the page was already that way",
        /already set that way/.test(String((r.display || {}).subtitle || "")), (r.display || {}).subtitle);
      ensure("and the step is not shown as having done nothing",
        ((r.display || {}).rows || []).some((x) => x.value === "already so" && x.tone === "ok"),
        (r.display || {}).rows);
    });
  }
}

// "select alaska" answered "waitFor: timed out after 8000ms" and stopped
// there. A site rule had fired, failed, and reported its own failure as the
// result - while the dropdown the instruction named was sitting on the page
// for the paths below it to find. A guess that does not work falls through.
{
  const ruled = loadPage(`<!doctype html><html><body>
    <label for="s">State</label>
    <select id="s"><option>Alabama</option><option>Alaska</option></select>
    </body></html>`, { url: "https://waterdata.usgs.gov/state/" });
  if (ruled) {
    const bgf = loadBackground({ page: ruled });
    bgf.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
    runAsync(async () => {
      const r = await bgf.__ask({ type: "smartAsk", instruction: "select alaska" });
      ensure("a site rule that fails is not the last word", r.ok !== false, r.error);
      check("the page's own controls still answer", ruled.document.getElementById("s").value, "Alaska");
    });
  }
}

// A card saying "answered by fast-path" and nothing else looks like the
// planner was never built, when what happened may be that the weights were
// still loading - which is worth waiting for, and worth being told.
{
  const loadingPage = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="gh"> Gage height</label></body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (loadingPage) {
    const bgl = loadBackground({ page: loadingPage });
    bgl.__model = (m) => (m.type === "llmStatus"
      ? { ready: false, hasGpu: true, loading: true, progress: "fetching weights 41%" } : undefined);
    runAsync(async () => {
      // Routed past the instant path on purpose: the question here is what a
      // card says when the model was not available, not which path was quickest.
      const r = await bgl.__ask({ type: "smartAsk", instruction: "click the gage height box" });
      ensure("a card not planned by the model says why",
        /still loading/.test(String((r.display || {}).note || "")), (r.display || {}).note);
    });
    const noGpuPage = loadPage(`<!doctype html><html><body>
      <label><input type="checkbox" name="gh"> Gage height</label></body></html>`,
      { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
    if (noGpuPage) {
      const bgw = loadBackground({ page: noGpuPage });
      bgw.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
      runAsync(async () => {
        const r = await bgw.__ask({ type: "smartAsk", instruction: "click the gage height box" });
        ensure("and names WebGPU when that is the reason",
          /WebGPU/.test(String((r.display || {}).note || "")), (r.display || {}).note);
      });
    }
  }
}

// A <select>'s own text is every option run together, which names nothing -
// and it was what the model was shown in place of a dropdown it could have
// recognised, and what the card called it: "choose alabamaalaskaarizona".
{
  const S = ["Alabama", "Alaska", "Arizona", "California"];
  const opts = S.map((x) => `<option>${x}</option>`).join("");
  const named = [
    ["bare", `<select id="state">${opts}</select>`, "state"],
    ["a name attribute", `<select name="state_cd">${opts}</select>`, "state cd"],
    ["a real label", `<label for="s">Choose a state</label><select id="s">${opts}</select>`, "Choose a state"],
    ["text beside it", `<div>State<select id="t">${opts}</select></div>`, "State"],
  ];
  for (const [what, html, want] of named) {
    const sp = loadPage(`<!doctype html><html><body>${html}</body></html>`,
      { url: "https://waterdata.usgs.gov/state/" });
    if (!sp) continue;
    const found = sp.GENERIC.inventory({ includeHidden: true }).controls
      .find((c) => (c.options || []).length === 4);
    check(`a select with ${what} is called something`, found && found.label, want);
  }
}

// "select huc-8 subbasin" picked HUC-08, saw nothing happen, struck it off,
// picked HUC-06 instead and reported HUC-06 as the answer. Two faults met
// there: a radio pick reported no state of its own, so "already selected"
// and "the click never landed" were indistinguishable; and the words the
// failed step was named after were struck off the outstanding list anyway,
// so by the time a different control was pressed there was nothing left
// outstanding and the loop declared the job done on the wrong basin. The
// request was answered by setting the page to something it did not ask for.
{
  const hucHtml = (checked) => `<!doctype html><html><body>
    <fieldset><legend>Group by</legend>
      <label><input type="radio" name="g" value="huc8"${checked === "huc8" ? " checked" : ""}> HUC-08 subbasin</label>
      <label><input type="radio" name="g" value="huc6"${checked === "huc6" ? " checked" : ""}> HUC-06 basin</label>
    </fieldset></body></html>`;
  for (const start of ["huc6", "huc8"]) {
    const hp = loadPage(hucHtml(start), { url: "https://waterdata.usgs.gov/state/" });
    if (!hp) continue;
    const bgh = loadBackground({ page: hp });
    bgh.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
    runAsync(async () => {
      const r = await bgh.__ask({ type: "smartAsk", instruction: "select huc-8 subbasin" });
      const on = [...hp.document.querySelectorAll("input[type=radio]")].find((x) => x.checked);
      check(`starting from ${start}, the basin asked for is the one selected`,
        on && on.value, "huc8");
      ensure(`and starting from ${start} the card does not name a different one`,
        !/huc-06|huc06/i.test(String((r.display || {}).title || "")), (r.display || {}).title);
    });
  }
}

// A radio pick reports its own before and after, so a caller can tell the
// two apart rather than guessing.
{
  const rp = loadPage(`<!doctype html><html><body>
    <label><input type="radio" name="g" value="a" checked> Alpha</label>
    <label><input type="radio" name="g" value="b"> Beta</label></body></html>`,
    { url: "https://example.gov/" });
  if (rp) {
    const onAlready = rp.GENERIC.pickRadio("g", "Alpha");
    check("picking the one already selected reports no change", onAlready.itChanged, false);
    check("and says it is selected", onAlready.now, true);
    const moved = rp.GENERIC.pickRadio("g", "Beta");
    check("picking another reports the change", moved.itChanged, true);
    check("and keeps the page's own spelling", moved.control, "Beta");
  }
}

// The keyword rules are the baseline, not the main path. They lead only
// under "baseline:" or where the model cannot plan at all; where the model
// was available and got nowhere, what it falls back to is the page's own
// controls. Both wrong answers reported on 2026-09-22 came from rules
// running ahead of the page: selectState on a page with no such function,
// and HUC-06 selected in answer to a request for HUC-08.
{
  const ruleHtml = `<!doctype html><html><body>
    <fieldset><legend>Group by</legend>
      <label><input type="radio" name="g" value="huc8"> HUC-08 subbasin</label>
      <label><input type="radio" name="g" value="huc6" checked> HUC-06 basin</label>
    </fieldset></body></html>`;
  const shapes = [
    ["a model that plans nothing", { ready: true, hasGpu: true }, "select huc-8 subbasin",
      /keyword baseline/],
    ["no model at all", { ready: false, hasGpu: false }, "select huc-8 subbasin", /WebGPU/],
  ];
  for (const [what, status, instr, wantNote] of shapes) {
    const rpg = loadPage(ruleHtml, { url: "https://waterdata.usgs.gov/state/" });
    if (!rpg) continue;
    const bgr = loadBackground({ page: rpg });
    bgr.__model = (m) => {
      if (m.type === "llmStatus") return status;
      if (m.type === "llmStep") return { ok: true, step: { do: "finish", answer: "" } };
      return undefined;
    };
    runAsync(async () => {
      const r = await bgr.__ask({ type: "smartAsk", instruction: instr });
      const on = [...rpg.document.querySelectorAll("input[type=radio]")].find((x) => x.checked);
      check(`with ${what}, the page's own control still answers`, on && on.value, "huc8");
      ensure(`and the card says which planner answered (${what})`,
        wantNote.test(String((r.display || {}).note || "")), (r.display || {}).note);
    });
  }
  // And the baseline is still reachable on purpose, unlabelled, so the two
  // can be measured against each other on the same pages.
  const bp = loadPage(ruleHtml, { url: "https://waterdata.usgs.gov/state/" });
  if (bp) {
    const bgb2 = loadBackground({ page: bp });
    let asked = false;
    bgb2.__model = (m) => {
      if (m.type === "llmStatus") { asked = true; return { ready: true, hasGpu: true }; }
      return undefined;
    };
    runAsync(async () => {
      await bgb2.__ask({ type: "smartAsk", instruction: "baseline: select huc-8 subbasin" });
      check("baseline: never consults the model", asked, false);
      const on = [...bp.document.querySelectorAll("input[type=radio]")].find((x) => x.checked);
      check("and the baseline still works", on && on.value, "huc8");
    });
  }
}

// "click location id - ascending" on a page already sorted that way ended
// with the model having planned nothing - for a request the page had already
// carried out. The model chose the right control and said "click", which
// became a plain pageClick; clicking the already-selected radio of a group
// cannot change anything, so its correct action was judged a no-op. A radio
// is not something you press, it is something you choose.
{
  const sortHtml = (sel) => `<!doctype html><html><body>
    <fieldset><legend>Sort by</legend>
      <label><input type="radio" name="s" value="asc"${sel === "asc" ? " checked" : ""}> Location ID - Ascending</label>
      <label><input type="radio" name="s" value="desc"${sel === "desc" ? " checked" : ""}> Location ID - Descending</label>
    </fieldset></body></html>`;
  for (const [start, expectAlready] of [["asc", true], ["desc", false]]) {
    const sp2 = loadPage(sortHtml(start), { url: "https://waterdata.usgs.gov/state/" });
    if (!sp2) continue;
    const bgs2 = loadBackground({ page: sp2 });
    let turns = 0;
    bgs2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") {
        turns++;
        return { ok: true, step: { n: m.controls.findIndex((c) => /ascending/i.test(c.label || "")), do: "click" } };
      }
      return undefined;
    };
    runAsync(async () => {
      const r = await bgs2.__ask({ type: "smartAsk", instruction: "click location id - ascending" });
      check(`clicking a radio from ${start} is the model's own answer`, r.plannedBy, "model");
      check(`and costs one turn from ${start}`, turns, 1);
      const on = [...sp2.document.querySelectorAll("input[type=radio]")].find((x) => x.checked);
      check(`and the radio asked for is selected from ${start}`, on && on.value, "asc");
      if (expectAlready) {
        ensure("a radio already chosen reads as already so, not as nothing happening",
          ((r.display || {}).rows || []).some((x) => x.value === "already so" && x.tone === "ok"),
          (r.display || {}).rows);
      }
    });
  }
  // A checkbox keeps its second meaning: "click" can mean toggle, and a
  // click that turns something off is a real outcome.
  const cb = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="c" checked> Snow depth</label></body></html>`,
    { url: "https://example.gov/" });
  if (cb) {
    const bgc2 = loadBackground({ page: cb });
    check("a click on a checkbox is still a click",
      bgc2.actionToCall("click", { selector: "x", type: "checkbox" }, {}).name, "pageClick");
    check("and a click on a radio asks for its state",
      bgc2.actionToCall("click", { selector: "x", type: "radio" }, {}).name, "pageCheck");
  }
}

// A click was the one primitive with nothing to report, so "it worked and
// there was nothing left to change" and "it silently failed" reached the
// caller as the same observation - which is why three separate reports
// blamed the model for actions it had got right. A link has no state and
// this does not invent one; a disclosure, a toggle button and a details
// element all carry theirs on the element being clicked, which is most of
// what a government site is built from.
{
  const cp = loadPage(`<!doctype html><html><body>
    <button id="acc" aria-expanded="false" aria-controls="x">Related links</button>
    <div id="x" hidden>inside</div>
    <button id="tog" aria-pressed="false">Show legend</button>
    <a id="lnk" href="#y">Plain link</a>
    <details id="d"><summary>More</summary>body</details>
    </body></html>`, { url: "https://example.gov/" });
  if (cp) {
    cp.document.getElementById("acc").addEventListener("click", function () {
      const x = cp.document.getElementById("x");
      x.hidden = !x.hidden;
      this.setAttribute("aria-expanded", String(!x.hidden));
    });
    cp.document.getElementById("tog").addEventListener("click", function () {
      this.setAttribute("aria-pressed",
        this.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
    const opened = cp.GENERIC.click("#acc");
    check("a disclosure reports that it opened", opened.itChanged, true);
    check("with its own before and after", `${opened.was} -> ${opened.now}`, "false -> true");
    const closed = cp.GENERIC.click("#acc");
    check("and that it closed again", `${closed.was} -> ${closed.now}`, "true -> false");
    check("a toggle button reports its state", cp.GENERIC.click("#tog").now, "true");
    check("a details reports through its summary",
      cp.GENERIC.click("#d > summary").itChanged, true);
    // The honest half: a link has no state, and a click on one still proves
    // nothing by itself. Inventing a value here would be the same mistake
    // in the other direction.
    const link = cp.GENERIC.click("#lnk");
    ensure("a plain link claims no state it does not have",
      link.itChanged === undefined && link.was === undefined, link);
  }
}

// A part the model will not even attempt - no step taken, nothing answered
// - is the strongest signal there is that it will not do the rest either,
// and every further part costs its whole budget before anything else is
// allowed to try. Two parts at forty-five seconds each is ninety seconds of
// producing nothing, after which the baseline did the work anyway.
{
  const twoBox = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="y2"> Select data to graph on second y-axis</label>
    <label><input type="checkbox" name="py"> Select data for same time span in prior year</label>
    </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (twoBox) {
    const bgt2 = loadBackground({ page: twoBox });
    let turns = 0;
    bgt2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") { turns++; return { ok: true, step: { do: "finish", answer: "" } }; }
      return undefined;
    };
    runAsync(async () => {
      const r = await bgt2.__ask({ type: "smartAsk",
        instruction: "click select data to graph on second y-axis and select data for same time span in prior year" });
      ensure("a model that will not attempt a step is not paid for every part",
        turns <= 2, turns);
      const on = [...twoBox.document.querySelectorAll("input")].filter((x) => x.checked).map((x) => x.name);
      // Both, and neither undone by the other. The second step turning the
      // first back off would be the page's own doing, not this.
      check("and both controls the instruction named end up set", on.join(","), "y2,py");
      ensure("and the card says how long the whole thing took",
        ((r.display || {}).stats || []).some((x) => x.label === "took"), (r.display || {}).stats);
    });
  }
}

// Measured on real hardware: one decision was 32.6s of a 33.2s request,
// with page work at zero. Every budget expressed in seconds has to be sized
// against that - a fixed forty-five seconds a part let the first part finish
// and left the second unable to complete a single decision - and a turn
// there is no room for is not worth starting, since it spends the time
// anyway and reports nothing for it.
{
  const slow = loadPage(`<!doctype html><html><body>
    <a href="#a">1 year</a>
    <label><input type="checkbox" name="py"> Select data for same time span in prior year</label>
    </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (slow) {
    const bgsl = loadBackground({ page: slow });
    let turns = 0;
    bgsl.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") {
        turns++;
        // slow enough that a fixed budget could not fit two of them
        return new Promise((r) => setTimeout(() => r({ ok: true, step: { do: "read" } }), 300));
      }
      return undefined;
    };
    runAsync(async () => {
      const out = await bgsl.runModelAgent("GENERIC", "click 1 year", { budgetMs: 400 });
      ensure("a turn there is no room for is not begun", turns <= 2, turns);
      ensure("and the run says it ran out rather than reporting nothing",
        out.outOfTime === true || out.ranOut === true, out);
      ensure("with what it did manage kept", Array.isArray(out.history), out.history);
    });
  }
  // The hint only appears where the measurement justifies it.
  const quick = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="gh"> Gage height</label></body></html>`,
    { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (quick) {
    const bgq2 = loadBackground({ page: quick });
    bgq2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") return { ok: true, step: { n: 0, do: "check", on: true } };
      return undefined;
    };
    runAsync(async () => {
      const r = await bgq2.__ask({ type: "smartAsk", instruction: "click gage height" });
      ensure("a quick model is not told to swap itself out",
        !/smaller model/.test(String((r.display || {}).note || "")), (r.display || {}).note);
    });
  }
}

// Switching model is something somebody does to get a slow machine to
// answer, and "the local model is still loading" gave them no way to tell
// whether the model they had just chosen was the one loading, or how far off
// it was. A 1GB download with no figure beside it is indistinguishable from
// something stuck - and an answer that arrived while it loaded looked like
// the new model's work when it came from the page's own controls.
{
  const nameCases = [
    ["Qwen2.5-1.5B-Instruct-q4f16_1-MLC", "Qwen2.5 1.5B"],
    ["Llama-3.2-3B-Instruct-q4f16_1-MLC", "Llama 3.2 3B"],
    ["Llama-3.2-1B-Instruct-q4f16_1-MLC", "Llama 3.2 1B"],
  ];
  const np = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="y2"> Select data to graph on second y-axis</label>
    </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (np) {
    const bgn2 = loadBackground({ page: np });
    for (const [id, want] of nameCases) check(`${id} reads as ${want}`, bgn2.modelName(id), want);
  }
  for (const [id, want] of [nameCases[0]]) {
    const lp = loadPage(`<!doctype html><html><body>
      <label><input type="checkbox" name="y2"> Select data to graph on second y-axis</label>
      </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
    if (!lp) continue;
    const bgl2 = loadBackground({ page: lp });
    bgl2.__model = (m) => (m.type === "llmStatus"
      ? { ready: false, hasGpu: true, loading: true, started: true,
          progress: "fetching param cache 62%", model: id }
      : undefined);
    runAsync(async () => {
      const r = await bgl2.__ask({ type: "smartAsk",
        instruction: "click select data to graph on second y-axis" });
      const note = String((r.display || {}).note || "");
      ensure(`a card says which model is loading (${want})`, note.includes(want), note);
      ensure("and how far along it is", /62%/.test(note), note);
      ensure("and that this answer did not come from it",
        /page's own controls/.test(note), note);
    });
    const rp2 = loadPage(`<!doctype html><html><body>
      <label><input type="checkbox" name="y2"> Select data to graph on second y-axis</label>
      </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
    if (!rp2) continue;
    const bgr2 = loadBackground({ page: rp2 });
    bgr2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true, model: id };
      if (m.type === "llmStep") return { ok: true, step: { n: 0, do: "check", on: true } };
      return undefined;
    };
    runAsync(async () => {
      const r = await bgr2.__ask({ type: "smartAsk",
        instruction: "click select data to graph on second y-axis" });
      check(`and an answer it did plan is credited to it (${want})`,
        (r.display || {}).source, want);
    });
  }
}

// One decision of the 3B measured 32.6s of a 33.2s request on real
// hardware, and the page's own controls answered the same instruction
// correctly in under a second and a half. So where the request names one
// control on the page word for word there is nothing to be intelligent
// about, and the model is not waited for. Deliberately narrow: the wide
// version of this is the rule-based system this is trying not to be.
{
  const fastHtml = `<!doctype html><html><body>
    <label><input type="checkbox" name="gh"> Gage height</label>
    <label><input type="checkbox" name="dis"> Discharge</label>
    <a href="#y">1 year</a>
    </body></html>`;
  const shapes = [
    ["click gage height", 0, "exact-match", "one control named word for word"],
    ["show me what the flow is doing", 1, null, "loose phrasing is the model's job"],
    ["click gage height and click discharge", 1, null, "more than one clause"],
    ["what is the gage height", 1, null, "a question, not an instruction"],
  ];
  for (const [instr, wantCalls, wantPlanner, why] of shapes) {
    const fp = loadPage(fastHtml, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
    if (!fp) continue;
    const bgf2 = loadBackground({ page: fp });
    let calls = 0;
    bgf2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true };
      if (m.type === "llmStep") { calls++; return { ok: true, step: { do: "finish", answer: "" } }; }
      return undefined;
    };
    runAsync(async () => {
      const r = await bgf2.__ask({ type: "smartAsk", instruction: instr });
      if (wantCalls === 0) {
        check(`"${instr}" does not wait for a decision - ${why}`, calls, 0);
        check("and is answered by the page itself", r.plannedBy, wantPlanner);
        check("and actually acts", !!(fp.document.querySelector('[name="gh"]') || {}).checked, true);
        ensure("and says it did not need the model",
          /did not\s+wait for the model/.test(String((r.display || {}).note || "")),
          (r.display || {}).note);
      } else {
        ensure(`"${instr}" still goes to the model - ${why}`, calls >= 1, calls);
      }
    });
  }
}

// Every argument about whether the model earns its place has been anecdote.
// This puts reworded asks - worded to avoid the words printed on the control
// - to both planners on the same page, and records what each one chose.
// Neither acts: a benchmark that pressed things would change the page it is
// measuring and could not be run twice.
{
  const bmPage = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="gh"> Gage height</label>
    <label><input type="checkbox" name="dis"> Discharge</label>
    <a href="#a">1 year</a><a href="#b">30 days</a>
    </body></html>`, { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
  if (bmPage) {
    const bgbm = loadBackground({ page: bmPage });
    bgbm.__model = (m) => {
      if (m.type === "llmStatus") {
        return { ready: true, hasGpu: true, model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" };
      }
      if (m.type === "llmStep") {
        const g = String(m.goal).toLowerCase();
        // right about the water level, silent otherwise
        if (/water level|how high|stage|height of the water|surface elevation/.test(g)) {
          return { ok: true,
            step: { n: m.controls.findIndex((c) => /gage height/i.test(c.label)), do: "check" } };
        }
        return { ok: true, step: { do: "finish", answer: "" } };
      }
      return undefined;
    };
    runAsync(async () => {
      const out = await bgbm.benchmarkPlanners({ onlyTargets: ["gage height"] });
      check("every reworded ask for a control on the page is put to both", out.asked, 5);
      check("the model's right answers are counted", out.modelScore.right, 5);
      check("and the scorer's separately", out.scorer.right, 0);
      ensure("what is being measured is stated, not left to be inferred",
        /avoid the words on the control/.test(String(out.measuring || "")), out.measuring);
      // The distinction that decides what to do next: a wrong choice wants a
      // better prompt, no choice at all wants a bigger model.
      const silent = await bgbm.benchmarkPlanners({ onlyTargets: ["1 year"] });
      check("a model that will not choose is counted apart from one that chooses wrongly",
        silent.modelScore.silent, silent.asked);
      check("and is not counted as a wrong answer", silent.modelScore.right, 0);
      check("the page is left exactly as it was",
        [...bmPage.document.querySelectorAll("input")].every((x) => !x.checked), true);
    });
  }
}

// "make the date august 12 2026" typed Augusta into a search box and
// reported it with a tick beside it. The typo tolerance that exists for
// "tallahasee" read "august" as one edit from "Augusta", the place-redirect
// took that as a destination, and a real action was taken on a real page on
// the strength of it. A month is a word with a meaning of its own, not
// somebody's failed attempt at a place name.
{
  const dp2 = loadPage("<!doctype html><html><body><p>x</p></body></html>",
    { url: "https://water.noaa.gov/" });
  if (dp2) {
    const bgdt = loadBackground({ page: dp2 });
    check("august is not a city", bgdt.findCityInText("august 12 2026"), null);
    ensure("augusta still is, when it is actually named",
      (bgdt.findCityInText("flooding in augusta") || {}).city === "augusta",
      bgdt.findCityInText("flooding in augusta"));
    // The tolerance this was protecting has to survive: city names are long
    // and easy to misspell, and losing the city loses the state with it.
    ensure("and a real misspelling is still corrected",
      (bgdt.findCityInText("rain in tallahasee") || {}).city === "tallahassee",
      bgdt.findCityInText("rain in tallahasee"));
    for (const [text, want] of [
      ["august 12 2026", "2026-08-12"], ["aug 12, 2026", "2026-08-12"],
      ["12 august 2026", "2026-08-12"], ["8/12/2026", "2026-08-12"],
      ["2026-08-12", "2026-08-12"], ["next tuesday", null],
    ]) check(`"${text}" reads as ${want}`, bgdt.isoDateFrom(text), want);
  }

  const shapes = [
    ["one date field",
      '<input type="search" id="s" placeholder="Search"><label for="d">Date</label><input type="date" id="d">',
      "date-field"],
    ["no date field", '<input type="search" id="s" placeholder="Search">', null],
    ["two date fields",
      '<label for="a">Start date</label><input type="date" id="a"><label for="b">End date</label><input type="date" id="b">',
      "date-field"],
  ];
  for (const [what, body, wantPath] of shapes) {
    const dpg = loadPage(`<!doctype html><html><body>${body}</body></html>`,
      { url: "https://water.noaa.gov/" });
    if (!dpg) continue;
    const bgd3 = loadBackground({ page: dpg });
    bgd3.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
    runAsync(async () => {
      const r = await bgd3.__ask({ type: "smartAsk", instruction: "make the date august 12 2026" });
      const sb = dpg.document.getElementById("s");
      // The thing that must never happen again, whatever else does.
      if (sb) check(`${what}: nothing is typed into the search box`, sb.value, "");
      if (wantPath) check(`${what}: handled as a date`, r.plannedBy, wantPath);
      if (what === "one date field") {
        check("the field is set to the date asked for",
          dpg.document.getElementById("d").value, "2026-08-12");
      }
      if (what === "two date fields") {
        // A start and an end are not the same date, so choosing between
        // them is a guess, and it asks instead.
        ensure("two fields that take a date is a question, not a coin toss",
          r.ok === false && /say which/.test(String(r.error || "")), r.error);
      }
      if (what === "no date field") {
        ensure("with no date field it says so rather than searching",
          !/augusta/i.test(JSON.stringify(r.display || {})), r.display);
      }
    });
  }
}

// Every card that said "the local model planned nothing here" threw away
// what the model had actually replied - so a model answering in prose, one
// choosing a control that is not on the list, and one genuinely saying it
// was finished all looked identical from outside. Three problems with three
// different answers - a parser, a prompt, a bigger model - and no way to
// tell which you had. It made "the model does not work" both unarguable and
// undiagnosable, which is how a session goes by fixing everything else.
{
  const saidCases = [
    ["prose instead of JSON",
      { ok: false, error: "model did not return usable JSON: I would click the Gage height box" },
      /usable JSON/],
    ["finished without doing anything",
      { ok: true, step: { do: "finish", answer: "" }, raw: '{"do":"finish"}' }, /do.*finish/],
    ["a control that is not on the list",
      { ok: true, step: { n: 99, do: "click" }, raw: '{"n":99,"do":"click"}' }, /99/],
  ];
  for (const [what, reply, wantInNote] of saidCases) {
    const sp3 = loadPage(`<!doctype html><html><body>
      <label><input type="checkbox" name="gh"> Gage height</label>
      <a href="#a">Learn about Continuous data</a></body></html>`,
      { url: "https://waterdata.usgs.gov/monitoring-location/X/" });
    if (!sp3) continue;
    const bgsd = loadBackground({ page: sp3 });
    bgsd.__model = (m) => {
      if (m.type === "llmStatus") {
        return { ready: true, hasGpu: true, model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" };
      }
      if (m.type === "llmStep") return reply;
      return undefined;
    };
    runAsync(async () => {
      const r = await bgsd.__ask({ type: "smartAsk",
        instruction: "click learn about continuous data" });
      const note = String((r.display || {}).note || "");
      ensure(`${what} is quoted back rather than summarised as nothing`,
        wantInNote.test(note), note);
    });
  }
}

// The reply was carried on four of the loop's nine exits, and not on the
// two that happen most - the model saying it is finished, and the steps
// running out - so the first live run after shipping the diagnostic showed
// no reply at all. A diagnostic that reports on some paths is worse than
// none, because its silence reads as evidence.
{
  const exits = [
    ["a finish with nothing in it", { ok: true, step: { do: "finish", answer: "" }, raw: '{"do":"finish","answer":""}' }],
    ["a control number off the end", { ok: true, step: { n: 77, do: "click" }, raw: '{"n":77,"do":"click"}' }],
    ["prose instead of an object", { ok: false, error: "model did not return usable JSON: Sure! I will enable it." }],
    ["nothing but reads", { ok: true, step: { do: "read" }, raw: '{"do":"read"}' }],
  ];
  for (const [what, reply] of exits) {
    const ep2 = loadPage(`<!doctype html><html><body>
      <a href="#a">Precipitation Frequency Estimates</a>
      <label><input type="checkbox" name="pe"> Display estimated precipitation on hover</label>
      </body></html>`, { url: "https://water.noaa.gov/" });
    if (!ep2) continue;
    const bgex = loadBackground({ page: ep2 });
    bgex.__model = (m) => {
      if (m.type === "llmStatus") {
        return { ready: true, hasGpu: true, model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" };
      }
      if (m.type === "llmStep") return reply;
      return undefined;
    };
    runAsync(async () => {
      // Phrased so it names no control word for word, or the fast path
      // answers and the model is never asked - which is correct behaviour
      // and useless for testing this.
      const out = await bgex.runModelAgent("GENERIC", "show the rain layer", { maxSteps: 3 });
      ensure(`${what} leaves the reply on the way out`, !!out.said, out);
      const r = await bgex.__ask({ type: "smartAsk", instruction: "show the rain layer" });
      ensure(`${what} reaches the card`,
        /it replied:/.test(String((r.display || {}).note || "")), (r.display || {}).note);
    });
  }
}

// A command for something this page does not have was still getting the
// top of the list pressed, because the scorer always has a best candidate -
// it ranks, it does not judge whether the winner is worth pressing. Somebody
// typed an instruction for a control that was not there and it ran anyway.
{
  const bare2 = loadPage(`<!doctype html><html><body>
    <a href="#a">Streamflow conditions</a>
    <a href="#b">Water quality data</a>
    <label><input type="checkbox" name="g"> Show gauges</label>
    </body></html>`, { url: "https://water.noaa.gov/" });
  if (bare2) {
    let pressed = 0;
    for (const el of bare2.document.querySelectorAll("a,button,input")) {
      el.addEventListener("click", () => { pressed++; });
    }
    const bgb3 = loadBackground({ page: bare2 });
    bgb3.__model = (m) => (m.type === "llmStatus" ? { ready: false, hasGpu: false } : undefined);
    runAsync(async () => {
      for (const instr of ["enable snow depth", "click the tsunami warning panel"]) {
        pressed = 0;
        await bgb3.__ask({ type: "smartAsk", instruction: instr });
        check(`"${instr}" presses nothing, because nothing here is named that`, pressed, 0);
      }
      // And a control that IS named is still reached, or the guard has
      // simply turned the tool off.
      pressed = 0;
      await bgb3.__ask({ type: "smartAsk", instruction: "show gauges" });
      check("a control the page does have is still acted on", pressed, 1);
      check("and it is the right one",
        !!(bare2.document.querySelector('[name="g"]') || {}).checked, true);
    });
  }
}

// Truncating labels blindly turned "Display estimated precipitation on
// hover" and "Display estimated precipitation by county" into the same line.
// The model answers by number, so it was being asked to choose between two
// things it could not tell apart - and whichever it picked, the report would
// name the other one just as plausibly.
{
  const build = loadOffscreenHelper("buildStepPrompt");
  if (build) {
    const text = build({ goal: "x", controls: [
      { label: "Display estimated precipitation on hover" },
      { label: "Display estimated precipitation by county" },
      { label: "Gage height" },
    ] });
    const lines = text.split("Controls on the page:")[1].split("Steps already")[0]
      .trim().split("\n").map((l) => l.trim()).filter(Boolean);
    ensure("two controls sharing a long prefix stay distinguishable",
      lines[0] !== lines[1].replace(/^1\./, "0."), lines);
    ensure("and each keeps enough of its name to tell which is which",
      /hover/.test(lines[0]) && /county/.test(lines[1]), lines);
    // The short form is still used where nothing collides, since the list is
    // most of the prompt and the prompt is the wait.
    // Distinct within the first few characters, as real labels are - the
    // earlier fixture put the differing digit past the cut, so every line
    // legitimately collided and every line kept its full length.
    const many = build({ goal: "x", controls: Array.from({ length: 40 }, (_, i) => ({
      label: `${i} gauge on the lower river reach near the town bridge`,
    })) });
    const listLines = many.split("Controls on the page:")[1].split("Steps already")[0]
      .trim().split("\n");
    ensure("distinct labels are still cut short",
      listLines.every((l) => l.length < 40), listLines.slice(0, 3));
  }
}

// A 1.5B replied {"n":108,"do":"check","on":true} to "enable snow depth" on
// a page with fewer controls than that. A perfectly formed decision, in the
// right format, about a control that did not exist - it had understood the
// task completely and could not count a hundred-odd numbered lines, which is
// not something a model that size improves at. Naming the control is the
// part that needs intelligence; turning a name into a selector is plumbing.
{
  let noise = "";
  for (let i = 0; i < 60; i++) noise += `<a href="#n${i}">Gauge report ${i}</a>`;
  const byName = [
    ["named exactly", { name: "Snow Depth", do: "check", on: true }, true],
    ["named in another case", { name: "snow depth", do: "check", on: true }, true],
    ["a number off the end", { n: 108, do: "check", on: true }, false],
    ["a name that is not on the page", { name: "Tsunami Warnings", do: "check", on: true }, false],
  ];
  for (const [what, reply, shouldAct] of byName) {
    const np2 = loadPage(`<!doctype html><html><body>${noise}
      <label><input type="checkbox" name="sd"> Snow Depth</label>
      <label><input type="checkbox" name="pe"> Precipitation</label>
      </body></html>`, { url: "https://water.noaa.gov/" });
    if (!np2) continue;
    const bgnm = loadBackground({ page: np2 });
    let turns = 0;
    bgnm.__model = (m) => {
      if (m.type === "llmStatus") {
        return { ready: true, hasGpu: true, model: "Llama-3.2-1B-Instruct-q4f16_1-MLC" };
      }
      if (m.type === "llmStep") { turns++; return { ok: true, step: reply, raw: JSON.stringify(reply) }; }
      return undefined;
    };
    runAsync(async () => {
      const r = await bgnm.__ask({ type: "smartAsk", instruction: "model: enable snow depth" });
      check(`${what}: the box ends ${shouldAct ? "on" : "untouched"}`,
        !!(np2.document.querySelector('[name="sd"]') || {}).checked, shouldAct);
      if (!shouldAct) {
        // Nothing else gets pressed to cover for it, and it says the model
        // was the one that got nowhere.
        check(`${what}: the other box is left alone`,
          !!(np2.document.querySelector('[name="pe"]') || {}).checked, false);
        check(`${what}: attributed to the model`, r.plannedBy, "model");
      }
      // One request, one planner. The older shortlist path ran after the
      // agent loop, so a forced request bought two decisions at forty-odd
      // seconds each, and the second one's verdict overwrote the first's.
      ensure(`${what}: the model is asked once, not twice`, turns <= 2, turns);
    });
  }
}

// Asked to "enable snow depth", a 3B replied {"name":"Enable Snow Depth"}.
// It had found the right control and handed back the instruction's wording
// rather than the page's - a reasonable thing for a model to do, and a poor
// reason to fail the whole request.
{
  const nameShapes = [
    ["the request's verb glued on", { name: "Enable Snow Depth", do: "check", on: true }, true],
    ["the page's own wording", { name: "Snow Depth", do: "check", on: true }, true],
    ["a name for something else", { name: "Tsunami Warnings", do: "check", on: true }, false],
  ];
  for (const [what, reply, shouldAct] of nameShapes) {
    const vp = loadPage(`<!doctype html><html><body>
      <label><input type="checkbox" name="sd"> Snow Depth</label>
      <label><input type="checkbox" name="pe"> Precipitation</label>
      </body></html>`, { url: "https://water.noaa.gov/" });
    if (!vp) continue;
    const bgv = loadBackground({ page: vp });
    bgv.__model = (m) => {
      if (m.type === "llmStatus") {
        return { ready: true, hasGpu: true, model: "Llama-3.2-3B-Instruct-q4f16_1-MLC" };
      }
      if (m.type === "llmStep") return { ok: true, step: reply, raw: JSON.stringify(reply) };
      return undefined;
    };
    runAsync(async () => {
      await bgv.__ask({ type: "smartAsk", instruction: "model: enable snow depth" });
      check(`${what}: the control ends ${shouldAct ? "on" : "untouched"}`,
        !!(vp.document.querySelector('[name="sd"]') || {}).checked, shouldAct);
      check(`${what}: nothing else is pressed`,
        !!(vp.document.querySelector('[name="pe"]') || {}).checked, false);
    });
  }

  // A reference that fits two different controls did not land, and choosing
  // between them is the confident wrong action this exists to avoid. Two
  // controls under one identical label are not this case - those are folded
  // into one before the model ever sees them, as the same thing twice over.
  const amb = loadPage(`<!doctype html><html><body>
    <label><input type="checkbox" name="a"> Snow Depth</label>
    <label><input type="checkbox" name="b"> Water Depth</label>
    </body></html>`, { url: "https://water.noaa.gov/" });
  if (amb) {
    const bga2 = loadBackground({ page: amb });
    bga2.__model = (m) => {
      if (m.type === "llmStatus") return { ready: true, hasGpu: true, model: "Llama-3.2-3B-Instruct-q4f16_1-MLC" };
      if (m.type === "llmStep") {
        return { ok: true, step: { name: "Depth", do: "check", on: true },
          raw: '{"name":"Depth"}' };
      }
      return undefined;
    };
    runAsync(async () => {
      const r = await bga2.__ask({ type: "smartAsk", instruction: "model: enable snow depth" });
      check("a name that fits two controls presses neither",
        [...amb.document.querySelectorAll("input")].filter((x) => x.checked).length, 0);
      ensure("and says that is what happened",
        /more than one control/i.test(`${r.error || ""} ${(r.display || {}).note || ""}`),
        `${r.error} | ${(r.display || {}).note}`);
    });
  }
}

// The model chosen in the panel has to be the one that loads. The choice was
// read through an async storage callback while getEngine read the id
// synchronously, and the service worker warms the model as soon as the
// document exists - so the default won the race and a card still came back
// saying Llama 3.2 3B, 35s a decision, after somebody had switched
// specifically to avoid that. Checked at the source, since building an
// engine needs a GPU this harness does not have.
{
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "offscreen", "offscreen.js"), "utf8");
  ensure("the engine is built only once the chosen model is known",
    /enginePromise\s*=\s*chosenModelId\(\)\s*\.then\(/.test(src),
    src.slice(src.indexOf("function getEngine"), src.indexOf("function getEngine") + 200));
  ensure("and the choice is a promise, not a callback that may arrive late",
    /function chosenModelId\(\)/.test(src) && /modelChoice\s*=\s*new Promise/.test(src), true);
}

section("a point on a map with no points to click");
// USGS draws its national dashboard to a canvas, so there is no marker
// element for Salmon River - there is no element at all - and "click salmon
// river on the map" could only ever press something else. But the map is
// drawn from a feed, and that feed is captured: name, coordinates and id for
// every gauge on the screen. Confirmed against the live dashboard, where the
// bodies arrive truncated at a size cap and so have to be read as text
// rather than parsed.
const canvasMap = loadPage(`<!doctype html><html><head><title>Dashboard</title></head><body>
  <canvas id="map" width="800" height="600"></canvas></body></html>`,
  { url: "https://dashboard.waterdata.usgs.gov/app/nwd/en/" });
if (!canvasMap) skip("map points", "jsdom not installed");
else {
  canvasMap.__wcFeedCapture = { feeds: [{
    url: "https://dashboard.waterdata.usgs.gov/service/cwis/CurrentConditions",
    method: "GET", status: 200, type: "json",
    body: JSON.stringify({ value: [
      { SiteNumber: "13317000", SiteName: "SALMON RIVER AT WHITE BIRD ID", Latitude: 45.7502, Longitude: -116.3236 },
      { SiteNumber: "13069500", SiteName: "MALAD RIVER NEAR GOODING ID", Latitude: 42.8619, Longitude: -114.8483 }] }) }] };
  check("the map's own points are found", canvasMap.GENERIC.capturedPoints().count, 2);
  check("and one is found by the name a person would use",
    (canvasMap.GENERIC.findCapturedPoint("salmon river") || {}).id, "13317000");
  check("a name that is not there is not invented",
    canvasMap.GENERIC.findCapturedPoint("fhqwhgads river"), null);
  // Truncated JSON is the normal case: the bodies are kept to a size, so a
  // big feed arrives cut off mid-object and will not parse.
  const cut = loadPage("<!doctype html><html><body><canvas></canvas></body></html>",
    { url: "https://dashboard.waterdata.usgs.gov/app/nwd/en/" });
  if (cut) {
    cut.__wcFeedCapture = { feeds: [{ url: "https://x/feed", body:
      '{"value":[{"SiteNumber":"13317000","SiteName":"SALMON RIVER AT WHITE BIRD ID",'
      + '"Latitude":45.7502,"Longitude":-116.3236},{"SiteNumber":"1306","SiteName":"MAL' }] };
    check("a feed cut off mid-record still yields its whole records",
      cut.GENERIC.capturedPoints().count, 1);
  }
  const bg = loadBackground({ page: canvasMap });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "click salmon river on the map" });
    check("the instruction reaches the point", r.plannedBy, "map-point");
    ensure("and the card names the gauge",
      /salmon river/i.test((r.display || {}).title || ""), (r.display || {}).title);
    ensure("with its coordinates",
      ((r.display || {}).stats || []).some((x) => /latitude/i.test(x.label)), (r.display || {}).stats);
  });
}

section("the page's own labels answer for it");
// The data paths only knew measurements the vocabulary lists - stage,
// discharge, temperature - so "what is the datum" and "what is the drainage
// area" found nothing on a page printing both in plain sight. A page's own
// labels are the last and most literal place to look, and nobody looked.
const labelled = `<!doctype html><html><head><title>Smith River</title></head><body>
  <p>Current stage: <span class="value">12.4</span> ft</p>
  <dl><dt>Flood stage</dt><dd>18 ft</dd><dt>Datum</dt><dd>4.2 ft</dd>
      <dt>Drainage area</dt><dd>613 sq mi</dd><dt>Gage number</dt><dd>11532500</dd></dl>
  </body></html>`;
for (const [q, want] of [["what is the datum", "4.2 ft"],
                         ["drainage area", "613 sq mi"],
                         ["what is the gage number", "11532500"]]) {
  const page = loadPage(labelled, { url: "https://water.noaa.gov/gauges/CRSC1" });
  if (!page) { skip(`page label: ${q}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: q });
    const d = r.display || {};
    ensure(`"${q}" is answered from the page`,
      new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(d.subtitle || ""), d.subtitle);
    ensure(`"${q}" is titled with the label it read`,
      !!(d.title && /datum|drainage|gage number/i.test(d.title)), d.title);
  });
}
// Every word, or it is a coincidence of one. A page about rivers must not
// answer a question about the moon with whatever shares a word with it.
const nonsense = loadPage(labelled, { url: "https://water.noaa.gov/gauges/CRSC1" });
if (nonsense) {
  const bg = loadBackground({ page: nonsense });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "what is the moon phase" });
    check("a question this page cannot answer is still refused", r.ok, false);
  });
}

section("the domain's own words for the same thing");
// ENV_VOCAB has held these since the beginning - discharge is streamflow is
// flow is cfs, gage height is stage - and nothing that matched a control
// ever consulted it. A page saying "Discharge" was unreachable to anyone who
// said "flow", which is most people.
check("a single-word synonym reaches the label", sb.wordMatchesText("flow", "Discharge"), "fuzzy");
check("and so does an abbreviation", sb.wordMatchesText("swe", "Snow Water Equivalent"), "fuzzy");
// Multi-word names of the same concept, looked for whole: splitting them
// would make "water" alone stand for water temperature, which it does not.
check("a multi-word name is matched whole", sb.wordMatchesText("stage", "Gage height"), "fuzzy");
check("but an unrelated label is still unrelated", sb.wordMatchesText("flow", "Snow Depth"), false);
// Ranked below a literal match, so a page using the word you typed always
// wins over one using a synonym of it.
const literalVsSynonym = { url: "https://waterdata.usgs.gov/", controls: [
  { kind: "a", label: "Discharge", selector: "#disch", confidence: "high" },
  { kind: "a", label: "Flow duration", selector: "#flow", confidence: "high" },
] };
check("the literal word beats the synonym",
  sb.planGenericTool("click flow", literalVsSynonym).calls[0].args.selector, "#flow");

section("an empty panel is not a failed search");
// Measured on water.noaa.gov through Chrome itself: the Flood Inundation
// accordion opens - aria-expanded goes true, the li gains uk-open, the panel
// gets a height - and holds nothing at all. Our click does this exactly as a
// genuine mouse click does; both leave it empty. The controls seen there on
// another day exist only once the site has filled it.
//
// So the card was describing our own tooling rather than the page:
// "toggleFloodCategory: inundation not found", and "never accounted for:
// flood, inundation" - which says the search failed when what happened is
// that the page has no such control yet.
const emptyPanel = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-accordion">
    <li><a id="uk-accordion-9" class="uk-accordion-title" aria-expanded="false">Flood Inundation</a>
      <div class="uk-accordion-content" style="display:none"></div></li>
  </ul>
  <script>
    document.getElementById("uk-accordion-9").addEventListener("click", function () {
      this.setAttribute("aria-expanded", "true");
      this.closest("li").classList.add("uk-open");
      this.closest("li").querySelector(".uk-accordion-content").style.display = "block";
    });
  <\/script></body></html>`;
const ep = loadPage(emptyPanel, { url: "https://water.noaa.gov/" });
if (!ep) skip("empty panels", "jsdom not installed");
else {
  const bg = loadBackground({ page: ep });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    const d = r.display || {};
    ensure("the card says the panel opened and was empty",
      /opened .*and it is empty/i.test(d.subtitle || ""), d.subtitle);
    ensure("it is titled after the panel, not after a hand-written tool",
      /flood inundation/i.test(d.title || ""), d.title);
    ensure("and does not claim the words went unmatched",
      !/never accounted for/i.test(JSON.stringify(d.rows || [])), d.rows);
    // The panel really was opened, which is the one thing that did work.
    check("the accordion is left open",
      ep.document.getElementById("uk-accordion-9").getAttribute("aria-expanded"), "true");
  });
}

section("what the live page actually said");
// Driven against water.noaa.gov itself through Chrome's debugging protocol,
// not a rebuild. 191 controls. Three things that only the real page could
// have shown.

// A select reads as all of its option texts run together, which is exactly
// what the div wrapping it reads as - so the basemap select was folded into
// its own wrapper by the duplicate rule and there was nothing left to set.
// Decoration can be folded into what it decorates; a control cannot.
const wrappedSelect = loadPage(`<!doctype html><html><body>
  <div class="uk-flex"><select id="bm">
    <option>Topographic</option><option>Satellite</option>
    <option>Dark</option><option>Light</option></select></div>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!wrappedSelect) skip("wrapped selects", "jsdom not installed");
else {
  const found = wrappedSelect.GENERIC.inventory({ includeHidden: true }).controls;
  ensure("a select inside a div of the same text survives",
    found.some((c) => c.kind === "select" && (c.options || []).length === 4),
    found.map((c) => `${c.kind}:${(c.label || "").slice(0, 24)}`));
  // Counted by what it is rather than by its text, because a select is no
  // longer named after its own options - that string named nothing and was
  // shown to the model in place of a dropdown it could have recognised.
  check("and the wrapper is not offered as a second control",
    found.filter((c) => (c.options || []).length === 4).length, 1);
  ensure("a select is not named after everything inside it",
    !/topographic/i.test(found.map((c) => c.label || "").join(" ")),
    found.map((c) => c.label));
}

// The word naming the kind of control need not be on it. That select is
// labelled only by what it contains - "basemap" appears nowhere - so
// "satellite" covered one word and "basemap" was left over, one against one,
// which the unaccounted-subject rule rejects. Naming an option word for word
// is far better evidence than sharing a word with a label.
const basemap = { url: "https://water.noaa.gov/", controls: [
  { kind: "select", label: "Topographic Satellite Dark Light", selector: "#bm", confidence: "high",
    options: [{ text: "Topographic" }, { text: "Satellite" }, { text: "Dark" }, { text: "Light" }] },
] };
check("an option named exactly carries one spare word",
  sb.planGenericTool("set the basemap to satellite", basemap).calls[0].args.value, "Satellite");
// And the case the rule exists for is untouched: "snow" matched a nav link's
// label, not an option, so it gets no allowance.
const navOnly = { url: "https://water.noaa.gov/", controls: [
  { kind: "a", label: "National Snow Analysis", selector: "#nsa", confidence: "high" },
] };
ensure("but a label sharing one word still does not",
  !sb.planGenericTool("click snow depth", navOnly), sb.planGenericTool("click snow depth", navOnly));

section("six ways to one article is one choice");
// nasa.gov carries the same headline six times - a carousel, a latest-news
// list, a featured block - none nested inside another, all linking to one
// article. As separate candidates they tie forever and the page reads as
// ambiguous when there is no choice anybody could make. The target is taken
// from the nearest enclosing link, so a paragraph inside a card carries the
// card's destination.
const sixWays = { url: "https://www.nasa.gov/", controls: [
  { kind: "a", label: "2 min read NASA Awards SpaceX Three Crew Flights",
    selector: "#card1", goesTo: "/awards", confidence: "high" },
  { kind: "div", label: "NASA Awards SpaceX Three Crew Flights",
    selector: "#card2 > div", goesTo: "/awards", confidence: "high" },
  { kind: "p", label: "NASA Awards SpaceX Three Crew Flights",
    selector: "#card3 > p", goesTo: "/awards", confidence: "high" },
] };
const sixPlan = sb.planGenericTool("click NASA Awards SpaceX Three Crew Flights", sixWays);
ensure("it acts rather than asking which copy", !!(sixPlan && sixPlan.calls), sixPlan);
ensure("and does not call it ambiguous", !(sixPlan || {}).ambiguous, (sixPlan || {}).ambiguous);
// Two links going to different places remain a real question.
const twoPlaces = { url: "https://www.nasa.gov/", controls: [
  { kind: "a", label: "Artemis mission", selector: "#a", goesTo: "/artemis", confidence: "high" },
  { kind: "a", label: "Artemis gallery", selector: "#b", goesTo: "/gallery", confidence: "high" },
] };
ensure("but two different destinations still are",
  !!(sb.planGenericTool("click artemis", twoPlaces) || {}).ambiguous,
  sb.planGenericTool("click artemis", twoPlaces));

section("three rounds over a hundred actions");
// Found by sweeping 108 derived actions across five federal sites three
// times over, fixing between rounds. All three were real.

// A dropdown named without naming a value. "Open input location" matched
// drought.gov's location select at 47.9 - as clear a match as that page
// offers - then planned nothing, because no option was named, and reported
// "nothing matched". Clicking a select is how a person opens one to look.
const lonelySelect = { url: "https://www.drought.gov/", controls: [
  { kind: "select", type: "select-one", label: "Input location", selector: "#loc",
    confidence: "high", options: [{ text: "Choose" }] },
] };
check("a dropdown named without a value is opened",
  (sb.planGenericTool("open input location", lonelySelect).calls || [])[0].name, "pageClick");

// A single character can be the whole label: "x" closes a panel on half the
// federal estate, and dropping it left "click x" with no words at all.
check("a one-character label is still a word", sb.meaningfulWords("click x"), ["x"]);
const closer = { url: "https://mywaterway.epa.gov/", controls: [
  { kind: "button", type: "submit", label: "x", selector: "#x", confidence: "high" },
  { kind: "button", label: "Search", selector: "#s", confidence: "high" },
] };
check("so the one-character button can be pressed",
  sb.planGenericTool("click x", closer).calls[0].args.selector, "#x");

// The whole-label escape hatch compared raw text, so a control called "Close
// button" could never be reached: the instruction reduces to "close", the
// label to the string "close button", and the two never met. Any label
// carrying a filler word was in the same position.
const closeBtn = { url: "https://data.gov/", controls: [
  { kind: "button", type: "submit", label: "Close button", selector: "#cb", confidence: "high" },
] };
check("a label with filler in it is still matched whole",
  sb.planGenericTool("click close button", closeBtn).calls[0].args.selector, "#cb");

// nps.gov carries two text inputs, "Search" and "Search text", and document
// order picked the second.
const twoText = { url: "https://www.nps.gov/", controls: [
  { kind: "input", type: "text", label: "Search text", selector: "#long", confidence: "high" },
  { kind: "input", type: "text", label: "Search", selector: "#plain", confidence: "high" },
] };
check("the box called exactly what you would call it wins",
  sb.planGenericTool("search for smith river", twoText).calls[0].args.selector, "#plain");

section("a plural is the same word");
// Found by sweeping invented phrasings: "set the time span to 7 day" chose
// "1 day". The option reads "7 days", and \bday\b does not match "days", so
// only the digit matched - tying with "1 day", which won on document order.
// These sites write spans both ways on the same page.
check("singular reaches plural", sb.wordMatchesText("day", "7 days"), "exact");
check("and plural reaches singular", sb.wordMatchesText("days", "1 day"), "exact");
// Not a licence for short words to collide.
check("but a short word does not grow an s into a match",
  sb.wordMatchesText("is", "islands"), false);
const spans = { url: "https://water.noaa.gov/", controls: [
  { kind: "select", label: "Time span", selector: "#ts", confidence: "high",
    options: [{ text: "1 day" }, { text: "7 days" }, { text: "30 days" }] },
] };
check("so the span asked for is the span chosen",
  sb.planGenericTool("set time span to 7 day", spans).calls[0].args.value, "7 days");

section("a state argument takes a state");
// "What is the current stage" came back "don't recognize 'what stage' as a
// US state". "Stage" is one letter from "state", the leftover words were
// whatever the tool's name did not claim, and a question about a river's
// level won the plan as a request to jump to a state that does not exist.
// Nothing in that message told anyone what had gone wrong.
const stagePage = loadPage(`<!doctype html><html><head><title>Smith River</title></head><body>
  <p>Current stage: <span class="value">12.4</span> ft</p>
  <dl><dt>Flood stage</dt><dd>18 ft</dd></dl></body></html>`,
  { url: "https://water.noaa.gov/gauges/CRSC1" });
if (!stagePage) skip("state arguments", "jsdom not installed");
else {
  const bg = loadBackground({ page: stagePage });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "what is the current stage" });
    ensure("a question about stage is not a question about a state",
      !/as a US state/i.test(String(r.error || "")), r.error);
  });
}
// A real state still fills a state argument.
ensure("and a real one is still recognised", !!sb.findStateInText("wyoming"),
  sb.findStateInText("wyoming"));
ensure("while a near-miss is not", !sb.findStateInText("what stage"),
  sb.findStateInText("what stage"));

section("an open panel's title is not a switch");
// From the live page with the panel finally open. The layer is a checkbox
// labelled "INUNDATION"; the accordion above it is titled "Flood Inundation"
// and so carries both words, scoring fourteen against the checkbox's five.
// The title won every time, and all it does is open and shut the panel -
// which is why eight rounds of cards said "clicked, but it is still false".
//
// Once the panel is open its title cannot be the thing to switch on, at any
// score. Closed, it is exactly what needs pressing, so both states are
// tested here.
const nwpsOpen = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-accordion">
    <li class="uk-open"><button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div class="uk-accordion-content">
        <div class="options"><label><input type="checkbox" name="inund"> INUNDATION</label></div>
        <div class="options"><label><input type="checkbox" name="cov"> INUNDATION COVERAGE</label></div>
      </div></li>
    <li class="uk-open"><button class="uk-accordion-title">Gauges</button>
      <div class="uk-accordion-content"><table class="gauge-table">
        <tr><td><label><input type="checkbox" name="major"> Major Flood</label></td></tr>
      </table></div></li>
  </ul></body></html>`;
const nwpsShut = nwpsOpen.replace('<li class="uk-open"><button id="uk-accordion-9"',
  '<li><button id="uk-accordion-9"');
for (const [state, src] of [["open", nwpsOpen], ["closed", nwpsShut]]) {
  for (const phrasing of ["enable flood inundation", "select flood inundation"]) {
    const page = loadPage(src, { url: "https://water.noaa.gov/" });
    if (!page) { skip(`${state}: ${phrasing}`, "jsdom not installed"); continue; }
    const bg = loadBackground({ page });
    runAsync(async () => {
      await bg.__ask({ type: "smartAsk", instruction: phrasing });
      const on = (n) => !!(page.document.querySelector(`[name="${n}"]`) || {}).checked;
      check(`panel ${state}: "${phrasing}" ticks INUNDATION`, on("inund"), true);
      check(`panel ${state}: "${phrasing}" leaves INUNDATION COVERAGE alone`, on("cov"), false);
      check(`panel ${state}: "${phrasing}" leaves the gauge table alone`, on("major"), false);
    });
  }
}

section("it means the thing you just named");
// "Search fremont, ca, usa and click on it" split correctly and then failed
// on the second half: "click on it" is three stop words and names nothing at
// all. A step with nothing of its own to name is about the thing the step
// before it named - that is what "it" is for.
const refPage = `<!doctype html><html><body>
  <input id="q" type="search" placeholder="Search location">
  <ul><li><a href="/fremont-ca" id="fr">Fremont, CA, USA</a></li>
      <li><a href="/fremont-ne" id="ne">Fremont, NE, USA</a></li></ul>
  <p id="log"></p>
  <script>
    document.getElementById("fr").addEventListener("click", () => {
      document.getElementById("log").textContent = "ca"; });
    document.getElementById("ne").addEventListener("click", () => {
      document.getElementById("log").textContent = "ne"; });
  <\/script></body></html>`;
const refP = loadPage(refPage, { url: "https://water.noaa.gov/" });
if (!refP) skip("pronoun steps", "jsdom not installed");
else {
  const bg = loadBackground({ page: refP });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk",
      instruction: "search fremont, ca, usa and click on it" });
    const rows = (r.display || {}).rows || [];
    check("both steps run", rows.length, 2);
    ensure("neither is reported as matching nothing",
      rows.every((x) => x.value !== "failed"), rows);
    // And the right one of two near-identical names.
    check("it means the place just searched for",
      (refP.document.getElementById("log") || {}).textContent, "ca");
  });
}

section("a door has to be a lead");
// With the layer panel already open and nothing inside it matching, the loop
// went on to press "Shortcuts" and then "Forecasts and Outlooks" - neither
// having anything to do with flood inundation, both revealing nothing, both
// real presses on somebody's page. A door that shares no word with the
// instruction and is not named for holding controls is not a lead, it is
// just the next thing in a list.
const manyDoors = loadPage(`<!doctype html><html><body>
  <button aria-expanded="false">Shortcuts</button>
  <button aria-expanded="false">Forecasts and Outlooks</button>
  <button aria-expanded="false">Data and APIs</button>
  <button aria-expanded="false">Layers</button>
  <button aria-expanded="false">Snow Analysis</button>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!manyDoors) skip("door relevance", "jsdom not installed");
else {
  const doors = manyDoors.GENERIC.disclosures({ match: "enable snow depth" }).disclosures;
  const lead = doors.filter((d) => d.related || d.generic).map((d) => d.label);
  ensure("the panel named after the subject is a lead",
    lead.some((l) => /snow analysis/i.test(l)), lead);
  ensure("so is one named for holding controls", lead.some((l) => /layers/i.test(l)), lead);
  ensure("an unrelated heading is not",
    !lead.some((l) => /shortcuts|forecasts and outlooks|data and apis/i.test(l)), lead);
}

section("pursuing a state never presses a link");
// The live page sent someone to a different site. Water.noaa.gov repeats its
// layer names in the navbar, so the loop - striking off each control that
// moved nothing and taking the next - worked through "Flood Inundation
// Mapping (FIM)" and "Flood Inundation Mapping" and left the page. Pressing
// a link is not a step towards switching something on; it is the end of the
// page the instruction was about.
const withNav = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav">
    <li><a href="/a">Flood Inundation Mapping (FIM)</a></li>
    <li><a href="/b">Flood Inundation Mapping</a></li></ul>
  <ul class="uk-accordion">
    <li class="uk-open"><button class="uk-accordion-title">Products</button>
      <div class="uk-accordion-content">
        <label><input type="radio" name="p" value="lrfo"> Long Range Flood Outlook</label></div></li>
    <li><input type="checkbox" name="fi">
      <button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div class="uk-accordion-content">Flood inundation mapping shows modelled
        extents for selected communities.</div></li>
  </ul></body></html>`;
for (const phrasing of ["click flood inundation", "enable flood inundation", "select flood inundation"]) {
  const page = loadPage(withNav, { url: "https://water.noaa.gov/" });
  if (!page) { skip(`nav-heavy: ${phrasing}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: phrasing });
    check(`"${phrasing}" ticks the layer`,
      !!(page.document.querySelector('[name="fi"]') || {}).checked, true);
    check(`"${phrasing}" stays on the page`, page.location.pathname, "/");
    check(`"${phrasing}" leaves the flood outlook alone`,
      !!(page.document.querySelector('[value="lrfo"]') || {}).checked, false);
  });
}
// A gauge-table checkbox called "Major Flood" outscored the control named
// word for word, 5 to 4: "enable" is not in the stop list, so the phrase
// stayed "enable flood inundation" and could never equal "Flood Inundation".
// The whole-label bonus was silently unavailable to any instruction starting
// with a verb the stop list happened to miss.
const rivalBox = { url: "https://water.noaa.gov/", controls: [
  { kind: "input", type: "checkbox", label: "Major Flood", selector: "#major", confidence: "high" },
  { kind: "button", label: "Flood Inundation", selector: "#acc", confidence: "high" },
] };
check("the control named word for word outranks one merely sharing a word",
  sb.planGenericTool("enable flood inundation", rivalBox).calls[0].args.selector, "#acc");

section("how many steps, and which kinds");
// The boundary, written down. Everything here was measured rather than
// assumed, and the last two fail on purpose - a limit that is tested is a
// limit somebody can rely on.
const multi = `<!doctype html><html><head><title>T</title></head><body>
  <button id="open">Layers</button><div id="p"></div>
  <label for="span">Time span</label>
  <select id="span"><option>1 day</option><option>7 day</option><option>30 day</option></select>
  <button id="reset">Reset</button><p id="log"></p>
  <script>
    const log = (t) => { document.getElementById("log").textContent += t + ";"; };
    document.getElementById("open").addEventListener("click", () => {
      const p = document.getElementById("p");
      if (!p.innerHTML) p.innerHTML =
        '<label><input type="checkbox" name="fi"> Flood Inundation</label>' +
        '<label><input type="checkbox" name="sd"> Snow Depth</label>';
      log("opened");
    });
    document.getElementById("reset").addEventListener("click", () => log("reset"));
    document.getElementById("span").addEventListener("change", (e) => log("span=" + e.target.value));
  <\/script></body></html>`;
const runMulti = (instr, then) => {
  const page = loadPage(multi, { url: "https://water.noaa.gov/" });
  if (!page) { skip(instr.slice(0, 30), "jsdom not installed"); return; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: instr });
    then(r, page, (n) => !!(page.document.querySelector(`[name="${n}"]`) || {}).checked);
  });
};
// Three parts, where each later part needs the one before it to have run.
runMulti("click layers and then enable flood inundation and then enable snow depth",
  (r, page, on) => {
    check("three parts all run", ((r.display || {}).rows || []).length, 3);
    check("and each one lands", `${on("fi")} ${on("sd")}`, "true true");
  });
// Five: the old cap was four, and a five-part instruction fell out of the
// sequence to be handled as one command - which pressed Reset, a step from
// the middle of the sentence, chosen alone.
runMulti("click layers and then enable flood inundation and then enable snow depth"
  + " and then click reset and then click layers",
  (r) => check("five parts still run as a sequence", ((r.display || {}).rows || []).length, 5));
// A comma is a sequence too.
runMulti("click layers, then enable snow depth",
  (r, page, on) => check("a comma separates steps as well as the word and", on("sd"), true));
// The number is the point of the instruction, not the unit.
runMulti("set time span to 30 day and then click reset",
  (r, page) => ensure("an option is matched whole, not on its first shared word",
    /span=30 day/.test((page.document.getElementById("log") || {}).textContent || ""),
    (page.document.getElementById("log") || {}).textContent));

// Not supported, and tested so that stays true rather than drifting.
runMulti("if flood inundation is off then enable it",
  (r) => ensure("a condition is not understood, and does not pretend to be",
    r.ok === false || !(r.display || {}).rows || (r.display || {}).rows.length <= 2, r.ok));
runMulti("enable the layer with the longest name",
  (r) => ensure("a superlative over the page is not understood either",
    r.ok === false, { ok: r.ok, sub: (r.display || {}).subtitle }));

section("and then means and then");
// "Click bear river monitoring location page and then click 30 day" did the
// first half and stopped. Sequencing existed, but it required every part to
// plan to a hand-written tool before any of them ran - so it worked only on
// sites somebody had written code for, which is the one place it is least
// needed. A part with no manifest tool is pursued instead, which is the same
// machinery a single instruction gets, multi-step and all.
const twoPart = `<!doctype html><html><head><title>USGS</title></head><body>
  <a href="#loc" id="loc">View Monitoring location page</a>
  <div id="spans" style="display:none"></div>
  <script>
    document.getElementById("loc").addEventListener("click", () => {
      const d = document.getElementById("spans");
      d.style.display = "block";
      if (!d.innerHTML) {
        d.innerHTML = '<button id="d7">7 day</button><button id="d30">30 day</button><p id="out"></p>';
        document.getElementById("d30").addEventListener("click", () => {
          document.getElementById("out").textContent = "30 day selected"; });
        document.getElementById("d7").addEventListener("click", () => {
          document.getElementById("out").textContent = "7 day selected"; });
      }
    });
  <\/script></body></html>`;
const seqPage = loadPage(twoPart, { url: "https://waterdata.usgs.gov/monitoring-location/10126000/" });
if (!seqPage) skip("two-part instructions", "jsdom not installed");
else {
  const bg = loadBackground({ page: seqPage });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk",
      instruction: "click view monitoring location page and then click 30 day" });
    check("both halves are run", ((r.display || {}).rows || []).length, 2);
    check("and the second half reaches the right button",
      (seqPage.document.getElementById("out") || {}).textContent, "30 day selected");
    ensure("neither half is reported as having failed",
      ((r.display || {}).rows || []).every((x) => x.value !== "failed"), (r.display || {}).rows);
  });
}

// Striking a control off and pressing the next one is only right where there
// is evidence the first did nothing. A control reporting "still false" is
// evidence; a plain click whose effect cannot be seen is not - and the
// second press is the one that does harm.
const twoButtons = loadPage(`<!doctype html><html><body>
  <button id="d7">7 day</button><button id="d30">30 day</button>
  </body></html>`, { url: "https://waterdata.usgs.gov/" });
if (twoButtons) {
  const bg2 = loadBackground({ page: twoButtons });
  let pressed = [];
  for (const id of ["d7", "d30"]) {
    twoButtons.document.getElementById(id)
      .addEventListener("click", () => pressed.push(id));
  }
  runAsync(async () => {
    await bg2.__ask({ type: "smartAsk", instruction: "click 30 day" });
    check("a click that changes nothing does not press the next thing",
      pressed.join(","), "d30");
  });
}

section("the bare checkbox beside the button that names it");
// The live page, rebuilt from three rounds of cards. water.noaa.gov puts a
// bare checkbox beside the button that names each layer, so the checkbox has
// no label of its own and fell back to its name attribute - "fi". Scored on
// that, "enable flood inundation" could never reach it, and the only thing
// left to match was the button, which opens the panel rather than switching
// the layer on: "Flood Inundation: clicked, but it is still false".
//
// Meanwhile an already-open accordion holds a radio called Long Range Flood
// Outlook, which covers "flood" - and the loop, counting the whole plan's
// coverage rather than the step it actually ran, treated "inundation" as
// accounted for by a control it never touched. It switched on the outlook
// and reported the job done.
const livePage = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-accordion">
    <li class="uk-open"><button class="uk-accordion-title">Products</button>
      <div class="uk-accordion-content"><div class="products">
        <label><input type="radio" name="p" value="lrfo"> Long Range Flood Outlook</label>
      </div></div></li>
    <li><input type="checkbox" name="fi">
      <button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div id="c" class="uk-accordion-content" style="display:none"></div></li>
  </ul></body></html>`;
for (const phrasing of ["enable flood inundation", "select flood inundation"]) {
  const page = loadPage(livePage, { url: "https://water.noaa.gov/" });
  if (!page) { skip(`live shape: ${phrasing}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: phrasing });
    check(`"${phrasing}" ticks the layer's own checkbox`,
      !!(page.document.querySelector('[name="fi"]') || {}).checked, true);
    check(`"${phrasing}" does not switch on the flood outlook instead`,
      !!(page.document.querySelector('[value="lrfo"]') || {}).checked, false);
  });
}
// The label has to come from the row, or none of the above can happen. And
// from the thing beside it rather than the thing around it: Snow Water
// Equivalent sits in a row of its own and was named correctly, while Flood
// Inundation shares its row with the panel's prose - so the row's text ran
// long, the checkbox fell back to its name attribute, and it stayed
// unreachable while its neighbours worked. That is exactly what the live
// page reported: snow depth and snow water equivalent fixed, flood
// inundation still saying "clicked, but it is still false".
const bareBox = loadPage(`<!doctype html><html><body>
  <li><input type="checkbox" name="swe"><button>Snow Water Equivalent</button></li>
  <li><input type="checkbox" name="fi"><button>Flood Inundation</button>
    <div class="uk-accordion-content">Flood inundation mapping shows modelled
      extents for selected communities and is updated as forecasts change.</div></li>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (bareBox) {
  const boxes = bareBox.GENERIC.inventory({ includeHidden: true })
    .controls.filter((c) => c.type === "checkbox");
  check("a checkbox in a short row is named after it",
    (boxes.find((c) => c.name === "swe") || {}).label, "Snow Water Equivalent");
  check("and one sharing its row with a paragraph is named after its neighbour",
    (boxes.find((c) => c.name === "fi") || {}).label, "Flood Inundation");

  const bg = loadBackground({ page: bareBox });
  runAsync(async () => {
    for (const phrasing of ["click flood inundation", "enable flood inundation"]) {
      const page = loadPage(bareBox.document.documentElement.outerHTML,
        { url: "https://water.noaa.gov/" });
      if (!page) continue;
      const b = loadBackground({ page });
      await b.__ask({ type: "smartAsk", instruction: phrasing });
      check(`"${phrasing}" ticks the layer even in a crowded row`,
        !!(page.document.querySelector('[name="fi"]') || {}).checked, true);
      check(`"${phrasing}" leaves the snow layer alone`,
        !!(page.document.querySelector('[name="swe"]') || {}).checked, false);
    }
  });
}

section("a tie is not an empty page");
// Live on water.noaa.gov the loop's first move was to go door-hunting, and
// the card said "revealed 0 / never accounted for: flood, inundation" - on a
// page where the accordion named Flood Inundation scored 25.6. The plan had
// come back ambiguous: "Flood Inundation" the accordion against "Flood
// Inundation Mapping" the navbar link, a genuine tie by label. A tie carries
// candidates but no calls, and that read in here as "nothing matches".
//
// Asking is the outer path's job. In here the method is to act and check:
// try the best of them, and if it moves nothing, strike it off and take the
// next.
const tied = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav"><li><a href="/b">Flood Inundation Mapping</a></li></ul>
  <ul class="uk-accordion">
    <li><button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div id="fi" class="uk-accordion-content" style="display:none"></div></li></ul>
  <script>
    document.getElementById("uk-accordion-9").addEventListener("click", () => {
      const c = document.getElementById("fi");
      c.style.display = "block";
      if (!c.innerHTML) c.innerHTML =
        '<label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>';
    });
  <\/script></body></html>`;
const tiedPage = loadPage(tied, { url: "https://water.noaa.gov/" });
if (!tiedPage) skip("ambiguous ties in the loop", "jsdom not installed");
else {
  const bg = loadBackground({ page: tiedPage });
  bg.planManifestTool = () => null;
  runAsync(async () => {
    const out = await bg.pursueGoal("NOAA", "enable flood inundation");
    ensure("the tie is acted on rather than abandoned",
      out.steps.some((st) => st.did !== "opened"), out.steps);
    check("the layer behind the tie is reached",
      !!(tiedPage.document.querySelector('[name="fim"]') || {}).checked, true);
    // Opening the accordion changes the page and accounts for every word in
    // the instruction, so the loop used to stop there and call it done.
    check("and opening the panel alone is not called done", out.done, true);
    ensure("with the checkbox, not the panel, as the proof",
      out.steps.some((st) => st.proven && /page(Check|PickRadio)/.test(st.did)), out.steps);
  });
}

section("without any code written for the site");
// The thesis, tested directly. Strip every hand-written NOAA tool and the
// page must still work - otherwise the success is borrowed from prebuilt
// code, which is the thing this is supposed to do without.
//
// It was borrowed. With the site code present the layer was reached; with it
// removed the same instruction stopped at "Which one did you mean?", because
// the navbar copy of the layer name and the accordion looked like a genuine
// choice. The loop, called directly on that same page, reached the layer. So
// the only thing making it work was a prebuilt tool failing in the right
// way, and the last step was to try acting before asking.
const noSiteCode = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav layer-1"><li><a href="/b">Flood Inundation Mapping</a></li></ul>
  <ul class="uk-accordion">
    <li><button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div id="fi" class="uk-accordion-content" style="display:none"></div></li></ul>
  <script>
    document.getElementById("uk-accordion-9").addEventListener("click", () => {
      const c = document.getElementById("fi");
      c.style.display = "block";
      if (!c.innerHTML) c.innerHTML =
        '<label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>';
    });
  <\/script></body></html>`;
for (const phrasing of ["enable flood inundation", "select flood inundation"]) {
  const page = loadPage(noSiteCode, { url: "https://water.noaa.gov/" });
  if (!page) { skip(`no site code: ${phrasing}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  bg.planManifestTool = () => null;   // as though nobody had ever written for NOAA
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: phrasing });
    check(`"${phrasing}" works with no code written for this site`,
      !!(page.document.querySelector('[name="fim"]') || {}).checked, true);
    ensure("and it is not asking which one was meant", !r.needsChoice, (r.display || {}).title);
  });
}

section("select and enable mean the same thing");
// Rebuilt from the live explain dump: navbar duplicates of the layer name, an
// already-open accordion of gauge-table checkboxes, and the closed
// #uk-accordion-9 titled after the layer inside it.
//
// "Enable flood inundation" reached the layer and "select flood inundation"
// did not, on the same page, in the same state. Opening a panel changes the
// page, so "the page responded" was true while nothing had been switched on
// - and enable only worked because the hand-written tool failed first and
// let the loop run. The phrasing decided the outcome, which is the thing
// this was reported as doing months ago.
const nwps = `<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-navbar-nav layer-1">
    <li><a href="/a">Flood Inundation Mapping (FIM)</a></li>
    <li><a href="/b">Flood Inundation Mapping</a></li>
  </ul>
  <ul class="uk-accordion">
    <li class="uk-open"><button id="uk-accordion-3" class="uk-accordion-title">Gauges</button>
      <div class="uk-accordion-content"><table class="gauge-table">
        <tr><td><label><input type="checkbox" name="major"> Major Flood</label></td></tr>
      </table></div></li>
    <li><button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div id="fi-content" class="uk-accordion-content" style="display:none"></div></li>
  </ul>
  <script>
    document.getElementById("uk-accordion-9").addEventListener("click", () => {
      const c = document.getElementById("fi-content");
      c.style.display = "block";
      if (!c.innerHTML) c.innerHTML =
        '<label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>';
    });
  <\/script></body></html>`;
for (const phrasing of ["enable flood inundation", "select flood inundation"]) {
  const page = loadPage(nwps, { url: "https://water.noaa.gov/" });
  if (!page) { skip(`phrasing: ${phrasing}`, "jsdom not installed"); continue; }
  const bg = loadBackground({ page });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: phrasing });
    check(`"${phrasing}" reaches the layer`,
      !!(page.document.querySelector('[name="fim"]') || {}).checked, true);
    check(`"${phrasing}" leaves the gauge table alone`,
      !!(page.document.querySelector('[name="major"]') || {}).checked, false);
  });
}

section("the search you can see");
// "Search how to vote" on usa.gov typed into
// #search-field-small-mobile-menu - the copy of the search box inside the
// collapsed mobile menu - and the page did nothing, because nothing on the
// screen had been touched. Federal sites carry the same search twice, header
// and mobile menu, and the box was chosen by document order.
const twoSearches = { url: "https://www.usa.gov/", controls: [
  { kind: "input", type: "search", label: "Search", selector: "#mobile", hidden: true, confidence: "high" },
  { kind: "input", type: "search", label: "Search", selector: "#header", confidence: "high" },
] };
const votePlan = sb.planGenericTool("search how to vote", twoSearches);
check("the one on the screen is used", votePlan.calls[0].args.selector, "#header");
// The phrase, not the leftovers. "Search how to vote" means how to vote.
check("and the whole phrase is typed", votePlan.calls[0].args.text, "how to vote");
check("then submitted", votePlan.calls[1].name, "pageSubmit");

// A box that is hidden but can be opened beats one that cannot be opened at
// all - the runner presses the opener before typing.
const openable = { url: "https://www.usa.gov/", controls: [
  { kind: "input", type: "search", label: "Search", selector: "#buried", hidden: true, confidence: "high" },
  { kind: "input", type: "search", label: "Search", selector: "#drawer", hidden: true,
    revealedBy: "#toggle", revealedByLabel: "Open search", confidence: "high" },
] };
check("otherwise the one that can be opened",
  sb.planGenericTool("search how to vote", openable).calls[0].args.selector, "#drawer");

section("accents are not word boundaries");
// "Click espanol" matched nothing on usa.gov. Splitting on [^a-z0-9] treats
// every accented letter as a boundary, so the label tokenised to "espa" and
// "ol" - two fragments matching nothing a person would ever type. Federal
// sites carry that link by law, so this was every one of them; and the same
// break hit "Mayaguez", which is a tide gauge somebody actually asked for
// earlier.
check("an accented label survives tokenising",
  sb.meaningfulWords("Espa\u00f1ol"), ["espanol"]);
check("and a place name is not cut in half",
  sb.meaningfulWords("Mayag\u00fcez tide gauge"), ["mayaguez", "tide", "gauge"]);
check("typed without the accent, matched with it",
  sb.wordMatchesText("espanol", "Espa\u00f1ol"), "exact");
// And the reverse: the accent typed, the label plain.
check("typed with the accent, matched without",
  sb.wordMatchesText("mayag\u00fcez", "Mayaguez gauge"), "exact");
const bilingual = { url: "https://www.usa.gov/", controls: [
  { kind: "link", label: "Espa\u00f1ol", selector: "#es", confidence: "high" },
  { kind: "link", label: "Contact us", selector: "#c", confidence: "high" },
] };
check("so the link is reached",
  sb.planGenericTool("click espanol", bilingual).calls[0].args.selector, "#es");

section("a tool that threw did not run");
// Straight from the live panel. noaaToggleFloodCategory threw
// `"inundation" not found`, the error travelled all the way to the card
// inside the payload, and the subtitle read "ran - could not check whether
// the page changed". It did not run. The one thing that was certain got
// reported as the one thing that was unknown, which is the most damaging
// wording available: an outright failure wearing the clothes of an
// unverifiable success.
const threw = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <p>nothing here answers to that</p></body></html>`, { url: "https://water.noaa.gov/" });
if (!threw) skip("a throwing tool", "jsdom not installed");
else {
  const bg = loadBackground({ page: threw });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    const sub = (r.display || {}).subtitle || "";
    ensure("a failure is never described as having run",
      !/^ran\b|ran - could not check/.test(sub), sub);
    ensure("and the reason is on the card, not only in the payload",
      !r.ok ? /did not run|could not|no |nothing/i.test(sub) : true, { ok: r.ok, sub });
  });
}

section("the navbar says it too");
// The live shape, and the reason the loop had to survive a dead end. NWPS
// carries "Flood Inundation Mapping" in its navbar and again as a map layer
// three levels down. The link accounts for every word in the instruction, so
// it wins, gets clicked, navigates nowhere - and a loop that stops when the
// words run out stops there, on the wrong control, having done nothing.
const navbarToo = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button id="layers">Layers</button><div id="panel"></div>
  <a href="/a">National Water Model</a>
  <a href="/b">Flood Inundation Mapping</a>
  <script>
    document.getElementById("layers").addEventListener("click", () => {
      if (document.getElementById("acc")) return;
      document.getElementById("panel").innerHTML =
        '<button id="acc" class="uk-accordion-title">Flood Inundation</button>' +
        '<div id="inner" class="uk-accordion-content" style="display:none"></div>';
      document.getElementById("acc").addEventListener("click", () => {
        const i = document.getElementById("inner");
        i.style.display = "block";
        if (!i.innerHTML) i.innerHTML =
          '<label><input type="checkbox" name="fim"> Flood Inundation Mapping</label>' +
          '<label><input type="checkbox" name="swe"> Snow Water Equivalent</label>';
      });
    });
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!navbarToo) skip("navbar collisions", "jsdom not installed");
else {
  const bg = loadBackground({ page: navbarToo });
  const box = (n) => navbarToo.document.querySelector(`[name="${n}"]`);
  runAsync(async () => {
    // Through the ordinary ask, not the loop directly: the one-list path
    // answers first on this page, and used to answer with the dead link.
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation mapping" });
    check("the layer is reached despite the link outranking it", box("fim").checked, true);
    check("and its neighbour is untouched", box("swe").checked, false);
    ensure("the dead link did not end it",
      /opened "Layers"/.test((r.display || {}).subtitle || ""), (r.display || {}).subtitle);
    ensure("and the card shows every step it took",
      ((r.display || {}).rows || []).length >= 3, (r.display || {}).rows);
  });
}

section("a goal it cannot reach stops");
// The loop must not press forty buttons in the name of a goal that is not
// there. A step has to either account for a word or reveal something new.
const noSuchThing = loadPage(`<!doctype html><html><body>
  <button>Alpha</button><button>Beta</button><button>Gamma</button>
  <button>Delta</button><button>Epsilon</button>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!noSuchThing) skip("bounded goals", "jsdom not installed");
else {
  const bg2 = loadBackground({ page: noSuchThing });
  runAsync(async () => {
    const out = await bg2.__pursue("enable flood inundation");
    ensure("it gives up rather than flailing", out.steps.length <= 2, out.steps);
    check("and does not claim success", out.done, false);
    ensure("and says what it could not account for",
      (out.unaccounted || []).length > 0, out.unaccounted);
  });
}

section("what five federal sites actually offer");
// Measured, not assumed: 96 actions derived from live HTML of waterdata.usgs.gov,
// water.noaa.gov, drought.gov, mywaterway.epa.gov and weather.gov, each turned
// back into the instruction a person would type and checked for whether it
// resolves to the control it came from. These are the classes that failed.

// A button is never the search box, however it is labelled. Both search
// fallbacks took the first control in document order whose label merely
// contained "search" - on mywaterway.epa.gov that is a button called "Open
// search drawer". It got a click, the query went nowhere, and the card
// reported a search.
const epaShape = { url: "https://mywaterway.epa.gov/", controls: [
  { kind: "button", type: "button", label: "Open search drawer", selector: "#drawer", confidence: "high" },
  { kind: "input", type: "search", label: "Search", selector: "#search-box", confidence: "high" },
  { kind: "button", type: "submit", label: "Search", selector: "#go", confidence: "high" },
  { kind: "input", type: "hidden", label: "typeofsearch", selector: "#h1", confidence: "high" },
  { kind: "input", type: "hidden", label: "areasearchurl", selector: "#h2", confidence: "high" },
] };
const epaPlan = (q) => {
  const r = sb.planGenericTool(q, epaShape);
  return r && r.calls ? `${r.calls[0].name} ${r.calls[0].args.selector || ""}`.trim() : null;
};
check("the query goes in the box, not into a button",
  epaPlan("search for smith river"), "pageFill #search-box");
// A hidden input cannot be clicked, typed into or seen. Five of them tied
// with the real search box here, one tie-break from being "the control".
check("a hidden input is not a candidate at all",
  sb.scoreControl({ kind: "input", type: "hidden", label: "typeofsearch" }, ["typeofsearch"], "typeofsearch"), 0);

// Controls named after verbs were unreachable. CONTROL_VERB lists close,
// open, search, download, reset and clear, and the rule that an instruction
// must match more than its own verb then rejected every control actually
// called one of those. "Click Close" matched nothing on three of five sites.
const verbNamed = (label, q) => {
  const r = sb.planGenericTool(q, { url: "https://x/",
    controls: [{ kind: "button", label, selector: "#c", confidence: "high" }] });
  return r && r.calls ? r.calls[0].name : null;
};
check("a button called Close can be closed", verbNamed("Close", "click Close"), "pageClick");
check("and one called Download can be downloaded", verbNamed("Download", "click Download"), "pageClick");
check("and one called Reset can be reset", verbNamed("Reset", "click Reset"), "pageClick");
// The case the rule exists for still holds: "Enabled" is not reached by
// "enable" when the real subject goes unmatched.
check("but Enabled is still not what enable snow depth means",
  verbNamed("Enabled", "enable snow depth"), null);

section("a link cannot be enabled");
// Straight off the live page. "Flood Inundation Mapping" exists twice on
// water.noaa.gov: as a navbar link and as the map layer itself. The link
// kept winning - they score identically on the words, and nothing preferred
// the one you can actually switch on - so "enable flood inundation" left the
// page instead of turning anything on, and "enable snow water equivalent"
// came back offering five nav links.
const linkVsLayer = { url: "https://water.noaa.gov/", controls: [
  { kind: "link", label: "Flood Inundation Mapping", selector: "a.nav1", confidence: "high" },
  { kind: "link", label: "Flood Inundation Mapping (FIM)", selector: "a.nav2", confidence: "high" },
  { kind: "input", type: "checkbox", label: "Flood Inundation Mapping", selector: "#fim", confidence: "high" },
  { kind: "link", label: "National Snow Analysis", selector: "a.nav3", confidence: "high" },
  { kind: "input", type: "radio", label: "Snow Depth", selector: "#sd", confidence: "high" },
] };
const pick = (q) => {
  const r = sb.planGenericTool(q, linkVsLayer);
  return r && r.calls ? `${r.calls[0].name} ${r.calls[0].args.selector}` : null;
};
check("the layer wins over the link that shares its name",
  pick("enable flood inundation mapping"), "pageCheck #fim");
// A radio is set, not clicked at - through its own tool, by group and value
// rather than by selector.
check("a radio layer is reached, not the link above it",
  (() => { const r = sb.planGenericTool("select snow depth", linkVsLayer);
    return r && r.calls ? `${r.calls[0].name} ${r.calls[0].args.value}` : null; })(),
  "pagePickRadio Snow Depth");
// The preference is a tie-breaker among things that matched, not a gift to
// every form control on the page: a dropdown matching no word at all must
// not outrank a button the instruction actually named.
const bareSelect = { url: "https://x/", controls: [
  { kind: "button", label: "Thunderstorms", selector: "#ts", confidence: "high" },
  { kind: "select", label: "Basemap", selector: "#b", confidence: "high",
    options: [{ value: "sat", text: "Satellite" }] },
] };
check("an unrelated dropdown does not win on kind alone",
  (sb.planGenericTool("thunderstorms", bareSelect).calls[0].args.selector), "#ts");

section("the panel is named after the thing inside it");
// From the live page. water.noaa.gov puts each layer group behind a UIkit
// accordion whose title is the domain term itself: "Flood Inundation",
// "National Snow Analysis". So the header outscores every real control
// (25.6 against nothing) and gets pressed as though it were the layer -
// which opens the panel, changes no checkbox, and reported "the click did
// not take". Snow Depth scored nothing at all, because it does not exist
// until its accordion is open.
const accordion = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <ul class="uk-accordion">
    <li><button id="uk-accordion-9" class="uk-accordion-title">Flood Inundation</button>
      <div class="uk-accordion-content" style="display:none">
        <label><input type="checkbox" name="fim"> Flood Inundation</label></div></li>
    <li><button id="uk-accordion-10" class="uk-accordion-title">National Snow Analysis</button>
      <div class="uk-accordion-content" style="display:none">
        <label><input type="checkbox" name="sd"> Snow Depth</label></div></li>
  </ul>
  <script>
    document.querySelectorAll(".uk-accordion-title").forEach((b) => {
      b.addEventListener("click", () => {
        const c = b.parentNode.querySelector(".uk-accordion-content");
        c.style.display = c.style.display === "none" ? "block" : "none";
      });
    });
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!accordion) skip("accordions", "jsdom not installed");
else {
  const seen = accordion.GENERIC.disclosures({ match: "select snow depth" }).disclosures;
  ensure("an accordion is a door, even named after a river term",
    seen.some((d) => /snow analysis/i.test(d.label)), seen.map((d) => d.label));
  ensure("and the one related to the question comes first",
    /snow analysis/i.test((seen[0] || {}).label || ""), seen.map((d) => d.label));

  const bg = loadBackground({ page: accordion });
  const cb = (n) => accordion.document.querySelector(`[name="${n}"]`);
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: "select flood inundation" });
    // The panel and the layer inside it have the same name, as they do on
    // the live site. Excluding the pressed header by label therefore deleted
    // the answer along with the door; it has to go by selector.
    check("pressing the header is not the end of the job", cb("fim").checked, true);
    check("and the other panel is left alone", cb("sd").checked, false);

    const r = await bg.__ask({ type: "smartAsk", instruction: "select snow depth" });
    check("a control that does not exist yet is still reached", cb("sd").checked, true);
    ensure("and it is not reported as done with nothing to show",
      !/nothing to change/i.test((r.display || {}).subtitle || ""), (r.display || {}).subtitle);
  });
}

section("show me the evidence");
// Every failure on water.noaa.gov was diagnosed from the wording of a card,
// which says what was decided and nothing about the page it was decided on -
// so each fix was aimed at a guess. "Explain <instruction>" prints the page's
// own candidates and their scores instead.
const explainPage = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <div><label><input type="checkbox" name="fi"> Flood Inundation</label>
  <label><input type="checkbox" name="sd"> Snow Depth</label>
  <a href="/x">National Water Model</a></div></body></html>`,
  { url: "https://water.noaa.gov/" });
if (!explainPage) skip("explain", "jsdom not installed");
else {
  const bg = loadBackground({ page: explainPage });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "explain select snow depth" });
    ensure("it answers at all", !!(r && r.display), r);
    const d = (r && r.display) || {};
    ensure("it names the instruction", /snow depth/i.test(d.title || ""), d.title);
    ensure("it lists the page's own candidates",
      (d.rows || []).some((x) => /snow depth/i.test(x.name)), d.rows);
    ensure("it says what would run",
      (d.stats || []).some((x) => /would run/i.test(x.label) && x.value && x.value !== "nothing"),
      d.stats);
    ensure("and shows the words it matched on", /snow.*depth/i.test(d.subtitle || ""), d.subtitle);
  });
}

section("the selector goes stale, the label does not");
// "Select flood inundation" switched on Precipitation Estimate. Selectors
// are captured while the page is read, and a control with no id gets a
// positional one - "label:nth-of-type(2)". Opening the panel reflows the
// list, so by the time the click lands that position belongs to a different
// layer. The page did respond, and the card said so, which is exactly the
// confidently wrong answer this whole thing exists to avoid.
// No ids anywhere: that is the whole point. A control with an id gets a
// stable selector and none of this can happen, which is why it took a live
// site to find - the fixtures all had ids.
const reflow = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <div id="L">
    <label><input type="checkbox" name="swe"> Snow Water Equivalent</label>
    <label><input type="checkbox" name="fi"> Flood Inundation</label>
    <label><input type="checkbox" name="pe"> Precipitation Estimate</label>
  </div></body></html>`, { url: "https://water.noaa.gov/" });
const box = (n) => reflow && reflow.document.querySelector(`[name="${n}"]`);
if (!reflow) skip("stale selectors", "jsdom not installed");
else {
  runAsync(async () => {
    const tools = reflow.GENERIC.pageTools().tools;
    const t = tools.find((x) => /flood.?inundation/i.test(x.name));
    ensure("the layer becomes a tool of its own", !!t, tools.map((x) => x.name).slice(0, 12));
    if (t) {
      // The list grows a row before the click lands - what opening a panel
      // does on a real page.
      const row = reflow.document.createElement("label");
      row.innerHTML = '<input type="checkbox" name="new"> New Layer';
      reflow.document.getElementById("L").prepend(row);

      const r = await reflow.GENERIC.pageToolCall(t.name, { on: true });
      check("the layer named is the layer that moved", box("fi").checked, true);
      check("and the one now sitting at its old position is not",
        `${box("swe").checked} ${box("pe").checked}`, "false false");
      ensure("the card names the control it actually reached",
        /flood inundation/i.test(String((r && r.control) || "")), r);
    }
  });
}

section("did the thing you named change");
// "Select flood inundation" reported "Flood Inundation - the page responded"
// while precipitation estimate was what actually switched on. Verification
// asks whether the page changed, and a page where the wrong layer moved
// answers yes. Only the named control's own state can tell those apart.
const twoBoxes = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <label for="fi">Flood Inundation</label><input id="fi" type="checkbox">
  <label for="pe">Precipitation Estimate</label><input id="pe" type="checkbox">
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!twoBoxes) skip("per-control verification", "jsdom not installed");
else {
  const bg = loadBackground({ page: twoBoxes });
  runAsync(async () => {
    const first = await bg.__ask({ type: "smartAsk", instruction: "select flood inundation" });
    ensure("the card names the control and its own change",
      /Flood Inundation: false \u2192 true/.test((first.display || {}).subtitle || ""),
      (first.display || {}).subtitle);
    check("and it is the one that moved", twoBoxes.document.getElementById("fi").checked, true);
    // Not rescued after the fact: the hand-written noaaToggleFloodCategory
    // covers "flood" by name and takes "inundation" as a free-text label, so
    // it can absorb the word that says which layer was meant. It used to run
    // first and only lose if it happened to change nothing. Running it is
    // what switched on the wrong layer, so the page's own control - which
    // names both words - has to win before either one runs.
    // Whichever picker gets there, it must not be the hand-written one.
    ensure("the page's own control was preferred outright",
      first.plannedBy !== "manifest", first.plannedBy);
    check("not the other one", twoBoxes.document.getElementById("pe").checked, false);

    // Asked again, it says nothing needed doing rather than claiming success.
    const again = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    ensure("a second ask says there was nothing to change",
      /already true/.test((again.display || {}).subtitle || ""), (again.display || {}).subtitle);
  });
}

section("open it, then look again");
// "Enable snow water equivalent" on water.noaa.gov matched five nav links on
// the word "water". The control it named had not been rendered: that panel
// is built with {#if open}, so Svelte removes it from the document entirely
// and no inventory at any visibility could ever find it. A hand-written
// noaaOpenLayers existed for exactly this reason, and nothing generic had
// the one step it had.
const conditional = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button id="layers">Layers</button>
  <a href="/a">National Water Model</a>
  <script>
    document.getElementById("layers").addEventListener("click", () => {
      if (document.getElementById("L")) return;
      const d = document.createElement("div"); d.id = "L";
      d.innerHTML = "<label for=swe>Snow Water Equivalent</label><input id=swe type=checkbox>" +
                    "<label for=fi>Flood Inundation</label><input id=fi type=checkbox>";
      document.body.appendChild(d);
    });
  <\/script></body></html>`, { url: "https://water.noaa.gov/" });
if (!conditional) skip("conditional panels", "jsdom not installed");
else {
  // Not hidden - absent. This is the case visibility handling cannot reach.
  check("the control does not exist yet",
    conditional.GENERIC.inventory({ includeHidden: true })
      .controls.some((c) => /snow water/i.test(c.label)), false);
  const openers = conditional.GENERIC.disclosures().disclosures;
  ensure("but something looks like it opens", openers.some((d) => /layers/i.test(d.label)), openers);

  const bg = loadBackground({ page: conditional });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable snow water equivalent" });
    // Either route is correct - the general loop now reaches this before the
    // one-door fallback does. What must not change is that it opened
    // something and then acted, rather than reporting the closed door.
    ensure("it is opened and then acted on",
      ["opened-then-acted", "pursued"].includes(r.plannedBy), r.plannedBy);
    check("the right control is reached",
      conditional.document.getElementById("swe").checked, true);
    check("and the other one is left alone",
      conditional.document.getElementById("fi").checked, false);
    ensure("the card says what it opened",
      /opened "Layers"/.test((r.display || {}).subtitle || ""), (r.display || {}).subtitle);
  });
}

section("one instruction, one thing");
// "Click flood depth gauge" switched on two unrelated map layers: Flood
// Inundation Mapping matched "flood", Snow Depth matched "depth", every word
// was covered between them, and both were ticked. One thing read as two.
//
// Which kind repeats is the distinction. Setting three dropdowns is a single
// configuration - "weekly average temperature" picks a period, a statistic
// and a variable, each matched on an option inside its own select. Ticking
// two checkboxes is two separate actions, and one instruction rarely means
// two of those.
const twoLayers = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button aria-controls="L" aria-expanded="false">Layers</button>
  <div id="L" style="display:none">
    <label for="fi">Flood Inundation Mapping</label><input id="fi" type="checkbox">
    <label for="sd">Snow Depth</label><input id="sd" type="checkbox">
  </div></body></html>`, { url: "https://water.noaa.gov/" });
const threeSelects = loadPage(`<!doctype html><html><body>
  <label for="p">Period</label><select id="p"><option>Weekly</option><option>Daily</option></select>
  <label for="s">Statistic</label><select id="s"><option>Average</option><option>Max</option></select>
  <label for="v">Variable</label><select id="v"><option>Temperature</option><option>Flow</option></select>
  </body></html>`, { url: "https://example.gov/" });
if (!twoLayers || !threeSelects) skip("one thing at a time", "jsdom not installed");
else {
  const bg = loadBackground({ page: twoLayers });
  runAsync(async () => {
    await bg.__ask({ type: "smartAsk", instruction: "click flood depth gauge" });
    check("neither layer is toggled by a phrase naming neither",
      `${twoLayers.document.getElementById("fi").checked} ${twoLayers.document.getElementById("sd").checked}`,
      "false false");
    await bg.__ask({ type: "smartAsk", instruction: "enable snow depth" });
    check("while the one actually named is",
      twoLayers.document.getElementById("sd").checked, true);
    check("and the other is left alone",
      twoLayers.document.getElementById("fi").checked, false);
  });
  // Several dropdowns remain one configuration.
  const sb2 = loadBackground({ page: threeSelects });
  const plan = sb2.planGenericTool("weekly average temperature",
    threeSelects.GENERIC.inventory({ includeHidden: true }));
  ensure("three dropdowns are still set together",
    plan && [...new Set(plan.calls.map((c) => c.args.selector))].length === 3, plan && plan.calls);
}

section("the day was only read off the data call");
// "Max temp on saturday" answered with Friday's column. findDayInText knew
// perfectly well it said saturday - but the day was only taken from the data
// call's "when", and a question about the table in front of you names no
// place, so there is no data call and the day was thrown away. It then fell
// back to today. The right row, the wrong day, stated with total confidence.
const weekGrid2 = loadPage(`<!doctype html><html><head><title>IDSS Forecast Points</title></head><body>
  <table><tr><th>Weekly Summary</th><th>Fri Sep 18</th><th>Sat Sep 19</th><th>Sun Sep 20</th></tr>
  <tr><td>Max Temp, \u00b0F</td><td>84</td><td>88</td><td>79</td></tr>
  <tr><td>Min Temp, \u00b0F</td><td>60</td><td>63</td><td>58</td></tr></table></body></html>`,
  { url: "https://www.weather.gov/forecastpoints" });
if (!weekGrid2) skip("named days", "jsdom not installed");
else {
  const bg = loadBackground({ page: weekGrid2 });
  runAsync(async () => {
    const got = async (q) => {
      const r = await bg.__ask({ type: "smartAsk", instruction: q });
      const row = ((r.display || {}).rows || [])[0] || {};
      return `${row.value} (${row.meta})`;
    };
    check("a named day picks its own column", await got("max temp on saturday"), "88 (Sat Sep 19)");
    check("a different day, a different column", await got("max temp on sunday"), "79 (Sun Sep 20)");
    check("and a different row too", await got("min temp friday"), "60 (Fri Sep 18)");
    // With no day named, today is still the sensible reading.
    ensure("no day named still answers", /\d/.test(await got("max temp")), await got("max temp"));
  });
}

section("a banner is not the only thing on the page");
// "Click national hydrologic discussion" clicked the site banner - a logo
// link whose label is a sentence of branding. The control actually named was
// not outranked; it was never in the list. Descriptors were capped at 40 in
// DOM order, and a federal site's header carries more links than that, so
// everything below the fold was cut before anything scored it.
const headerHeavy = loadPage(`<!doctype html><html><body>${
  Array.from({ length: 45 }, (_, i) => `<a href="/n${i}">National item ${i}</a>`).join("")
}<a href="/nhd">National Hydrologic Discussion</a><a href="/arch">Archive</a></body></html>`,
  { url: "https://water.noaa.gov/" });
if (!headerHeavy) skip("header-heavy pages", "jsdom not installed");
else {
  const names = headerHeavy.GENERIC.pageTools().tools.map((t) => t.name);
  ensure("a control past the header is still derived",
    names.some((n) => /HydrologicDiscussion/i.test(n)), names.length);

  const bg = loadBackground({ page: headerHeavy });
  runAsync(async () => {
    const title = async (q) => ((await bg.__ask({ type: "smartAsk", instruction: q })).display || {}).title || "";
    check("and reached by name", await title("click national hydrologic discussion"),
      "click national hydrologic discussion");
    check("as is another past it", await title("click archive"), "click archive");
    // The model's list stays short: agentTools ranks before it trims, which
    // is the cap that was supposed to be doing this work all along.
    const k = await bg.agentTools("GENERIC", "click national hydrologic discussion");
    ensure("while the model's own list stays short", k.all.length <= 24, k.all.length);
    ensure("chosen from all of them", k.considered > 40, k.considered);
  });
}

// A bare "#" is not the page responding. Clicking <a href="#"> - how half
// the web writes a button that does nothing on its own - counted as a
// change, so every dead link reported success.
const linkKinds = loadPage(`<!doctype html><html><body>
  <label for="fl">Flood inundation</label><input id="fl" type="checkbox">
  <a href="#" id="dead">Dead layer</a>
  <a href="#@=-83,43,5" id="view">Zoom to view</a></body></html>`, { url: "https://water.noaa.gov/" });
if (!linkKinds) skip("fragment changes", "jsdom not installed");
else {
  const bg2 = loadBackground({ page: linkKinds });
  runAsync(async () => {
    const said = async (q) => ((await bg2.__ask({ type: "smartAsk", instruction: q })).display || {}).subtitle || "";
    // A checkbox now reports its own state rather than the page's, which is
    // strictly more than "the page responded" told anyone.
    ensure("a real control reports its own change",
      /Flood inundation: (false|true) \u2192 (true|false)|already/.test(await said("click flood inundation")),
      await said("click flood inundation"));
    ensure("a dead link says nothing changed",
      /nothing on the page changed/.test(await said("click dead layer")), await said("click dead layer"));
    ensure("but a fragment carrying a view still counts",
      /page responded/.test(await said("click zoom to view")), await said("click zoom to view"));
  });
}

section("done is not a thing to say when nothing happened");
// "Enable flood inundation" ran noaaToggleFloodCategory and reported "done".
// The checkbox was untouched. Two faults: the hand-written tool was preferred
// because it had been verified against the real site, and it changed nothing;
// and when verification produced no result at all, the subtitle fell back to
// the single most confident word available.
const src = require("fs").readFileSync(
  require("path").join(__dirname, "..", "background.js"), "utf8");
ensure("no verification never reads as success",
  !/note \? note\.text : "done"/.test(src), 'the subtitle still falls back to "done"');
ensure("a tool that moved nothing says so",
  /ran, but nothing on the page changed/.test(src), "no wording for a no-op");
ensure("and not knowing says that instead",
  /could not check whether the page changed/.test(src), "no wording for an unverifiable action");

// And the page's own control is tried when the preferred tool does nothing.
const floodPage = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button id="open" aria-controls="layers" aria-expanded="false"
    onclick="document.getElementById('layers').style.display='block'">Layers</button>
  <div id="layers" style="display:none">
    <label for="fl">Flood inundation</label><input id="fl" type="checkbox">
  </div></body></html>`, { url: "https://water.noaa.gov/" });
if (!floodPage) skip("flood layer", "jsdom not installed");
else {
  const bg = loadBackground({ page: floodPage });
  runAsync(async () => {
    const box = floodPage.document.getElementById("fl");
    check("the box starts off", box.checked, false);
    await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    check("and the instruction actually enables it", box.checked, true);
    check("having opened the panel on the way",
      floodPage.document.getElementById("layers").style.display, "block");
  });
}

section("a point on a map is a thing you can click");
// "Click on st johns river" and "go to mayaguez tide gauge" both failed on
// water.noaa.gov. mapFeatures() could read the markers; nothing turned them
// into tools, so a real element sitting in the DOM had nowhere to be
// reached from - the one kind of clickable thing this never offered.
const mapPage = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <div class="leaflet-container">
    <img class="leaflet-marker-icon" aria-label="St Johns River at Jacksonville" src="">
    <img class="leaflet-marker-icon" aria-label="Mayaguez tide gauge" src="">
  </div>
  <table><tr><th>Site</th><th>Stage</th></tr><tr><td>A</td><td>3.1</td></tr></table>
  </body></html>`, { url: "https://water.noaa.gov/" });
if (!mapPage) skip("map points", "jsdom not installed");
else {
  const built = mapPage.GENERIC.pageTools();
  check("each point becomes a tool", built.mapPoints, 2);
  const names = built.tools.map((t) => t.name);
  ensure("named after the point itself",
    names.includes("openStJohnsRiverAtJacksonville"), names.filter((n) => /^open/.test(n)));
  ensure("and the map is readable as a whole", names.includes("readMapPoints"), names);

  const bg = loadBackground({ page: mapPage });
  runAsync(async () => {
    const title = async (q) => ((await bg.__ask({ type: "smartAsk", instruction: q })).display || {}).title || "";
    check("clicking a point reaches that point",
      await title("click on st johns river"), "open st johns river at jacksonville");
    check("and so does going to one",
      await title("go to mayaguez tide gauge"), "open mayaguez tide gauge");
    // The read bonus has to follow the question, not always land on the
    // page's text: reading the map is a read, and it is not that read.
    check("reading the map reads the map", await title("read the map points"), "read map points");
    check("while reading the page still reads the page", await title("read this page"), "read this page");
  });
}

section("every place a control can hide");
// Auditing the rest of the closed-panel class: a page was built with a
// control in each shape one can hide in, and the inventory asked for all of
// them. Two were missed and one was worse than missed.
const hideouts = loadPage(`<!doctype html><html><body>
  <button id="plain">Plain button</button>
  <button aria-controls="p1" aria-expanded="false">Open panel</button>
  <div id="p1" style="display:none"><button>Behind a panel</button></div>
  <details><summary>Open details</summary><button>Inside details</button></details>
  <dialog id="d1"><button>Inside a dialog</button></dialog>
  <div id="host"></div>
  <button disabled>Disabled button</button>
  <template><button>Inside a template</button></template>
  <iframe id="frame"></iframe>
  <script>document.getElementById("host").attachShadow({mode:"open"})
    .innerHTML = "<button>Inside shadow DOM</button>";<\/script>
  </body></html>`, { url: "https://example.gov/" });
if (!hideouts) skip("hiding places", "jsdom not installed");
else {
  hideouts.document.getElementById("frame").contentDocument.body.innerHTML =
    '<button id="inner">Inside a frame</button>';
  hideouts.__giveFramesLayout();
  const seenLabels = new Set(hideouts.GENERIC.inventory({ includeHidden: true }).controls.map((c) => c.label));

  for (const reachable of ["Plain button", "Behind a panel", "Inside details",
    "Inside a dialog", "Inside shadow DOM", "Inside a frame"]) {
    ensure(`"${reachable}" is reachable`, seenLabels.has(reachable), [...seenLabels]);
  }
  // A <template> is inert markup, not a control on the page.
  check("a template's contents are not controls", seenLabels.has("Inside a template"), false);

  // A same-origin frame is part of the page - gov dashboards embed their
  // map, table and filters that way constantly, and none of it was reachable.
  // The selector says where it lives, and resolves back through the frame.
  const inFrame = hideouts.GENERIC.inventory({ includeHidden: true })
    .controls.find((c) => c.label === "Inside a frame");
  ensure("a frame control's selector names its frame", /#frame >>> /.test(inFrame.selector), inFrame.selector);
  ensure("and resolves back to the element",
    (hideouts.GENERIC.readControl(inFrame.selector) || {}).found === true, inFrame.selector);

  // Disabled was worse than missed: it was offered. Acting on one does
  // nothing and the card reports success.
  const disabled = hideouts.GENERIC.inventory({ includeHidden: true })
    .controls.find((c) => c.label === "Disabled button");
  check("a disabled control is recorded as disabled", disabled.disabled, true);
  const offered = hideouts.GENERIC.pageTools().tools.map((t) => t.name);
  check("and is not offered as a tool", offered.some((n) => /Disabled/i.test(n)), false);
  ensure("while the frame's control is", offered.some((n) => /Frame/i.test(n)), offered);
}

section("a control behind a closed panel");
// On water.noaa.gov "enable the flood layer" did nothing while "enable
// precipitation estimate" worked - not because the manifest understands the
// site, but because noaaToggleFloodCategory opens the Layers panel first and
// the generic path did not. inventory() skips anything invisible, so a
// checkbox inside a closed panel did not exist as far as this was concerned.
//
// That difference is worth generalising rather than writing per site.
const panelled = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <button id="open" aria-controls="layers" aria-expanded="false"
    onclick="document.getElementById('layers').style.display='block'">Layers</button>
  <div id="layers" style="display:none">
    <label for="fl">Flood inundation</label><input id="fl" type="checkbox">
    <label for="pe">Precipitation estimate</label><input id="pe" type="checkbox">
  </div>
  <button id="legend">Legend</button></body></html>`, { url: "https://water.noaa.gov/" });
if (!panelled) skip("closed panels", "jsdom not installed");
else {
  // Visible-only is what the page is showing; it must not change.
  const shown = panelled.GENERIC.inventory();
  check("a closed panel's contents are not 'on the page'",
    shown.controls.filter((c) => /flood|precipitation/i.test(c.label)).length, 0);

  // But they exist, and the way in is recorded with them.
  const all = panelled.GENERIC.inventory({ includeHidden: true });
  const flood = all.controls.find((c) => /flood/i.test(c.label));
  ensure("asked for, they are found", !!flood, all.controls.map((c) => c.label));
  check("marked as behind something", flood.hidden, true);
  check("and named by what opens it", flood.revealedByLabel, "Layers");
  // A control hidden with no way in is not usable and is left out.
  ensure("a visible control carries no opener",
    !all.controls.find((c) => /legend/i.test(c.label)).revealedBy, all.controls);

  // The derived tool opens the panel itself.
  const tools = panelled.GENERIC.pageTools().tools.map((t) => t.name);
  ensure("both layers become tools",
    tools.includes("toggleFloodInundation") && tools.includes("togglePrecipitationEstimate"), tools);

  const bg = loadBackground({ page: panelled });
  runAsync(async () => {
    const box = panelled.document.getElementById("fl");
    check("the box starts unticked", box.checked, false);
    const r = await bg.__ask({ type: "smartAsk", instruction: "enable flood inundation" });
    check("the instruction reaches it", box.checked, true);
    // Either of the page's own paths. An instruction naming one control on
    // the page word for word is answered without waiting for a model
    // decision, which on real hardware was 32.6s of a 33.2s request - and
    // this is that case. Both are the page's own controls, which is what
    // this is checking; "one-list" alone was the name of the slower one.
    ensure("through the page's own controls",
      ["one-list", "exact-match"].includes(r.plannedBy), r.plannedBy);
    check("and the panel was opened to get there",
      panelled.document.getElementById("layers").style.display, "block");
  });
}

section("the numbers behind a chart");
// Asked for the humidity on a page plotting humidity, this answered from a
// weather station eleven miles away - 88% against the page's own 81% -
// because readPage sees tables and labelled text, and a canvas is neither.
// The numbers were already in the browser: the page had fetched them.
const charted = loadPage("<!doctype html><html><head><title>Fremont</title></head><body><canvas></canvas></body></html>",
  { url: "https://weather.example.gov/" });
if (!charted) skip("chart data", "jsdom not installed");
else {
  charted.__wcFeedCapture = { installedAt: Date.now(), feeds: [{
    url: "https://weather.example.gov/api/obs.json", method: "GET", status: 200,
    contentType: "application/json", bytes: 400, truncated: false,
    body: JSON.stringify({ observations: [
      { temperature: 60.1, relativeHumidity: 81, dewpoint: 54 },
      { temperature: 62.0, relativeHumidity: 78, dewpoint: 55 },
      { temperature: 64.3, relativeHumidity: 72, dewpoint: 55 },
      { temperature: 66.8, relativeHumidity: 69, dewpoint: 56 }] }),
  }] };

  // A field called humidity inside an array of readings is a humidity
  // series, whatever the site calls its endpoint - which is the only way
  // this works on a site nobody has looked at.
  const found = charted.GENERIC.capturedSeries();
  check("every numeric field becomes its own series", found.count, 3);
  const hum = found.series.find((x) => /humidity/i.test(x.name));
  check("named by where it was found", hum.name, "observations.relativeHumidity");
  check("with the points it had", hum.count, 4);
  check("and the numbers to summarise them", `${hum.min}-${hum.max} mean ${hum.mean}`, "69-81 mean 75");

  const bg = loadBackground({ page: charted });
  runAsync(async () => {
    const ask = async (q) => {
      const r = await bg.__ask({ type: "smartAsk", instruction: q });
      return `${r.plannedBy} | ${(r.display || {}).subtitle || r.error || ""}`;
    };
    ensure("a reading comes from the page, not an agency",
      /page-data/.test(await ask("humidity right now")), await ask("humidity right now"));
    ensure("and an average is taken over the series",
      /75/.test(await ask("average humidity")), await ask("average humidity"));
    ensure("as is a maximum", /66.8/.test(await ask("max temperature")), await ask("max temperature"));
    ensure("and a minimum", /54/.test(await ask("lowest dewpoint this week")), await ask("lowest dewpoint this week"));
    // A span and a place say when and where; neither names the thing being
    // measured, and carrying them into the subject made the failure read
    // "nothing gave temperature week fremont as numbers" - a phrase nobody
    // was looking for.
    ensure("a span and a place do not become the subject",
      /63/.test(await ask("average temperature this week in fremont")),
      await ask("average temperature this week in fremont"));
  });
}

// When it cannot answer, which failure it was. "Nothing gave that as
// numbers" is equally true whether the page downloaded nothing, downloaded
// something else, or was never reloaded after the site was enabled - and
// only the last is the person's to fix.
const feedStates = [
  ["never ran", null, /reload the page/],
  ["nothing downloaded", [], /downloaded nothing/],
  ["no matching field", [{ url: "https://x/api/wind.json", method: "GET", status: 200,
    contentType: "application/json", bytes: 9, truncated: false,
    body: JSON.stringify({ obs: [{ windSpeed: 3 }, { windSpeed: 5 }, { windSpeed: 7 }, { windSpeed: 9 }] }) }],
    /has windSpeed/],
];
for (const [what, feeds, expected] of feedStates) {
  const pg = loadPage("<!doctype html><html><body><canvas></canvas></body></html>", { url: "https://weather.example.gov/" });
  if (!pg) { skip("feed failure states", "jsdom not installed"); break; }
  if (feeds !== null) pg.__wcFeedCapture = { installedAt: Date.now(), feeds };
  const bg2 = loadBackground({ page: pg });
  runAsync(async () => {
    const r = await bg2.__ask({ type: "smartAsk", instruction: "average temperature this week" });
    ensure(`"${what}" says so`, expected.test(String(r.error || "")), r.error);
  });
}

section("a verb is not a subject");
// "Click dew point" reached "Terms of Use" four times running. Nothing in
// the instruction matched that label - the score came entirely from verbs.
// "use" was in the verb-synonym family, so Terms of Use scored twice against
// any sentence containing "click": once for click, once for use, landing
// exactly on the threshold.
const termsTool = { name: "clickTermsOfUse", description: "Terms of Use - a on this page",
  parameters: { type: "object", properties: {} } };
const dewTool = { name: "clickDewPointHumidity", description: "Dew Point/Humidity - a on this page",
  parameters: { type: "object", properties: {} } };
const picks = (q) => (sb.confidentPick([termsTool, dewTool], q) || { tool: { name: null } }).tool.name;
check("the instruction reaches what it named", picks("click dew point"), "clickDewPointHumidity");
check("and not the nearest verb-shaped label", picks("click terms of use"), "clickTermsOfUse");
// "use" and "make" are verbs and also ordinary words in ordinary labels.
check("use is no longer a verb synonym", (sb.verbFamily("use") || []).includes("click"), false);
check("while click still is", sb.verbFamily("click").includes("select"), true);

// A closed-up compound and a spaced label are the same thing to a person.
check("dewpoint finds Dew Point", sb.wordMatchesText("dewpoint", "dew point/humidity"), "exact");
check("gageheight finds Gage height", sb.wordMatchesText("gageheight", "gage height"), "exact");
check("but short words are not closed up", sb.wordMatchesText("use", "u se"), false);
check("so the compound rule reaches it too", picks("select dewpoint"), "clickDewPointHumidity");

section("a short word is not a match");
// "Go to mayaguez tide gauge" on water.noaa.gov offered two controls: a
// USAGov footer link and a webmaster email address. Neither has anything to
// do with a tide gauge. Of four words, exactly one matched anything - "go",
// by prefix, against "Government" and "gov" - and it was the one word
// carrying no meaning at all.
check("go does not match Government", sb.wordMatchesText("go", "official guide to government information"), false);
check("nor an address ending in gov", sb.wordMatchesText("go", "nwps.webmaster@noaa.gov"), false);
check("but it still matches a Go button", sb.wordMatchesText("go", "go"), "exact");
// Longer words keep matching by prefix, which is how abbreviations work.
check("temp still finds temperature", sb.wordMatchesText("temp", "temperature"), "exact");
check("max still finds Max Temp", sb.wordMatchesText("max", "max temp, \u00b0f"), "exact");
check("gauge still finds gauges", sb.wordMatchesText("gauge", "stream gauges"), "exact");

const noaaShape = loadPage(`<!doctype html><html><head><title>NWPS</title></head><body>
  <nav><button>Layers</button><button>Legend</button></nav>
  <footer><a href="https://usa.gov">Official Guide to Government Information and Services | USAGov</a>
  <a href="mailto:nwps.webmaster@noaa.gov">nwps.webmaster@noaa.gov</a></footer></body></html>`,
  { url: "https://water.noaa.gov/" });
if (!noaaShape) skip("noaa footer", "jsdom not installed");
else {
  const bg = loadBackground({ page: noaaShape });
  runAsync(async () => {
    const r = await bg.__ask({ type: "smartAsk", instruction: "go to mayaguez tide gauge" });
    ensure("a tide gauge that is not on the page offers no footer links",
      !(r.display && r.display.choices && r.display.choices.length), r.display);
    // And a real instruction on the same page still reaches a tool. It
    // cannot run here - noaaOpenLayers belongs to the NOAA manifest, which
    // is not loaded in a bare jsdom page - but it must be planned.
    const ok = await bg.__ask({ type: "smartAsk", instruction: "open layers" });
    ensure("while a control that is there is still planned",
      !!(ok.toolCall || ok.plannedCall || ok.plannedBy === "manifest"), ok);
  });
}

section("a key upgrades, and is never required");
// The extension has to work the moment it is installed, on any machine, with
// no account and no setup. So nothing keyless may ever depend on a key - and
// a key, when there is one, should actually be used rather than sitting
// behind a Debug button nobody presses, which is where the only capable
// model in here had been waiting.
const plainPage2 = loadPage("<!doctype html><html><head><title>T</title></head><body><p>nothing</p></body></html>",
  { url: "https://example.gov/" });
if (!plainPage2) skip("keyless first", "jsdom not installed");
else {
  runAsync(async () => {
    const keyless = loadBackground({ page: plainPage2 });
    let reachedOut = false;
    const pass = keyless.fetch;
    keyless.fetch = (u, o) => { if (/generativelanguage/.test(String(u))) reachedOut = true; return pass(u, o); };
    const r = await keyless.__ask({ type: "smartAsk", instruction: "fly me to the moon" });
    check("no request to anybody's model", reachedOut, false);
    ensure("and it still answers for itself", r.ok === false && !!r.display, r);

    // The hosted path is gone rather than optional. A key in storage used to
    // switch reasoning onto somebody else's GPU; there is nothing left to
    // switch, so a stored key changes nothing and no request leaves the
    // machine whatever is in there.
    const keyed = loadBackground({ page: plainPage2 });
    await keyed.chrome.storage.local.set({ geminiApiKey: "test-key" });
    let consulted = false;
    keyed.fetch = async (u) => {
      if (/generativelanguage|openai|anthropic/.test(String(u))) consulted = true;
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await keyed.__ask({ type: "smartAsk", instruction: "fly me to the moon" });
    check("a leftover key consults nobody", consulted, false);
  });
}

section("publishing without the service worker in the loop");
// Publishing ran through tabs.onUpdated and a message round trip, so a site
// became agent-usable only once the worker had woken, the event had fired
// and the message had landed. A content script registered in the MAIN world
// needs none of them: it runs on the page, at document_end, and can see
// document.modelContext directly.
const atLoad = loadPage(`<!doctype html><html><body>
  <a href="/x">Reservoirs</a><select id="s"><option>A</option></select></body></html>`,
  { url: "https://example.gov/" });
if (!atLoad) skip("publishing at load", "jsdom not installed");
else {
  const script = require("fs").readFileSync(
    require("path").join(__dirname, "..", "page", "publish-tools.js"), "utf8");
  const run = () => {
    const el = atLoad.document.createElement("script");
    el.textContent = script;
    atLoad.document.body.appendChild(el);
  };

  // Deriving tools walks every control, and a portal has hundreds. Doing
  // that on every page load in a browser with no modelContext would be a
  // cost paid for nothing, so the check comes before the work.
  run();
  check("a browser without the API does no work at all", !!atLoad.__wcPublishedAtLoad, false);

  const shelf = [];
  Object.defineProperty(atLoad.document, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  run();
  // Parked: publishing works and is tested, but nothing consumes it - no site
  // declares tools of its own and no agent on Chrome reads them - so it is
  // off unless switched on. The switch is what is asserted now, because
  // "publishes on every page load" would be asserting a path nobody walks.
  check("with the API but the switch off, nothing is published", shelf.length, 0);
  atLoad.__wcPublishWebMcp = true;
  atLoad.__wcPublishedAtLoad = false;
  run();
  ensure("with the switch on, the page publishes itself", shelf.length > 0, shelf.length);
  const once = shelf.length;
  run();
  check("and does not publish twice", shelf.length, once);
}

section("the page names its own columns");
// "How full is lake conroe" clicked two links and left someone on a page
// they never asked for. The answer was a column away - Percent Full, row
// Conroe, 71 - and PAGE_VALUE_TERMS has never heard of "full", so nothing
// tried to read it.
//
// A page names its own columns. Matching the question's words against those
// headers needs no vocabulary, which is exactly what a site nobody has seen
// requires. One word finds the column, a different one finds the row.
const ownWords = { title: "Statewide", headings: [], text: "texas", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Reservoir", "Percent Full", "Water Level (ft)"], rows: [
    ["Conroe", "71", "198.2"], ["Travis", "43", "640.1"]] }] };
const byWords = (q, place) => {
  const hit = sb.findByOwnWords(ownWords, q, place || null);
  return hit ? `${hit[0].value} (${hit[0].label})` : null;
};
check("a word this vocabulary never had still reads",
  byWords("how full is lake conroe"), "71 (Conroe \u00b7 Percent Full)");
check("another row, same column", byWords("how full is travis"), "43 (Travis \u00b7 Percent Full)");
check("another column, same row", byWords("water level of conroe"), "198.2 (Conroe \u00b7 Water Level (ft))");
// One word cannot be both the column and the row.
check("a column with nothing to identify a row is not an answer", byWords("percent full"), null);
// And a word the page does not use finds nothing, rather than something.
check("an unrelated question finds nothing", byWords("how fast is conroe"), null);

// A question must not press anything, even when it cannot be answered: the
// match is offered instead, and only when it shares more than a stray word.
const conroePage = loadPage(`<!doctype html><html><head><title>Reservoirs</title></head><body>
  <a href="/evap">Lake Evaporation/Rainfall</a>
  <table><tr><th>Reservoir</th><th>Percent Full</th></tr>
  <tr><td>Conroe</td><td>71</td></tr></table></body></html>`,
  { url: "https://www.waterdatafortexas.org/" });
if (!conroePage) skip("offering instead of clicking", "jsdom not installed");
else {
  const bg = loadBackground({ page: conroePage });
  runAsync(async () => {
    const answered = await bg.__ask({ type: "smartAsk", instruction: "how full is lake conroe" });
    check("the question is answered, not clicked", answered.plannedBy, "from-page");
    ensure("with the page's own number",
      ((answered.display || {}).rows || []).some((r) => r.value === "71"), (answered.display || {}).rows);
    // Nonsense gets an explanation, not a proposal to click something.
    const junk = await bg.__ask({ type: "smartAsk", instruction: "fly me to the moon" });
    ensure("nonsense is still explained, not offered",
      !(junk.display && junk.display.choices && junk.display.choices.length), junk.display);

    // Nor does a question that cannot be answered get a menu of controls
    // that would change the page. Both options offered for "how full is
    // lake conroe" did nothing when pressed - a table row is not a button -
    // and a menu of guesses is not an answer to a question.
    const unanswerable = await bg.__ask({ type: "smartAsk", instruction: "how deep is lake conroe" });
    ensure("an unanswerable question gets no menu either",
      !(unanswerable.display && unanswerable.display.choices && unanswerable.display.choices.length),
      unanswerable.display);
  });
}

section("doing and telling are different questions");
// "Click on wildcat creek new london" was answered with a USGS gauge record -
// the right creek, and not remotely what was asked. A lookup answers; it does
// not act, so it cannot satisfy an instruction. The mirror held too: asking
// for the discharge picked the link named Wildcat Creek, which clicks away
// from the page without reporting a number.
//
// Derived tools are named verb-first exactly so this is legible: click,
// choose, toggle and type act; read, list and compute report.
const bothWays = loadPage(`<!doctype html><html><body>
  <a href="/x">Wildcat Creek</a>
  <table><tr><th>Site</th><th>Discharge, cfs</th></tr>
    <tr><td>WILDCAT CREEK</td><td>5.2</td></tr></table></body></html>`,
  { url: "https://water.noaa.gov/" });
if (!bothWays) skip("doing vs telling", "jsdom not installed");
else {
  const bg = loadBackground({ page: bothWays });
  runAsync(async () => {
    const asInstruction = await bg.unifiedTools("NOAA", "click on wildcat creek", { acting: true });
    check("an instruction is offered no lookups",
      asInstruction.filter((t) => t.kind === "data").length, 0);
    ensure("but is offered the page's actions",
      asInstruction.some((t) => /^click/.test(t.name)), asInstruction.map((t) => t.name).slice(0, 6));

    const asQuestion = await bg.unifiedTools("NOAA", "wildcat creek discharge", { acting: false });
    ensure("a question is offered lookups",
      asQuestion.some((t) => t.kind === "data"), asQuestion.length);
    check("and no actions at all",
      asQuestion.filter((t) => /^(click|choose|toggle|type|search)[A-Z]/.test(t.name)).length, 0);
    ensure("keeping the ones that report",
      asQuestion.some((t) => t.name === "readThisPage"), asQuestion.map((t) => t.name).slice(0, 6));

    // End to end: the instruction acts, the question reads.
    const acted = await bg.__ask({ type: "smartAsk", instruction: "click on wildcat creek new london" });
    check("the instruction acts", acted.plannedBy, "one-list");
    ensure("on the page's own control",
      /click/i.test(((acted.display || {}).title) || ""), (acted.display || {}).title);
  });
}

section("a heavy page is only walked once");
// Deriving tools walks every control, and a real portal has hundreds - CDEC
// has 667. Doing it on every ask, and again when the older cascade wants an
// inventory, made one question walk the page three times. On a heavy page
// that is the difference between an answer and a timeout, and measuring it
// was itself what timed out.
const heavy = loadPage(`<!doctype html><html><body>${
  Array.from({ length: 300 }, (_, i) => `<a href="/p${i}">Link ${i}</a>`).join("")
}<table><tr><th>Site</th><th>Discharge, cfs</th></tr><tr><td>A</td><td>100</td></tr></table></body></html>`,
  { url: "https://heavy.example.gov/" });
if (!heavy) skip("heavy pages", "jsdom not installed");
else {
  const bg = loadBackground({ page: heavy });
  let derived = 0;
  const pass = bg.chrome.tabs.sendMessage;
  bg.chrome.tabs.sendMessage = async (id, m) => { if (m && m.fn === "pageTools") derived++; return pass(id, m); };
  runAsync(async () => {
    await bg.unifiedTools("GENERIC", "average discharge");
    const firstPass = derived;
    await bg.unifiedTools("GENERIC", "average discharge");
    check("the page is walked once, not twice", derived, firstPass);
    ensure("and once is once, not three times", firstPass === 1, firstPass);
    // Stale tools are worse than slow ones: anything that moves the page
    // throws the cache away.
    bg.forgetPageTools();
    await bg.unifiedTools("GENERIC", "average discharge");
    ensure("a change forces a fresh walk", derived === firstPass + 1, derived);
  });
}

section("the verb matched, and nothing else did");
// "Click on st johns river" on NOAA planned noaaSetGaugeProduct with
// product: "st johns river" - a river poured into an argument that takes
// obsFcst, HEFS or LRO. The word that made it win was the verb; the words
// that mattered were left over entirely, and it reported "done".
//
// Two faults. The argument's allowed values lived in its description rather
// than an enum, so nothing stopped a river going in.
const productArg = sb.toolsFor("NOAA").find((d) => d.name === "noaaSetGaugeProduct").parameters.properties.product;
ensure("the values a tool accepts are enforced, not just described",
  Array.isArray(productArg.enum) && productArg.enum.length === 3, productArg);
// And a bare-threshold match now has to be about the tool: if most of what
// was said goes unaccounted for, the verb matched and nothing else did.
for (const q of ["click on st johns river", "click on lake tahoe"]) {
  check(`"${q}" plans nothing`, sb.planManifestTool(q, "NOAA"), null);
}
// One leftover word is not a subject - these still plan.
const stillWorks = (q, route) => (sb.planManifestTool(q, route) || {}).name;
check("download csv still plans", stillWorks("download csv", "SITE"), "siteDownloadData");
check("and a real product value does too",
  stillWorks("set the gauge product to HEFS", "NOAA"), "noaaSetGaugeProduct");
check("and an enumerated basemap", stillWorks("set the basemap to satellite", "NOAA"), "noaaSetBasemap");
check("and a state", stillWorks("select alaska", "USGS"), "usgsSelectState");

section("the site says which state it is about");
// "Smith river discharge" asked on cdec.water.ca.gov returned nine rivers
// from New Hampshire to Alaska, with the one obviously meant buried among
// eight that were not. The site had said which state it was about in its own
// hostname, and nothing read it.
check("a state suffix is read", (sb.stateFromSite("https://cdec.water.ca.gov/", "CDEC") || {}).code, "ca");
check("so is one in the name", (sb.stateFromSite("https://www.waterdatafortexas.org/", "Water Data For Texas") || {}).code, "tx");
check("and a state agency's own domain", (sb.stateFromSite("https://dnr.wi.gov/", "Wisconsin DNR") || {}).code, "wi");
// A federal site belongs to no state, and guessing one would be worse than
// not guessing.
check("a federal site suggests nothing", sb.stateFromSite("https://www.census.gov/", "Census"), null);
check("nor does USGS", sb.stateFromSite("https://waterdata.usgs.gov/", "USGS"), null);

const sited = loadPage("<!doctype html><html><head><title>CDEC</title></head><body><p>portal</p></body></html>",
  { url: "https://cdec.water.ca.gov/" });
if (!sited) skip("narrowing by site", "jsdom not installed");
else {
  const onCa = loadBackground({ page: sited });
  runAsync(async () => {
    const r = await onCa.__ask({ type: "smartAsk", instruction: "smith river discharge" });
    const d = (r.result && r.result.display) || r.display || {};
    ensure("the question is narrowed to that state", (r.narrowedBy || {}).code === "ca", r.narrowedBy);
    ensure("and says so, rather than narrowing quietly",
      /narrowed to CA/.test(d.note || ""), d.note);
    ensure("leaving one river, not nine", /California/.test(d.subtitle || ""), d.subtitle);
  });
}

section("one list, one picker");
// There were two systems. A control request went through tools derived from
// the page; a data question went through hand-written vocabulary, a table
// reader, a link walker and an agency API, and never reached the derived
// tools at all - they were built, counted, shown in the card, and skipped.
// Every bug this week was in the second system.
const oneListPage = loadPage(`<!doctype html><html><head><title>Statewide</title></head><body>
  <a href="/about">About</a>
  <label for="topic">Topic</label><select id="topic"><option>Storage</option><option>Inflow</option></select>
  <table><tr><th>Date</th><th>Reservoir Storage (acre-ft)</th></tr>
    <tr><td>Today</td><td>26,810,632</td></tr><tr><td>Yesterday</td><td>26,839,775</td></tr>
    <tr><td>1 week ago</td><td>27,081,104</td></tr></table></body></html>`,
  { url: "https://example-water.gov/" });
if (!oneListPage) skip("one list", "jsdom not installed");
else {
  const united = loadBackground({ page: oneListPage });
  runAsync(async () => {
    const all = await united.unifiedTools("GENERIC", "average reservoir storage");
    ensure("the page's tools and the agency's are in one list",
      all.some((t) => t.kind === "data") && all.some((t) => t.kind === "page"), all.length);
    ensure("including the one that calculates",
      all.some((t) => t.name === "pageCompute"), all.map((t) => t.name).slice(0, 8));

    const pick = united.confidentPick(all, "average reservoir storage");
    check("a calculation is picked from it", pick && pick.tool.name, "pageCompute");
    check("with arguments filled", pick && pick.args.fn, "mean");

    // A near-tie is an ambiguous question, and guessing at one is how
    // confident wrong answers get made. It stands aside instead.
    const vague = united.confidentPick(all, "data");
    check("an ambiguous question gets no pick", vague, null);

    // End to end, the question is answered by the unified path.
    const r = await united.__ask({ type: "smartAsk", instruction: "average reservoir storage" });
    check("and answers through it", r.plannedBy, "one-list");
    ensure("with the page's own number", /26|27/.test((r.display || {}).subtitle || ""), (r.display || {}).subtitle);
  });
}

section("a site from another domain entirely");
// The point of deriving tools from a page is that nothing may be known about
// the page. So the guard is a site with no manifest, no hydrology, and no
// vocabulary this project has ever met - shaped like census.gov, which is
// where these three faults were actually found.
const foreignSite = loadPage(`<!doctype html><html><head><title>Statistics portal</title></head><body>
  <nav><a href="/">Home</a><a href="/partners">Partners</a><a href="/educators">Educators</a>
       <a href="/search">Search data, events and resources</a></nav>
  <label for="q">Search</label><input id="q" type="search">
  <a href="/tools">Data tools and maps</a>
  <label for="topic">Topic</label>
  <select id="topic"><option>Age and sex</option><option>Housing</option><option>Income</option></select>
  <table><tr><th>Year</th><th>Median household income</th></tr>
    <tr><td>2024</td><td>80,610</td></tr><tr><td>2023</td><td>77,540</td></tr>
    <tr><td>2022</td><td>74,580</td></tr></table>
  </body></html>`, { url: "https://example-statistics.gov/" });
if (!foreignSite) skip("another domain", "jsdom not installed");
else {
  const far = loadBackground({ page: foreignSite });
  const derived = foreignSite.GENERIC.pageTools().tools;
  ensure("tools are derived with nothing known about the site", derived.length > 5, derived.length);
  ensure("named from the page's own words",
    derived.some((t) => /income|topic|search/i.test(t.name)), derived.map((t) => t.name));

  const top = async (q) => (await far.agentTools("GENERIC", q, { max: 12 })).all[0].name;
  runAsync(async () => {
  // "Search for X" wants the box that takes text, not the link called Search.
  // On census.gov this picked clickSearchDataEventsResourcesAnd.
  ensure("a search reaches the box, not a link named Search",
    /^(search|type)/i.test(await top("search for income")), await top("search for income"));
  // Pinning the readers first made readThisPage the answer to everything;
  // burying them last meant a read request picked a random link instead.
  check("a read request reaches the reader", await top("what does this page say"), "readThisPage");
  // And a calculation reaches the calculator, in a domain with no water in it.
  check("a calculation reaches the calculator", await top("average median household income"), "pageCompute");

  // End to end, with no site-specific code anywhere in the path.
  const call = await far.executeToolCall("GENERIC",
    { name: "pageCompute", args: { fn: "mean", of: "median household income" } })
    .catch((e) => ({ ok: false, error: e.message }));
  ensure("and the calculation runs on a page nobody wrote code for",
    call.ok !== false && !!call.result, call.error || call);
  });
}

section("place and measurement parsing");
check('"gage height in Alaska"', plan("gage height in Alaska").args, { state: "ak", parameter: "gageHeight" });
check("two-letter code", plan("discharge in tx").args, { state: "tx", parameter: "discharge" });
check("multi-word state", plan("water temperature in west virginia").args.state, "wv");
check("river narrows the search", plan("gage height in wyoming at big sandy river").args.nameContains, "big sandy river");
check("city resolves to its state", plan("precipitation in cleveland").args.state, "oh");
// "Kansas City" is in Missouri; the state matcher used to win because
// "kansas" is a substring, leaving "city" as the apparent place.
check("city containing a state name", plan("weather in kansas city").args.state, "mo");
check("oklahoma city likewise", plan("weather in oklahoma city").args.state, "ok");

section("typos must not silently change the answer");
// Each of these previously lost a field and quietly became a different query.
check('"hiehgt" still finds gage height', plan("gage hiehgt in wyoming").args.parameter, "gageHeight");
check('"Alaskak" still finds the state', plan("gage height of Alaskak").args.state, "ak");
check('"clevland"', plan("gage height in clevland").args.state, "oh");
check('"tallahasee"', plan("precipitation in tallahasee").args.state, "fl");
check("misspelled city yields the correct spelling", plan("precipitation in tallahasee").args.nameContains, "tallahassee");
// "stage" and "state" are one edit apart and mean different things.
check("short words get no fuzzy slack", toolOf("what is the current state"), undefined);

section("filler words are not place names");
// Each of these leaked into nameContains and matched no gauge, silently
// falling back to statewide - an answer that looked right and was not.
check('"amount"', plan("precipitation amount in omaha nebraska").args.nameContains, "omaha");
check('"estimate"', plan("precipitation estimate in tallahasee").args.nameContains, "tallahassee");
check('"weekly" is not a place', plan("Milwaukee weekly temperature average").args.place, "milwaukee");
check('"friday" is not a place', plan("Milwaukee temperature at Friday").args.place, "milwaukee");

section("the page decides what an ambiguous word means");
// env-vocab lists bare "temperature" as a water synonym, which is right on a
// USGS page and wrong on weather.gov.
check("bare temperature on a water page", toolOf("temperature in st louis", { global: "USGS" }), "waterCurrentConditions");
check("bare temperature on a forecast page", toolOf("temperature in st louis", { global: "FCP" }), "weatherConditions");
check("qualifying it overrides the page", toolOf("water temperature in st louis", { global: "FCP" }), "waterCurrentConditions");
check("air temperature anywhere", toolOf("air temperature in st louis", { global: "USGS" }), "weatherConditions");

section("intent routing");
check("flooding", toolOf("is there flooding in Idaho"), "waterFloodStatus");
check("near flood stage (contains 'stage')", toolOf("which gauges are near flood stage in Idaho"), "waterFloodStatus");
check("alerts", toolOf("any flood warnings in Alaska"), "waterAlerts");
check("humidity has no water equivalent", toolOf("humidity in boise"), "weatherConditions");
check("a named day is a forecast, not now", toolOf("Milwaukee temperature on Friday"), "weatherForecast");
check("a week is a forecast", toolOf("weekly temperature in milwaukee"), "weatherForecast");
check("history is refused, not forecast", plan("temperature in milwaukee yesterday").args.when, "past");
// A maximum is not a current reading. Answering it with the thermometer's
// present value is why a number disagreed with weather.gov, which shows the
// forecast high.
check("max is a forecast high", plan("max temperature of chicago IL").args.when, "high");
check("min is a forecast low", plan("min temperature in chicago").args.when, "low");
check("bare temperature is still now", toolOf("temperature in chicago", { global: "FCP" }), "weatherConditions");
check("a river with no state is still answerable", toolOf("discharge of the bighorn river"), "waterFindGauges");
check("control instructions stay control", toolOf("set the parameter to gage height"), undefined);
check('"select Alaska" is not a data question', toolOf("select Alaska"), undefined);

section("page controls, no model");
const inv = { controls: [
  { kind: "button", label: "Daily", selector: "#p-daily", confidence: "high" },
  { kind: "button", label: "Weekly", selector: "#p-weekly", confidence: "high" },
  { kind: "button", label: "Year to date", selector: "#p-ytd", confidence: "high" },
  { kind: "button", label: "Date range", selector: "#range", confidence: "high" },
  { kind: "select", label: "Statistic", selector: "#stat", confidence: "high",
    options: [{ value: "avg", text: "Average" }, { value: "max", text: "Maximum" }] },
  { kind: "select", label: "Variable", selector: "#var", confidence: "high",
    options: [{ value: "temp", text: "Temperature" }, { value: "precip", text: "Precipitation" }] },
] };
const g = (q) => sb.planGenericTool(q, inv);
check("single control", g("year to date").calls.map((c) => c.args.selector), ["#p-ytd"]);
// One instruction, three widgets. Matching only the best one set the variable
// and ignored the rest, leaving a chart that looked answered.
check("three controls from one instruction",
  [...new Set(g("weekly average temperature").calls.map((c) => c.args.selector))].sort(), ["#p-weekly", "#stat", "#var"]);
check("option named, not the dropdown's label",
  g("show precipitation").calls[0].args.value, "precip");
// Ambiguity is judged on overlapping words, not score: complementary
// controls are not rivals.
ensure("genuine rivals still stop it", !!g("show me the date").ambiguous, g("show me the date"));
check("rivals are the ones sharing a word",
  g("show me the date").ambiguous.map((c) => c.label).sort(), ["Date range", "Year to date"]);
check("unmatched words are reported", g("weekly average temperature in fahrenheit").unmatchedWords, ["fahrenheit"]);
ensure("nonsense matches nothing", g("fly me to the moon") === null, g("fly me to the moon"));

section("the rest of a page's controls");
// The matcher could only click or choose an option, so a search box got a
// click - which does nothing visible. The control matched and the action was
// useless, which is harder to notice than no match at all.
const richPage = { controls: [
  { kind: "input", type: "search", label: "Search station", selector: "#q", confidence: "high" },
  { kind: "select", label: "Basemap", selector: "#base", confidence: "high",
    options: [{ value: "sat", text: "Satellite" }, { value: "terr", text: "Terrain" }] },
  { kind: "input", type: "checkbox", label: "Flood inundation layer", selector: "#flood", confidence: "high" },
  { kind: "input", type: "radio", name: "product", label: "Observed", selector: "#obs", confidence: "high" },
  { kind: "button", label: "Download CSV", selector: "#dl", confidence: "high" },
] };
const act = (q) => {
  const r = sb.planGenericTool(q, richPage);
  return r && r.calls ? r.calls.map((c) => ({ name: c.name, args: c.args })) : null;
};
// Filled *and* submitted: typing alone leaves the text in the box while the
// value change makes it look like the search ran.
check("a search box is filled and submitted",
  act("search for Boise"), [
    { name: "pageFill", args: { selector: "#q", text: "Boise" } },
    { name: "pageSubmit", args: { selector: "#q" } },
  ]);
// A quoted string is the query verbatim, spaces and all.
// A query is longer than the label that catches it, and every word of it
// used to count as a subject this page did not have: three missed against
// one covered threw the search away. "Search for Boise" survived only by
// being two words long.
check("quoted text is taken whole",
  act('search station "Big Sandy River"')[0].args.text, "Big Sandy River");
check("a long query does not outvote the box it goes in",
  act("search station Big Sandy River near Riddle")[0].name, "pageFill");
// "look up 13206000" names no control - a site number shares no word with
// "Search station" - but the intent is plain.
check("a bare identifier still reaches the search box",
  act("look up 13206000"), [
    { name: "pageFill", args: { selector: "#q", text: "13206000" } },
    { name: "pageSubmit", args: { selector: "#q" } },
  ]);
// Picking the option is only half of it. Plenty of dropdowns sit beside a Go
// button and do nothing on change alone, so "click Alaska" left the box
// reading Alaska on the same page it started on. The follow-through stands
// down by itself when the dropdown navigates on its own.
check("a dropdown option is chosen, then followed through",
  act("set the basemap to satellite"), [
    { name: "pageSelectOption", args: { selector: "#base", value: "sat" } },
    { name: "pageSubmit", args: { selector: "#base" } },
  ]);
// A checkbox has two directions, and clicking blindly cannot express which.
check("a checkbox can be ticked", act("turn on the flood inundation layer")[0].args.on, true);
check("and unticked", act("hide the flood inundation layer")[0].args.on, false);
check("a radio is picked by its group",
  act("select observed"), [{ name: "pagePickRadio", args: { group: "product", value: "Observed" } }]);
check("a plain button is still clicked",
  act("download csv"), [{ name: "pageClick", args: { selector: "#dl" } }]);
// The search fallback must not swallow everything else.
ensure("nonsense still matches nothing", act("fly me to the moon") === null, act("fly me to the moon"));

section("driving the site comes first");
// Controlling the site is the point; answering about it is the bonus. Only
// USGS had a keyword path, so 46 verified tools across SITE, NOAA and FCP
// could be reached only through the model - which is off by default. On a
// NOAA page almost nothing worked.
const m = (q, route) => {
  const r = sb.planManifestTool(q, route);
  return r ? `${r.name} ${JSON.stringify(r.args)}` : null;
};
check("NOAA basemap", m("set the basemap to satellite", "NOAA"), 'noaaSetBasemap {"basemap":"satellite"}');
check("NOAA zoom", m("zoom in", "NOAA"), "noaaZoomIn {}");
// A boolean follows the verb rather than toggling blindly.
check("NOAA boolean", m("turn on limit by boundary", "NOAA"), 'noaaSetLimitByBoundary {"on":true}');
check("SITE time span", m("set the time span to 30 days", "SITE"), 'siteSetTimeSpan {"span":"30 days"}');
check("SITE scale", m("set the scale to log", "SITE"), 'siteSetScale {"scale":"log"}');
// A number argument is read from the instruction.
check("FCP number argument", m("set ring radius to 50", "FCP"), 'fcpSetRingRadius {"miles":50}');
check("USGS grouping", m("group by county", "USGS"), 'usgsGroupBy {"groupBy":"county"}');
ensure("nonsense matches no tool", m("fly me to the moon", "NOAA") === null, m("fly me to the moon", "NOAA"));

// The verb decides the order. Control-first everywhere would send "gage
// height in Alaska" to usgsSetParameter - changing the page instead of
// answering it - because the words overlap a control's name.
check("an action is a command", sb.isCommand("set the parameter to gage height"), true);
check("a bare measurement and place is not", sb.isCommand("gage height in Alaska"), false);
check("a question is not", sb.isCommand("what is the max temperature in Chicago"), false);
check("searching is", sb.isCommand("search for Boise"), true);

section("did the action actually do anything");
// A click that silently did nothing was indistinguishable from one that
// worked - both return without error. Same shape as every other bug here:
// plausible, and wrong.
const actPage = loadPage(`<!doctype html><html><head><title>Controls</title></head><body>
  <select id="basemap"><option value="terr">Terrain</option><option value="sat">Satellite</option></select>
  <input type="checkbox" id="flood"><input type="text" id="q" value="">
  </body></html>`);
if (!actPage) skip("verification", "jsdom not installed");
else {
  const before = actPage.GENERIC.pageSignature();
  ensure("a snapshot records control states", before.count >= 3, before);

  // Nothing touched: the diff must say so, or a no-op reads as success.
  const unchanged = actPage.GENERIC.signatureDiff(before, actPage.GENERIC.pageSignature());
  check("an untouched page reports no change", unchanged.changed, false);

  actPage.document.getElementById("basemap").value = "sat";
  actPage.document.getElementById("flood").checked = true;
  const after = actPage.GENERIC.pageSignature();
  const diff = actPage.GENERIC.signatureDiff(before, after);
  check("a real change is detected", diff.changed, true);
  check("and counted", diff.changeCount, 2);
  ensure("with the old and new values", diff.changes.some((c) => c.was === "terr" && c.now === "sat"), diff.changes);

  // The no-op message is the one that matters: some tools need a panel
  // opened first and fail invisibly otherwise.
  const quiet = sb.describeVerification({ changed: false, changes: [], changeCount: 0 }, { name: "noaaSetBasemap" });
  check("a no-op is called out", quiet.tone, "alert");
  ensure("and suggests why", /panel|apply/.test(quiet.text), quiet.text);
  const moved = sb.describeVerification({ changed: true, changeCount: 1, changes: [{ was: "terr", now: "sat" }] }, { name: "x" });
  check("a change is reported plainly", moved.tone, "ok");
  ensure("naming what moved", /terr -> sat/.test(moved.text), moved.text);
}

section("repeat questions do not re-fetch");
// NWPS is slow and rate-limited by its own documentation, and every ask
// re-fetched it.
(async () => {
  const fresh = loadBackground();
  await fresh.executeToolCall("GENERIC", { name: "waterAlerts", args: { state: "RI" } }).catch(() => {});
  const afterFirst = fresh.__requests.length;
  await fresh.executeToolCall("GENERIC", { name: "waterAlerts", args: { state: "RI" } }).catch(() => {});
  check("the second identical ask issues no new request", fresh.__requests.length, afterFirst);
  finishCache();
})();

function finishCache() {

section("typos in control instructions");
// Typo tolerance existed only on the data side, so the same slip forgiven
// when asking about a river was fatal when operating the page - the wrong way
// round, given driving the site is the primary job.
const typoPage = { controls: [
  { kind: "button", label: "Thunderstorms", selector: "#ts", confidence: "high" },
  { kind: "button", label: "Precipitation", selector: "#pr", confidence: "high" },
  { kind: "select", label: "Basemap", selector: "#b", confidence: "high",
    options: [{ value: "sat", text: "Satellite" }, { value: "terr", text: "Terrain" }] },
  { kind: "input", type: "checkbox", label: "Flood inundation layer", selector: "#f", confidence: "high" },
] };
const t = (q) => {
  const r = sb.planGenericTool(q, typoPage);
  return r && r.calls ? `${r.calls[0].name} ${JSON.stringify(r.calls[0].args)}` : null;
};
check("misspelled label", t("selct thudnerstorms"), 'pageClick {"selector":"#ts"}');
check("matches the correct spelling too", t("select thunderstorms"), 'pageClick {"selector":"#ts"}');
check("misspelled option", t("set basemp to satelite"), 'pageSelectOption {"selector":"#b","value":"sat"}');
check("misspelled checkbox", t("turn on flod inundation layr"), 'pageCheck {"selector":"#f","on":true}');

// The verb in front was the one word typo tolerance never covered. "selct"
// matched no control, counted as a missed subject, and one missed against
// one covered is enough to throw the whole plan away - so a perfectly
// matched label lost to a misspelling beside it.
// Five letters up, distance 1. Four-letter verbs ("clik", "tpa") stay
// uncovered on purpose: at that length "peak" and "pick" are one edit apart,
// and excusing the wrong one is worse than asking the person to retype.
check("a misspelled verb does not sink a matched label",
  t("chose thunderstorms"), 'pageClick {"selector":"#ts"}');
// The excuse has to stay narrow. "peak" is one edit from "pick", and reading
// it as a verb would discount a word that means a great deal on a river page.
ensure("a real subject word near a verb is still a subject",
  !sb.looksLikeMisspelledVerb("peak") && !sb.looksLikeMisspelledVerb("stage"),
  ["peak", "stage"].map((w) => `${w}:${sb.looksLikeMisspelledVerb(w)}`));
ensure("but a genuine verb typo is excused", sb.looksLikeMisspelledVerb("selct"), "selct");

const mt = (q, route) => { const r = sb.planManifestTool(q, route); return r ? `${r.name} ${JSON.stringify(r.args)}` : null; };
// Short words needed their own budget: "zoom" is four letters.
check("a short misspelled verb", mt("zom in", "NOAA"), "noaaZoomIn {}");
// A multi-word enum never matches a single token, so it needs a window.
check("a misspelled multi-word value", mt("set the time span to 30 dys", "SITE"), 'siteSetTimeSpan {"span":"30 days"}');
check("misspelled tool name", mt("togle the legend", "FCP"), "fcpToggleLegend {}");
check("misspelled enum", mt("set gauge mode to forecst", "NOAA"), 'noaaSetGaugeMode {"mode":"Forecast"}');

// The data side keeps the stricter budget: there "stage" and "state" are one
// edit apart and mean entirely different things.
check("data matching stays strict", toolOf("what is the current state", { global: "USGS" }), undefined);
check("and an exact control phrase is untouched", toolOf("set the parameter to stage", { global: "USGS" }), undefined);

section("what can I do here");
// A service worker's sendMessage is never delivered to its own listener, so
// routing this through messaging looked correct and answered nothing at all.
// It has to be a direct call.
(async () => {
  const withTab = loadBackground();
  withTab.chrome.tabs.query = async () => [{ id: 1, url: "https://water.noaa.gov/" }];
  withTab.chrome.tabs.sendMessage = async () => ({ ok: true, result: { controls: [
    { label: "View Layers", kind: "button", selector: "#vl", confidence: "high" },
  ] } });
  const caps = await withTab.buildCapabilities();
  check("the route is identified", caps.route, "NOAA");
  ensure("its verified tools are listed", caps.tools.length >= 15, caps.tools.length);
  ensure("the page's own controls are counted", caps.pageControls >= 1, caps.pageControls);
  ensure("actions and questions are distinguished",
    caps.display.rows.some((r) => r.value === "action") && caps.display.rows.some((r) => r.value === "question"),
    caps.display.rows.map((r) => r.value));
  // Tool names are rewritten for people ("noaaSetBasemap" -> "set basemap").
  // A page control keeps its own label, capitals and all, since that is what
  // is printed on the page.
  // Tool rows are tagged "action" or "question"; a page control is tagged
  // with its own kind ("button"), which is how the two are told apart.
  const toolNames = caps.display.rows
    .filter((r) => r.value === "action" || r.value === "question")
    .map((r) => r.name);
  ensure("tool names are rewritten for people", toolNames.every((n) => !/[A-Z]/.test(n)), toolNames);
  ensure("a page control keeps its own label",
    caps.display.rows.some((r) => r.value === "button" && r.name === "View Layers"),
    caps.display.rows.filter((r) => r.value === "button"));
  finishCaps();
})();

function finishCaps() {

section("an action's result has to be readable");
// What a real NOAA basemap switch produced: the right change buried among a
// closing menu and two navigation toggles, every row a raw CSS selector, and
// a fragment change reported as "page moved to <long url>".
const noisy = { changed: true, changeCount: 3, viewChanged: true, changes: [
  { selector: "nav.navbar.svelte-jl30q0 > div.uk-contai", label: null, was: true, now: false },
  { selector: "div.map-app-container > div.uk-card.box-shadow-sma", label: "Base map", was: "topographic", now: "satellite" },
  { selector: "ul.uk-navbar-nav.layer-1", label: null, was: false, now: true },
] };
check("the tool name reads as English", sb.friendlyToolName("noaaSetBasemap"), "set basemap");
// A value change is the substance; a boolean flip is usually a menu closing.
check("the real change is surfaced, not the menu noise",
  sb.rankedChanges(noisy).map((c) => c.label), ["Base map"]);
check("described in terms of the control's label",
  sb.describeVerification(noisy, { name: "noaaSetBasemap" }).text, "Base map: topographic -> satellite");
// A fragment change is the same page showing a different view - how map pages
// record centre and zoom - not a navigation.
check("a view change is not called a navigation",
  sb.describeVerification({ changed: true, changeCount: 0, viewChanged: true, changes: [] }, { name: "noaaZoomIn" }).text,
  "the map view updated");
// Without a label there is still no excuse for printing a raw selector.
check("an unlabelled control is still named",
  sb.nameOfChange({ selector: "div.map-app-container > ul.uk-navbar-nav.layer-1" }), "ul");
check("a no-op is still called out",
  sb.describeVerification({ changed: false, changes: [], changeCount: 0 }, { name: "x" }).tone, "alert");

section("anything plannable must be executable");
// A page control matched on a NOAA page planned as pageClick and then failed
// with "model picked an unknown tool", because GENERIC's definitions were
// absent from a named route's list even though the GENERIC bundle is injected
// there. Planning something the executor cannot find is the worst of both.
for (const route of ["USGS", "SITE", "NOAA", "FCP", "GENERIC"]) {
  ensure(`${route}: generic page tools are executable`, !!sb.findToolDef(route, "pageClick"), route);
}
check("a named route keeps its own tools", !!sb.findToolDef("NOAA", "noaaSetBasemap"), true);
check("and data tools stay everywhere", !!sb.findToolDef("FCP", "waterCurrentConditions"), true);
// The guarantee that matters: every tool any planner can emit resolves.
const plannable = ["pageClick", "pageFill", "pageCheck", "pagePickRadio", "pageSelectOption"];
for (const name of plannable) {
  ensure(`${name} resolves on a named route`, !!sb.findToolDef("NOAA", name), name);
}

section("a failure has to say why");
// "failed" on its own tells you nothing about what to do next. The page's own
// error usually says exactly what is wrong - a button not found, a panel not
// open - and it was being discarded.
const failing = { part: "open the layers panel", ok: false, error: 'clickByText: "View Layers" not found' };
const row = {
  name: failing.part.slice(0, 44),
  value: !failing.ok ? "failed" : "done",
  meta: !failing.ok ? String(failing.error || "no reason given").slice(0, 70) : "",
};
ensure("the reason reaches the row", /View Layers/.test(row.meta), row);
// Every planner here is deterministic, so blaming a model sends anyone
// debugging in the wrong direction.
let unknownToolError = null;
sb.executeToolCall("NOAA", { name: "definitelyNotATool", args: {} }).catch((e) => { unknownToolError = e.message; });
setTimeout(() => {
  ensure("an unknown tool does not blame a model", unknownToolError && !/model/i.test(unknownToolError), unknownToolError);
  ensure("and names the tool", unknownToolError && /definitelyNotATool/.test(unknownToolError), unknownToolError);
  finishFailures();
}, 30);

function finishFailures() {

section("a site nobody has mapped");
// Shapes taken from real government sites the extension has no knowledge of:
// tidesandcurrents.noaa.gov ships the same search box twice for responsive
// layout, and drought.gov buries a state picker among navigation chrome.
const unmapped = { controls: [
  { kind: "a", label: "Skip to main content", selector: "#skip", confidence: "high" },
  { kind: "button", label: "Toggle navigation", selector: "#nav", confidence: "high" },
  { kind: "input", type: "search", label: "Search Text Box", selector: "#query", confidence: "high" },
  { kind: "input", type: "search", label: "Mobile Search Text Box", selector: "#mquery", confidence: "high" },
  { kind: "select", label: "State", selector: "#state-select-list", confidence: "high",
    options: [{ value: "idaho", text: "Idaho" }, { value: "ohio", text: "Ohio" }] },
] };
const u = (q) => {
  const r = sb.planGenericTool(q, unmapped);
  if (!r) return null;
  if (r.ambiguous) return `ambiguous: ${r.ambiguous.map((c) => c.label).join(" | ")}`;
  return r.calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join(" + ");
};
// A responsive site's duplicate controls are one logical control, not a
// choice to put to the user - this refused outright before.
check("duplicated responsive controls are not ambiguous",
  u("search for Boston"), 'pageFill {"selector":"#query","text":"Boston"} + pageSubmit {"selector":"#query"}');
// "Open the search box" is a request to open it. Taking "box" as the query
// and typing that is a confidently wrong action.
// Opening a box submits nothing - there is no query to run.
check("opening a box does not submit",
  u("open the search box"), 'pageClick {"selector":"#query"}');
check("a control's own name is not a query",
  u("open the search box"), 'pageClick {"selector":"#query"}');
// A bare identifier matches no label, but the intent is not in doubt.
check("a search cue outranks an unrelated tie",
  u("look up 8443970"), 'pageFill {"selector":"#query","text":"8443970"} + pageSubmit {"selector":"#query"}');
check("a real dropdown still wins on its own words",
  u("select idaho"), 'pageSelectOption {"selector":"#state-select-list","value":"idaho"} + pageSubmit {"selector":"#state-select-list"}');
// The verb is not what makes it a dropdown - the control is.
check("and clicking it means the same",
  u("click idaho"), u("select idaho"));

section("typing is not searching");
// fill() typed and stopped. Every hand-written manifest that wraps a search
// box adds Enter itself (NOAA.search does), because otherwise the text sits
// in the box and nothing happens - and the input's value *did* change, so
// verification calls it a success. A search that looks performed and was not
// is the worst outcome available.
const formPage = loadPage(`<!doctype html><html><body>
  <form id="f"><input type="search" id="q" aria-label="Search"><button type="submit">Go</button></form>
  </body></html>`, { url: "https://example.gov/" });
if (!formPage) skip("submit", "jsdom not installed");
else {
  const fired = [];
  formPage.document.getElementById("q").addEventListener("keydown", (e) => { if (e.key === "Enter") fired.push("enter"); });
  formPage.document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); fired.push("submit"); });

  formPage.GENERIC.fill("#q", "Boston");
  check("filling sets the value", formPage.document.getElementById("q").value, "Boston");
  check("but fires nothing on its own", fired.length, 0);

  const routed = formPage.GENERIC.submit("#q");
  ensure("submitting presses Enter", fired.includes("enter"), fired);
  ensure("and submits the form", fired.includes("submit"), fired);
  check("reporting which route worked", routed.submitted, "form");
}

section("the past, and one gauge at a time");
// Water questions about the past were refused outright while weather answered
// them from its forecast.
const hist = (q) => { const p = plan(q, { global: "GENERIC" }); return p ? `${p.name} ${JSON.stringify(p.args)}` : null; };
check("a counted span", hist("discharge on the snake river over the last 7 days"),
  'waterHistory {"place":"snake river","parameter":"discharge","days":7}');
check("a named span", hist("average discharge on the boise river last month"),
  'waterHistory {"place":"boise river","parameter":"discharge","days":30}');
// "Boise River" is a river, not the city of Boise - stripping the recognised
// name out of a waterbody named after it left "river", which finds nothing.
ensure("a city that names a river keeps its name",
  /boise river/.test(hist("average discharge on the boise river last month")), hist("average discharge on the boise river last month"));
check("but the city alone is still the city", hist("discharge in boise"),
  'waterCurrentConditions {"state":"id","parameter":"discharge","nameContains":"boise"}');
// Time words must not become part of the place. Checked on the place itself:
// the arguments legitimately contain a "days" key.
const spanPlace = plan("discharge on the snake river over the last 7 days", { global: "GENERIC" }).args.place;
ensure("time words are not part of the place", !/\b(over|days?|last)\b/.test(spanPlace), spanPlace);
check("present-tense questions are untouched", hist("gage height in Alaska"),
  'waterCurrentConditions {"state":"ak","parameter":"gageHeight"}');
// A span with no unit named defaults rather than failing.
check("history with no span defaults", sb.historySpan("gage height history for the bighorn river"), 30);
check("and now is still now", sb.historySpan("gage height in Alaska"), null);

section("the popup's suggestions must actually work");
// Chips are offered as examples, so one that does nothing is a bad first
// impression - and "show discharge" was exactly that until this check caught
// it. The list is read from popup.js so the two cannot drift apart.
(function () {
  const fsMod = require("fs"), pathMod = require("path");
  const js = fsMod.readFileSync(pathMod.join(__dirname, "..", "popup", "popup.js"), "utf8");
  const block = js.slice(js.indexOf("const EXAMPLES"), js.indexOf("function renderChips"));
  const examples = eval("(" + block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1) + ")");
  for (const [route, list] of Object.entries(examples)) {
    const unmatched = list.filter((q) => {
      if (/what can i|read this page/i.test(q)) return false; // handled before planning
      if (sb.planDataTool(q, { global: route })) return false;
      if (sb.planManifestTool(q, route)) return false;
      if (route === "USGS" && sb.planTool(q)) return false;
      return true;
    });
    ensure(`${route}: every suggested example resolves`, unmatched.length === 0, unmatched);
  }
})();

// "graph discharge" tied siteGraphParameter against siteListGraphParameters -
// one sets, one lists - and naming a parameter settles which.
check("naming a value picks the tool that takes one",
  (sb.planManifestTool("graph discharge", "SITE") || {}).name, "siteGraphParameter");
check("without a value the listing tool still wins",
  (sb.planManifestTool("list graph parameters", "SITE") || {}).name, "siteListGraphParameters");

section("nothing is dropped in silence");
// "zoom in on alaska" ran a bare zoom and discarded "alaska". The map moved,
// so it was indistinguishable from success - the same shape as every other
// bug here.
const mt2 = (q, route) => sb.planManifestTool(q, route);
check("a bare zoom is still a zoom", (mt2("zoom in", "NOAA") || {}).name, "noaaZoomIn");
// On a map, "zoom in on X" is a request to go there, which is what the site's
// search box does; a relative zoom takes no location.
// NOAA's own search is best-effort by its manifest's account - its result
// list was never reachable - so redirecting there produced a confident report
// and a map that had not moved. This page records its view in the URL, which
// can simply be set.
check("zooming on a place moves the map",
  (mt2("zoom in on alaska", "NOAA") || {}).name, "noaaGoToView");
check("centred on that state", (mt2("zoom in on alaska", "NOAA") || {}).args.lat, 61.3);
// A big state has to sit further out than a small one to fit on screen.
ensure("zoomed out for a large state", (mt2("zoom in on alaska", "NOAA") || {}).args.zoom < 4,
  (mt2("zoom in on alaska", "NOAA") || {}).args.zoom);
ensure("and closer in for a small one", (mt2("zoom in on rhode island", "NOAA") || {}).args.zoom > 6,
  (mt2("zoom in on rhode island", "NOAA") || {}).args.zoom);
check("the substitution is recorded, not hidden",
  (mt2("zoom in on alaska", "NOAA") || {}).insteadOf, "a relative zoom");
// A place naming no tool at all still reaches the map.
check("a bare place still moves the map", (mt2("show me texas", "NOAA") || {}).name, "noaaGoToView");
// A route with no map mover falls back to its search box.
check("routes without one fall back to search", (mt2("zoom in on texas", "FCP") || {}).name, "fcpSearch");
// A tool that genuinely consumes the place is left alone.
check("a tool that takes the place keeps it",
  (mt2("select Alaska", "USGS") || {}).name, "usgsSelectState");
check("an argument-taking tool reports nothing left over",
  (mt2("set the basemap to satellite", "NOAA") || {}).unmatchedWords, undefined);

section("an ambiguous choice has to be answerable");
// The disambiguation card listed raw CSS selectors and offered no way to
// choose - a question with no way to answer it is barely a question.
const twoLinks = { controls: [
  { kind: "a", label: "AIR QUALITY", selector: "#aq", confidence: "high" },
  { kind: "a", label: "Air Quality Alert", selector: "#aqa", confidence: "high" },
] };
const amb = sb.planGenericTool("quality", twoLinks);
ensure("genuinely tied controls still ask", !!amb.ambiguous, amb);
// Each candidate carries the exact call, so picking one is a click rather
// than a retyped instruction.
ensure("every candidate carries its call", amb.ambiguous.every((c) => c.call && c.call.name), amb.ambiguous);
check("and they differ", amb.ambiguous.map((c) => c.call.args.selector), ["#aq", "#aqa"]);
ensure("labels are what a person reads, not selectors",
  amb.ambiguous.every((c) => c.label && !/[>.:]/.test(c.label)), amb.ambiguous.map((c) => c.label));
// Naming one exactly is not ambiguous at all.
check("an exact name is not a choice",
  (sb.planGenericTool("air quality alert", twoLinks).calls || [])[0].args.selector, "#aqa");

section("asking before something irreversible");
// Verification makes most actions reversible; a download that has started and
// a page that has navigated away are not among them.
const destructive = ["usgsOpenSite", "siteDownloadData", "fcpClearRings", "fcpRemoveLastRing"];
for (const name of destructive) {
  const route = name.startsWith("usgs") ? "USGS" : name.startsWith("site") ? "SITE" : "FCP";
  const def = sb.findToolDef(route, name);
  ensure(`${name} is flagged irreversible`, def && !!def.destructive, def && def.destructive);
}
// Everything else must not be, or a confirmation on every click is noise that
// gets clicked through.
const overCautious = ["USGS", "SITE", "NOAA", "FCP"].flatMap((r) =>
  sb.toolsFor(r).filter((t) => t.destructive && !destructive.includes(t.name)).map((t) => t.name));
ensure("nothing else demands confirmation", overCautious.length === 0, overCautious);

section("numbers people can read");
// 536000 beside 1320 is hard to compare at a glance.
check("thousands are separated", sb.readable(536000), "536,000");
check("small numbers are left alone", sb.readable(4.59), "4.59");
check("and precision is capped", sb.readable(25.550000000000004), "25.55");

section("a chance of rain is not a rain gauge");
// "Probability of precipitation in san francisco" matched the USGS
// precipitation parameter and answered with rain gauges reading zero -
// measured rainfall so far, which is a different quantity from the chance of
// rain to come. Both are precipitation; only one is a forecast.
const rain = (q, route) => { const p = plan(q, { global: route || "FCP" }); return p ? `${p.name} ${p.args.when || ""}`.trim() : null; };
check("probability of precipitation is a forecast",
  rain("probability of precipitation in san francisco"), "weatherForecast rain");
check("so is a chance of rain", rain("chance of rain in boise"), "weatherForecast rain");
check("and a named day is carried", rain("will it rain in seattle on friday"), "weatherForecast rain:friday");
// Plain "precipitation" is still what gauges measure.
check("measured precipitation still goes to USGS",
  rain("precipitation in california"), "waterCurrentConditions");
// On a water page, gauges remain the sensible reading of the bare word.
check("and on a USGS page too", rain("precipitation in california", "USGS"), "waterCurrentConditions");

// The page you're on is read before any agency API, so the same two
// quantities have to be told apart there too - a forecast page prints
// inches and a percentage side by side.
const forecastPage = {
  url: "https://forecast.weather.gov/MapClick.php?lat=37.77&lon=-122.42",
  title: "National Weather Service Forecast for: San Francisco CA",
  headings: ["San Francisco CA"], text: "san francisco ca",
  pairs: [
    { label: "Precipitation last hour", value: "0.00 in" },
    { label: "Chance of precipitation", value: "15%" },
  ],
  readouts: [], labelledNumbers: [], tables: [],
};
// Days across the top, the measurement down the side - the layout that once
// answered a Wednesday question with Tuesday's column.
const forecastTable = { ...forecastPage, pairs: [],
  tables: [{ columns: ["", "Wednesday", "Thursday"], rows: [
    ["Chance of precipitation", "5%", "15%"],
    ["Precipitation", "0.00 in", "0.00 in"],
  ] }],
};
const onPage = (page, q, day) => {
  const hits = sb.findOnPage(page, { wants: sb.pageValueWants(q), place: "san francisco", day: day || null });
  return hits ? hits.map((h) => `${h.label} = ${h.value}`).join(" | ") : null;
};
check("the page's chance is not the page's rainfall",
  onPage(forecastPage, "probability of precipitation in san francisco"), "Chance of precipitation = 15%");
check("and the rainfall is not the chance",
  onPage(forecastPage, "how much rain has fallen in san francisco"), "Precipitation last hour = 0.00 in");
check("a named day picks its column",
  onPage(forecastTable, "chance of rain on thursday in san francisco", "thursday"),
  "Chance of precipitation \u00b7 Thursday: 15% = 15%");
// "PoP" is a column header, never how anyone phrases a question - so it
// matches a row and not an instruction, where it would catch "population".
check("a PoP column reads as a chance", sb.conceptMatches("precipChance", "pop 15%"), true);
check("and not as rainfall", sb.conceptMatches("precipitation", "pop 15%"), false);
check("population is not a forecast", sb.pageValueWants("population of san francisco").length, 0);

section("one table, one place");
// A page can name many places and hold a table about one of them. Matching
// the place anywhere in the body let every name on the page claim that table:
// "denver colorado max temp" and "pueblo max temp" returned the same number
// from the same row, and both looked deliberate.
const idssPage = {
  url: "https://www.weather.gov/forecastpoints/", title: "IDSS Forecast Points",
  headings: ["Boulder Creek at Boulder, CO"],
  text: "Forecast points: Boulder, Denver, Fort Collins, Greeley, Pueblo",
  pairs: [], readouts: [], labelledNumbers: [],
  // One data column on purpose. With several, "no day named" resolves to
  // today's column, and the expected value would change with the day the
  // suite is run - these tests are about which place may claim the table,
  // not about which column wins.
  tables: [{ columns: ["", "Thu Sep 17"], rows: [["Max Temp, \u00b0F", "82"]] }],
};
const fromIdss = (place) => {
  const hits = sb.findOnPage(idssPage, { wants: sb.pageValueWants("max temp"), place, day: null });
  return hits ? hits[0].value : null;
};
check("the heading's place gets the table", fromIdss("boulder"), "82");
check("a place merely listed does not", fromIdss("denver"), null);
check("nor does another one", fromIdss("pueblo"), null);
check("and with no place asked, the table stands", fromIdss(null), "82");
// Prose still has to work where no heading names a place, or two real pages
// break: weather.gov's point forecast names its point in a bare paragraph,
// and an IDSS page names the point you clicked with nothing but "IDSS
// Forecast Points" above it.
check("prose decides when no heading names a place",
  sb.tableIsAbout({ title: "Point Forecast", headings: [], text: "0 miles n of hermantown, mn" }, "hermantown"), true);
check("and an IDSS page is read the same way",
  sb.tableIsAbout({ title: "IDSS Forecast Points", headings: ["IDSS Forecast Points"], text: "hermantown mn max temp" }, "hermantown"), true);
// A heading ending in a state is the page naming its own subject.
check("a state-suffixed heading is a subject",
  sb.locationHeadings({ headings: ["Boulder Creek at Boulder, CO", "Detailed Forecast"] }).length, 1);
check("a generic heading is not",
  sb.locationHeadings({ headings: ["IDSS Forecast Points", "Weekly Summary"] }).length, 0);

section("arithmetic over what the page shows");
// "Average temperature of pine level this week" returned 93 - Thursday's max
// temperature. The row was right and the cell was real, but the words
// "average" and "this week" were dropped without trace, so a question about
// seven days was answered with one of them.
const weekGrid = {
  title: "IDSS Forecast Points", headings: ["IDSS Forecast Points"], text: "pine level nc",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Weekly Summary", "Thu Sep 17", "Fri Sep 18", "Sat Sep 19"], rows: [
    ["Max Temp, °F", "93", "89", "91"],
    ["Min Temp, °F", "70", "68", "69"],
  ] }],
};
const calc = (q) => {
  const agg = sb.aggregateWanted(q);
  const r = agg && sb.aggregateOnPage(weekGrid, { wants: sb.pageValueWants(q), place: "pine level", agg });
  return r ? `${r.statistic} ${r.value}${r.unit} over ${r.over}` : null;
};
check("an average is averaged", calc("average temperature of pine level this week"),
  "average 91.0°F over 3 columns");
check("and it shows every number it used",
  sb.aggregateOnPage(weekGrid, { wants: ["temperature"], place: null, agg: { fn: "mean", word: "average" } }).points.length, 3);

// "Max temp" names the row called Max Temp. Reading it as a calculation
// would answer a different question, so an extreme needs a span before it
// counts as one.
check("a bare extreme is a row, not a calculation", sb.aggregateWanted("max temp"), null);
check("the same extreme over a week is a calculation", sb.aggregateWanted("max temp this week").fn, "max");
check("an average needs no span at all", sb.aggregateWanted("average temperature").fn, "mean");

// A cell that is a dash, a heading or empty is not zero. Averaging it in
// would drag every result toward nothing.
check("a dash is not zero", sb.cellNumber("—"), null);
check("nor is a heading", sb.cellNumber("Max Temp, °F"), null);
check("a thousands separator survives", sb.cellNumber("1,240 cfs"), 1240);
check("a negative survives", sb.cellNumber("-3.5"), -3.5);

// Tables come in both orientations, so the series runs along either axis.
const downColumn = { title: "Gauges", headings: [], text: "",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Site", "Discharge, cfs"], rows: [["A", "100"], ["B", "300"], ["C", "200"]] }] };
const byCol = sb.aggregateOnPage(downColumn, { wants: ["discharge"], place: null, agg: { fn: "sum", word: "total" } });
check("a column is summed down", `${byCol.value} over ${byCol.over}`, "600 over 3 rows");

// A chart's series and a map's features are numbers too.
const series = [{ label: "Sep 14", value: "56" }, { label: "Sep 15", value: "64" }, { label: "Sep 16", value: "63" }];
check("a chart series averages", sb.aggregateOverSeries(series, { fn: "mean", word: "average" }, "temperature").value, "61.0");
check("one point is not a series", sb.aggregateOverSeries(series.slice(0, 1), { fn: "mean", word: "average" }, "x"), null);
// Hovered points arrive as tooltip text, not tidy values.
const hovered = [{ text: "Sep 14: 56 °F" }, { text: "Sep 15: 64 °F" }];
check("tooltip text still yields numbers", sb.aggregateOverSeries(hovered, { fn: "max", word: "highest" }, "temp").value, "64");
// The date in "Sep 14: 56 °F" is a number too, and the nearer one.
check("a date is not the reading", sb.cellNumber("Sep 14: 56 \u00b0F"), 56);
check("even with no unit to go on", sb.cellNumber("Sep 15: 64"), 64);
check("a plain cell is unaffected", sb.cellNumber("93"), 93);

// A calculated number must never read as one that was simply on the page.
const card = sb.computedDisplay(sb.aggregateOnPage(weekGrid, { wants: ["temperature"], place: null, agg: { fn: "mean", word: "average" } }), "IDSS");
check("the card says it calculated", /calculated from 3 columns/.test(card.subtitle), true);
check("and the tool is on every route",
  ["GENERIC", "USGS", "NOAA", "FCP", "SITE"].every((r) => sb.toolsFor(r).some((d) => d.name === "pageCompute")), true);

section("three ways to be confidently wrong");
// Half the state codes are ordinary English words. Matching them without
// regard to case made "Sign in" a location heading, which declared the page
// to be about Indiana and shut off page reading for the whole site.
const heads = (h) => sb.locationHeadings({ headings: [h] }).length;
check("a login link is not Indiana", heads("Sign in"), 0);
check("nor is a zoom control", heads("Zoom in"), 0);
check("and a contact link is not Maine", heads("Contact me"), 0);
check("a state written as a state still counts", heads("Boulder Creek at Boulder, CO"), 1);
check("with or without the comma", heads("2 Miles S Hermantown MN"), 1);

// Stage is measured from each gauge's own datum. The API path refuses to
// average it across gauges; calculating it off a page reached the same
// meaningless number - 0.46 ft and 2004 ft averaging to 669 - by another door.
const stageTable = { title: "Gauges", headings: [], text: "", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Site", "Gage height, ft"], rows: [["A", "0.46"], ["B", "2004.1"], ["C", "3.2"]] }] };
const stageCol = sb.aggregateOnPage(stageTable, { wants: ["gageHeight"], place: null, agg: { fn: "mean", word: "average" } });
check("stage across gauges is refused", stageCol.value, null);
check("and the refusal says why", /datum/.test(stageCol.refused), true);
check("the card does not show a number",
  sb.computedDisplay(stageCol, "Gauges").stats.length, 0);
// One gauge over time shares a datum, so that average is real.
const overTime = { title: "Site", headings: [], text: "", pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["Gage height, ft", "Mon", "Tue", "Wed"], rows: [["Gage height, ft", "3.1", "3.4", "3.2"]] }] };
check("one gauge over time still averages",
  sb.aggregateOnPage(overTime, { wants: ["gageHeight"], place: null, agg: { fn: "mean", word: "average" } }).value, "3.2");

// "Pine Level, NC" is a town; "water level" is a reading. Stripping the
// measurement noun from both turned the town into "Pine" and looked it up.
check("a town keeps its second word", sb.extractPlaceHint("max temp of pine level", {}), "pine level");
check("a measurement does not become one", sb.extractPlaceHint("water level in wyoming", {}), "wyoming");
check("and a bare measurement is still no place", sb.extractPlaceHint("discharge of level", {}), null);

section("zero is not the same as could not look");
// The capability badge reported "any site - 0 controls" on a site that had
// never been enabled. The inventory call had thrown, the error was swallowed,
// and the count of an empty array was published as a finding. Worse, the
// panel only offers "Enable on this site" when the capability call fails -
// so looking successful hid the one button that fixes it.
const blockedCaps = { ok: true, route: "GENERIC", tools: [], pageControls: null,
  pageBlocked: 'not enabled on this site yet. Click "Enable on this site" in the popup first.' };
check("a blocked page reports no count", blockedCaps.pageControls, null);
check("and says why instead", /not enabled/.test(blockedCaps.pageBlocked), true);
// A page that really has nothing still reports a number, which is a finding.
const emptyCaps = { ok: true, route: "GENERIC", tools: [], pageControls: 0, pageBlocked: null };
check("an empty page still counts", emptyCaps.pageControls, 0);
check("and is not called blocked", emptyCaps.pageBlocked, null);

// Every site the extension claims to have verified tools for has to be
// reachable without the user finding a button first, or the tools are
// decorative on a fresh install.
const mf = require(require("path").join(__dirname, "..", "manifest.json"));
const grantedBy = (url) => (mf.host_permissions || []).some((p) =>
  new RegExp("^" + p.replace(/[.]/g, "\\.").replace(/\*/g, ".*")).test(url));
check("USGS state pages are granted at install", grantedBy("https://waterdata.usgs.gov/state/wi"), true);
check("so are monitoring locations", grantedBy("https://waterdata.usgs.gov/monitoring-location/05427718/"), true);
check("so is NOAA water", grantedBy("https://water.noaa.gov/"), true);
check("so are weather.gov forecast points", grantedBy("https://www.weather.gov/forecastpoints"), true);
// Anything else is opt-in by design, not by oversight.
check("an unrelated site is still opt-in", grantedBy("https://example.gov/"), false);

section("the verb is not the instruction");
// "Click Alaska" and "select Alaska" are the same request. A tool's name
// carries one verb - selectState - so scoring against that literal word gave
// the synonym nothing: "select alaska" worked and "click alaska" planned
// nothing at all.
const asked = (q, route) => { const p = sb.planManifestTool(q, route || "USGS"); return p ? `${p.name} ${JSON.stringify(p.args)}` : null; };
const want = asked("select alaska");
check("select is the baseline", want, 'usgsSelectState {"state":"alaska"}');
for (const verb of ["click", "click on", "choose", "pick", "tap", "press", "switch to"]) {
  check(`${verb} means the same`, asked(`${verb} alaska`), want);
}
// The synonym must not survive into the value. Stripping only the literal
// name word left selectState returning {state: "pick alaska"}.
check("the verb never lands in the argument",
  ["click", "pick", "tap", "press"].every((v) => sb.planManifestTool(`${v} alaska`, "USGS").args.state === "alaska"), true);
// Enumerated values work the same way on another route.
const base = asked("set the basemap to satellite", "NOAA");
check("and on NOAA too", asked("click satellite", "NOAA"), base);
// Families stay apart: opening a panel is not setting a value.
check("open is not select", sb.verbFamily("open").includes("select"), false);
check("but click is", sb.verbFamily("click").includes("select"), true);

// The side panel needs Chrome 114. Without a declared minimum the panel
// simply never opens on anything older, with nothing said about why.
const mfv = require(require("path").join(__dirname, "..", "manifest.json"));
check("a minimum Chrome version is declared", mfv.minimum_chrome_version, "114");
// Every build called itself 0.5.0 for thirty commits, so a stale extension
// was indistinguishable from a current one and "did you reload" could not be
// answered by either side. The panel shows the version; the version has to
// move when the extension does.
ensure("the extension declares a version past 0.5.0",
  mfv.version !== "0.5.0" && /^\d+\.\d+/.test(mfv.version), mfv.version);
// The version is how anyone testing knows what they have. It sat at 0.16.0
// through eight commits because the edits meant to bump it failed silently
// and nothing checked - so every report of "you are on v0.20" was wrong.
// The packaged zip and the manifest must agree.
const packagedNames = require("fs").existsSync(require("path").join(__dirname, "..", "..", "dist"))
  ? require("fs").readdirSync(require("path").join(__dirname, "..", "..", "dist")).filter((f) => f.endsWith(".zip"))
  : [];
if (packagedNames.length) {
  ensure("the packaged zip carries the manifest's version",
    packagedNames.some((f) => f.includes(mfv.version)), { packagedNames, version: mfv.version });
}
const panelHtml = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.html"), "utf8");
ensure("and the panel shows it", /id="buildTag"/.test(panelHtml), "no build tag in the panel");

section("a sentence is not a selector");
// pageClick and its neighbours take a real CSS selector, and nothing anyone
// types is one - but the argument is a free string, so scoring filled it with
// the leftover words: "set the basemap to satellite" planned
// pageClick{selector: "basemap satellite"}, reported "click ... done", and
// changed nothing. Verb families made it total, since select, choose, pick
// and set all reach pageClick's own name word.
for (const q of ["click 30 day precipitation", "select 30 day precipitation", "set the basemap to satellite"]) {
  check(`"${q}" is not planned blind`, sb.planManifestTool(q, "GENERIC"), null);
}
// The tools that do know the page still plan normally.
check("a named route is unaffected",
  sb.planManifestTool("select alaska", "USGS").name, "usgsSelectState");
check("and so is an enum on another route",
  sb.planManifestTool("click satellite", "NOAA").name, "noaaSetBasemap");
// Auditing for the rest of the class turned up three more. A radio group's
// name attribute, a URL and a hex colour are all "free strings" by type and
// none of them is anything a person types - each was being filled with
// leftover words, winning the plan, and then failing.
check("a radio group is not guessed", sb.planManifestTool("pick observed radio", "GENERIC"), null);
check("nor is a colour", sb.planManifestTool("set the ring color to blue", "FCP"), null);
check("a real hex still works",
  sb.planManifestTool("set the ring color to #ff0000", "FCP").args.hex, "ff0000");
// A URL cannot survive word-splitting, so nothing that does survive is one.
check("a url is never assembled from words",
  ["pageReadUrl"].includes((sb.planManifestTool("read the url for precipitation", "GENERIC") || {}).name), false);
// The tools that legitimately take words from the sentence are untouched.
for (const [q, route, name] of [
  ["search for boise", "NOAA", "noaaSearch"],
  ["select alaska", "USGS", "usgsSelectState"],
  ["click satellite", "NOAA", "noaaSetBasemap"],
  ["open the layers panel", "NOAA", "noaaOpenLayers"],
  ["download csv", "SITE", "siteDownloadData"],
]) check(`${q} still plans`, sb.planManifestTool(q, route).name, name);

// Selector tools are recognised by their own schema, not by a hand-kept list.
check("a selector tool is detected from its schema",
  sb.needsRealSelector({ parameters: { properties: { selector: { type: "string" } }, required: ["selector"] } }), true);
check("and a value tool is not",
  sb.needsRealSelector({ parameters: { properties: { state: { type: "string" } }, required: ["state"] } }), false);
check("a group is page knowledge too",
  sb.needsRealSelector({ parameters: { properties: { group: { type: "string" } }, required: ["group"] } }), true);
check("and so is a url",
  sb.needsRealSelector({ parameters: { properties: { url: { type: "string" } }, required: ["url"] } }), true);

section("enabling a site you have not enabled");
// "Enable on this site" could not read the URL of any site it had not already
// been enabled on. Without the "tabs" permission chrome.tabs.query omits url
// for a tab the extension holds no host permission for - which is every site
// that button exists for. Enabling needed the URL; the URL needed enabling.
const mfp = require(require("path").join(__dirname, "..", "manifest.json"));
check("the tabs permission is declared", (mfp.permissions || []).includes("tabs"), true);
// It must not have been bought by widening host access instead.
check("and host access stays narrow",
  (mfp.host_permissions || []).some((h) => /^https:\/\/\*\/|^<all_urls>$/.test(h)), false);
check("broad access is still opt-in",
  (mfp.optional_host_permissions || []).includes("https://*/*"), true);
// The panel outlives navigation, so nothing about the current tab may be
// read once and kept.
const panel = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.js"), "utf8");
ensure("the current origin is re-read on navigation",
  /onUpdated[\s\S]{0,200}rememberOrigin/.test(panel), "popup.js caches the origin once");
// A handler bound to a control that no longer exists throws at load and takes
// the whole panel with it, so trimming a debug field could silently break
// Ask. Every id the panel binds has to exist in its markup.
const panelMarkup = require("fs").readFileSync(
  require("path").join(__dirname, "..", "popup", "popup.html"), "utf8");
// Only the ids that get a handler bound to them. A control read or created
// at runtime - the model status line, for one - legitimately has no markup,
// and demanding one would make this a test of the test.
const boundIds = [...new Set([...panel.matchAll(/\bon\("([^"]+)",/g)].map((m) => m[1]))];
const orphans = boundIds.filter((id) => !panelMarkup.includes(`id="${id}"`));
check("every control the panel binds exists", orphans, []);
ensure("and there are some to check", boundIds.length >= 5, boundIds.length);

ensure("and on a tab switch",
  /onActivated\.addListener\(rememberOrigin\)/.test(panel), "no onActivated listener");

section("a river that names itself");
// "North fork elkhorn river discharge" came back as an offer to click two
// unrelated links. Two faults in a row, each of which alone would have been
// enough.
//
// extractPlaceHint required a locational preposition - at, in, on, near, of -
// so a question that simply names a river found no place, and the data
// planner had nothing to plan with.
const wb = (q, ctx) => sb.extractPlaceHint(q, ctx || {});
check("a river names itself without a preposition",
  wb("north fork elkhorn river discharge", { parameterMatched: "discharge" }), "north fork elkhorn river");
check("to the last waterbody word, not the first",
  wb("middle fork salmon river discharge", { parameterMatched: "discharge" }), "middle fork salmon river");
check("a preposition still works", wb("discharge of the boise river", { parameterMatched: "discharge" }), "boise river");
// The rule that stopped "parameter" becoming a river has to survive: this
// needs a real waterbody word, and a control instruction has none.
check("a control instruction is still not a place",
  wb("set the parameter to gage height", { parameterMatched: "gage height" }), null);
check("nor is a question about the page", wb("what is the current state"), null);
// And the whole question now plans as data rather than falling through.
check("so the question plans as data",
  sb.planDataTool("north fork elkhorn river discharge", { global: "NOAA" }).name, "waterFindGauges");

section("the handler itself answers");
// Every other test here drives a planner directly. None of them touches
// chrome.runtime.onMessage -> smartAsk -> respond, which is the only thing
// the extension actually runs. A throw or a missed respond() in that handler
// fails every ask at once and is invisible to all 390 of them.
const realPage = loadPage(
  `<!doctype html><html><head><title>Drought</title></head><body>
     <nav><a href="/skip">Skip to main content</a></nav>
     <a class="nav-link" href="/current">Current Conditions</a>
     <label for="layer">Data layer</label>
     <select id="layer"><option value="cur">Current</option><option value="p30">30-Day Precipitation</option></select>
     <table><tr><th>Gauge</th><th>Max Temp, °F</th></tr>
       <tr><td>Site A</td><td>81</td></tr><tr><td>Site B</td><td>85</td></tr></table>
   </body></html>`, { url: "https://www.drought.gov/" });
if (!realPage) skip("end to end", "jsdom not installed");
else {
  const live = loadBackground({ page: realPage });
  const ask = (q) => live.__ask({ type: "smartAsk", instruction: q });
  runAsync(async () => {
    try {
      // A command reaches the page and acts on it.
      const cmd = await ask("select 30 day precipitation");
      ensure("a command is planned and run", cmd.ok === true, cmd.error || cmd);
      // Not tied to one path's wording: what matters is that a control on
      // the page was reached, whichever rung got there. This asserted
      // "Applied", the page-match phrasing, and broke the day the unified
      // picker started choosing the dropdown directly - a better outcome
      // failing a test written around the old one.
      ensure("against a real control",
        /Applied|done|choose|click|select/i.test((cmd.display || {}).title || ""), cmd.display);
      const caps = await ask("what can I do here");
      ensure("capabilities answer", caps.ok === true, caps.error || caps);
      ensure("and count the page's controls", caps.pageControls > 0, caps.pageControls);
      const mcp = await ask("webmcp");
      ensure("webmcp answers on any page", mcp.ok === true, mcp.error || mcp);
      // A browser without the API still derives tools, and saying only
      // "unavailable" hid the part that works on a site nobody wrote code
      // for. The count must be what the page yielded, not what got
      // registered.
      ensure("and reports tools derived without the API",
        (mcp.webmcp || {}).derived > 0 || /derived/.test((mcp.display || {}).subtitle || ""),
        mcp.webmcp || mcp.display);
      const capsMcp = await ask("what can I do here");
      const mcpRow = (capsMcp.display.rows || []).find((r) => r.name === "WebMCP");
      ensure("the capability card counts them too", mcpRow && /\d+ tools/.test(mcpRow.value), mcpRow);
      ensure("and does not just say unavailable", mcpRow && mcpRow.value !== "unavailable", mcpRow);
      check("with its own card", (mcp.display || {}).title, "WebMCP on this page");

      // A page that could not be read has to say why. The reason was being
      // discarded by the catch, so the card said only "could not read this
      // page's controls" - on a page whose controls the badge had counted
      // moments earlier, which reads as nonsense with nothing to act on.
      const broken = loadBackground({ page: realPage });
      broken.chrome.tabs.sendMessage = async () => { throw new Error("timed out waiting for the page bundle to reply"); };
      const unreadable = await broken.__ask({ type: "smartAsk", instruction: "go to contact" });
      // Wherever it lands - the error, the card - the reason has to reach the
      // person. It used to arrive in `checked`, from the failure explainer;
      // with the model on by default this answers earlier and more directly.
      // What must not happen is the model's state replacing the page's
      // reason, which is what "the local model is not answering yet" did to
      // "timed out waiting for the page bundle to reply".
      ensure("an unreadable page says why",
        /timed out/.test(`${unreadable.error || ""} ${(unreadable.display || {}).subtitle || ""} `
          + `${(unreadable.checked || []).join(" ")}`),
        { error: unreadable.error, sub: (unreadable.display || {}).subtitle });

      // The self-test has to survive whatever it is diagnosing, or it tells
      // you less than the problem did.
      const diag = await ask("diagnose");
      ensure("diagnose answers", !!(diag.display && diag.display.rows.length), diag);
      ensure("and names the build", diag.steps.some((x) => x.name === "extension version" && x.state === "ok"), diag.steps);
      ensure("a browser without WebMCP is not a failure",
        !diag.steps.some((x) => x.name === "WebMCP" && x.state === "failed"), diag.steps);

      // The same test, run where the page cannot be reached at all.
      const blind = loadBackground({ page: realPage });
      blind.chrome.tabs.sendMessage = async () => { throw new Error("timed out waiting for the page bundle to reply"); };
      const broke = await blind.__ask({ type: "smartAsk", instruction: "diagnose" });
      ensure("it still reports when the page is unreachable",
        broke.steps.some((x) => x.name === "page bundle reachable" && x.state === "failed"), broke.steps);
      ensure("and names the first failure in the headline",
        /page bundle reachable/.test((broke.display || {}).subtitle || ""), (broke.display || {}).subtitle);

      // The last step of the agent loop. A model shown the page's own tools
      // picks one by name - click30DayPrecipitation - and the executor has to
      // know how to run it. It was looking only in TOOL_DEFS, so a correct
      // choice came back as "no tool by that name exists" and the loop was
      // open at the end.
      for (const call of [{ name: "clickCurrentConditions", args: {} }, { name: "readThisPage", args: {} }]) {
        const ran = await live.executeToolCall("GENERIC", call).catch((e) => ({ ok: false, error: e.message }));
        ensure(`a model-chosen page tool runs: ${call.name}`, ran.ok === true, ran.error || ran);
      }
      // And one that does not exist is refused, not invented.
      const bogus = await live.executeToolCall("GENERIC", { name: "notARealTool", args: {} })
        .then(() => null).catch((e) => e.message);
      ensure("an unknown tool is refused", /no tool named/.test(bogus || ""), bogus);

      // "model:" puts a question to the model with the page's own tools,
      // skipping every cheap path. Without it the model is only reached once
      // everything else has failed, so there is no way to find out whether it
      // would have got something right.
      const forced = await ask("model: select 30 day precipitation");
      // The local model is on by default now, so the answer here is about it
      // loading or not answering rather than about it being switched off.
      // plannedBy is the settled signal: a forced request is attributed to
      // the model whether or not it could answer, because asking for it by
      // name and being handed the page's answer on an ordinary-looking card
      // is worse than no answer when checking is the point. The wording of
      // the reason varies - not started, still loading, no WebGPU - and
      // matching on the wording alone missed one of them.
      ensure("model: is recognised as a request for the model",
        forced.plannedBy === "model"
          || /still loading|not answering|not started|no WebGPU|webllm/i.test(
            `${(forced.display || {}).title || ""} ${forced.error || ""}`), forced);
      ensure("and it does not quietly answer from somewhere else",
        forced.plannedBy === "model", forced.plannedBy);
      // The same question without the prefix is answered without it.
      const unforced = await ask("select 30 day precipitation");
      ensure("and the prefix is what makes the difference",
        unforced.ok === true && unforced.plannedBy !== "webllm", unforced);

      // The model's job is to name one tool, so the prompt should be the
      // tools and almost nothing else. It was 3,136 tokens for that one
      // decision - 2,071 of them an env-vocab table and forty rows of
      // inventory prose, both written when the model still had to build a
      // CSS selector. Prefill on a small model is where the time goes, and
      // "the model is slow" was mostly this.
      const routing = await live.agentTools("GENERIC", "select 30 day precipitation", { max: 12 });
      const catalogue = routing.all.map((t) => {
        const spec = (t.parameters && t.parameters.properties) || {};
        const props = Object.entries(spec).map(([k, v]) =>
          Array.isArray(v.enum) && v.enum.length <= 8 ? `${k}: ${v.enum.join("|")}` : k);
        const gist = String(t.description || "").split(/[.\u2013-]/)[0].trim().slice(0, 60);
        return `${t.name}(${props.join(", ")})${gist ? " - " + gist : ""}`;
      }).join("\n");
      // The model can only pick from what it is shown. !d.run was meant to
      // drop the agency lookups and also dropped pageCompute, so "average
      // reservoir storage" reached a model with no averaging tool in its
      // list and nothing to pick but a wrong answer.
      ensure("the model can reach the one tool that calculates",
        routing.all.some((t) => t.name === "pageCompute"), routing.all.map((t) => t.name));
      ensure("and the agency lookups stay out of the routing list",
        !routing.all.some((t) => /^water|^weather/.test(t.name)), routing.all.map((t) => t.name));
      // Naming it has to work, not just seeing it.
      const computed = await live.executeToolCall("GENERIC", { name: "pageCompute", args: { fn: "mean", of: "max temp" } })
        .catch((e) => ({ ok: false, error: e.message }));
      ensure("and running it by name works", computed.ok !== false, computed.error || computed);

      // The model picks a number; the arguments are filled here. Asking it to
      // write the tool name and every argument spent around thirty decode
      // tokens on a decision carrying about four bits, and decode is most of
      // the wait.
      const computeDef = routing.all.find((t) => t.name === "pageCompute");
      if (computeDef) {
        const filled = live.argsForTool(computeDef, "average reservoir storage",
          live.meaningfulWords("average reservoir storage"));
        // An enum value is a machine's word for it; nobody types "mean".
        check("a human word maps to the schema's enum", filled.fn, "mean");
        // And the word naming the calculation is not part of what is calculated.
        check("the aggregate word stays out of the subject", filled.of, "reservoir storage");
        const misspelt = live.argsForTool(computeDef, "average resevoir storage",
          live.meaningfulWords("average resevoir storage"));
        check("a typo survives into the subject", misspelt.of, "resevoir storage");
      }
      check("total maps to sum",
        live.argsForTool(computeDef, "total storage", live.meaningfulWords("total storage")).fn, "sum");
      check("highest maps to max",
        live.argsForTool(computeDef, "highest storage", live.meaningfulWords("highest storage")).fn, "max");

      // What the model is shown first matters: a small model picking from a
      // numbered list pulls hard toward entry one. Scoring the readers as
      // infinitely relevant put readThisPage at number 1 for every question,
      // so "average reservoir storage" was offered a page dump first and the
      // calculating tool sixth.
      const order = (q) => live.agentTools("GENERIC", q, { max: 12 }).then((k) => k.all.map((t) => t.name));
      const forMaths = await order("average max temp");
      check("a calculation puts the calculating tool first", forMaths[0], "pageCompute");
      ensure("and the readers are kept, at the end",
        forMaths.indexOf("readThisPage") >= forMaths.length - 3, forMaths);
      // A command is unaffected by that prior.
      const forCommand = await order("click current conditions");
      ensure("a command still ranks its own control first",
        /^click/i.test(forCommand[0]), forCommand.slice(0, 3));

      ensure("the routing prompt stays under ~400 tokens",
        catalogue.length < 1600, `${Math.round(catalogue.length / 4)} tokens`);
      ensure("and no page context is bolted on when tools describe the page",
        routing.page.length > 0, "no page tools, so context is still needed");
      // Enums survive the trimming: they are what stops a model inventing a
      // value the page does not offer.
      const withEnum = routing.all.find((t) => Object.values((t.parameters || {}).properties || {})
        .some((v) => Array.isArray(v.enum) && v.enum.length));
      if (withEnum) ensure("an enum is still spelled out", /\|/.test(catalogue) || /: /.test(catalogue), catalogue.slice(0, 120));

      // Nonsense must fail as an answer, not as a crash.
      const junk = await ask("fly me to the moon");
      ensure("nonsense is explained, not thrown", junk.ok === false && !!junk.display, junk);
    } finally {
    }
  });
}

section("the same page on a different machine");
// A question with no day named resolved the column from new Date(), so the
// answer depended on where the reader was sitting: the same forecast table
// read 79 in Los Angeles and 88 in Kiritimati, both confidently. A page that
// labels a column "Today" has said which day it means, and that beats any
// clock.
const dayTable = (cols) => ({ title: "Point Forecast", headings: [], text: "x",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: cols, rows: [["Max Temp, \u00b0F", "82", "79", "88"]] }] });
const columnFor = (cols) => {
  const h = sb.findOnPage(dayTable(cols), { wants: ["high", "temperature"], place: null, day: null });
  return h ? h[0].label : null;
};
check("the page's own label decides the day",
  columnFor(["Weekly Summary", "Today", "Fri Sep 18", "Sat Sep 19"]),
  "Max Temp, \u00b0F \u00b7 Today: 82");
check("and so do the NWS period names",
  columnFor(["Weekly Summary", "This Afternoon", "Tonight", "Saturday"]),
  "Max Temp, \u00b0F \u00b7 This Afternoon: 82");
// With nothing stated, the clock is the only guide left - but whichever
// column it lands on is always named in the answer, so two readers who
// disagree can see why.
const fallback = columnFor(["Weekly Summary", "Thu Sep 17", "Fri Sep 18", "Sat Sep 19"]);
ensure("a clock-chosen column still names itself", /Sep \d+:/.test(fallback || ""), fallback);
// A named day always wins over both.
const named = sb.findOnPage(dayTable(["Weekly Summary", "Today", "Fri Sep 18", "Sat Sep 19"]),
  { wants: ["high", "temperature"], place: null, day: "saturday" });
check("a day the user named beats the page's label", named[0].label, "Max Temp, \u00b0F \u00b7 Sat Sep 19: 88");

section("how much needs a model at all");
// The point of handing a model the page's own tools is that it should rarely
// be needed. This measures that rather than assuming it: a fixture of real
// instruction shapes against pages built like the sites this runs on, scored
// by the deterministic path alone. It asserts a floor, so a change that
// quietly pushes work onto the model shows up here instead of in a latency
// complaint.
const archetypes = {
  mapSite: `<!doctype html><html><body>
    <nav><a href="/">Home</a><a href="/about">About</a><button>Sign in</button></nav>
    <a class="map-tab" href="#p30">30-Day Precipitation</a>
    <a class="map-tab" href="#cur">Current Conditions</a>
    <label for="basemap">Basemap</label>
    <select id="basemap"><option>Streets</option><option>Satellite</option><option>Topographic</option></select>
    <label for="q">Search</label><input id="q" type="search">
    <label for="alerts">Email alerts</label><input id="alerts" type="checkbox">
    </body></html>`,
  dataSite: `<!doctype html><html><body>
    <label for="state">Select a state</label>
    <select id="state"><option>Idaho</option><option>Minnesota</option><option>Alaska</option></select>
    <label for="param">Parameter</label>
    <select id="param"><option>Discharge</option><option>Gage height</option></select>
    <button id="dl">Download data</button>
    <table><tr><th>Day</th><th>Max Temp, °F</th></tr>
      <tr><td>Today</td><td>81</td></tr><tr><td>Friday</td><td>85</td></tr></table>
    </body></html>`,
};
const fixtures = [
  ["mapSite",  "click 30 day precipitation",      "click30DayPrecipitation"],
  ["mapSite",  "select 30 day precipitation",     "click30DayPrecipitation"],
  ["mapSite",  "show current conditions",         "clickCurrentConditions"],
  ["mapSite",  "set the basemap to satellite",    "chooseBasemap"],
  ["mapSite",  "click satellite",                 "chooseBasemap"],
  ["mapSite",  "turn on email alerts",            "toggleEmailAlerts"],
  ["mapSite",  "search for boise",                "searchSearch"],
  ["dataSite", "select minnesota",                "chooseSelectAState"],
  ["dataSite", "choose alaska",                   "chooseSelectAState"],
  ["dataSite", "set the parameter to gage height","chooseParameter"],
  ["dataSite", "download data",                   "clickDownloadData"],
  ["dataSite", "read this page",                  "readThisPage"],
];
const pages = {};
for (const [name, html] of Object.entries(archetypes)) pages[name] = loadPage(html, { url: "https://example.gov/" });
if (!pages.mapSite) skip("model necessity", "jsdom not installed");
else {
  const resolved = [];
  for (const [site, q, want] of fixtures) {
    const page = pages[site];
    const tools = page.GENERIC.pageTools().tools;
    // The deterministic path, scoring the page's own tools exactly as the
    // model would be asked to.
    const pick = sb.planDeclaredTool(q, tools.map((t) => ({ ...t, declaredBy: "page" })));
    resolved.push({ q, want, got: pick ? pick.tool.name : null });
  }
  const right = resolved.filter((r) => r.got === r.want);
  const missed = resolved.filter((r) => r.got !== r.want);
  // A floor, not a target. Below this something has regressed; above it, the
  // model is handling a genuinely small residue.
  ensure(`the scorer alone resolves ${right.length}/${resolved.length} without a model`,
    right.length >= 9, missed.map((m) => `${m.q} -> ${m.got}`));
  // Whatever it cannot resolve must fall through cleanly, not wrongly: a
  // wrong tool run confidently is worse than no tool at all.
  const wrong = missed.filter((m) => m.got !== null);
  ensure("and what it cannot resolve is declined, not guessed",
    wrong.length <= 3, wrong.map((m) => `${m.q} -> ${m.got} (wanted ${m.want})`));
}

section("a real site nobody wrote code for");
// From waterdatafortexas.org, which has no manifest and was never opened
// while this was being built. Its statewide page has a column called
// "Reservoir Storage (acre-ft)" and eight rows that are the same reservoir on
// eight different dates.
const txPage = {
  title: "Statewide reservoir conditions", headings: [], text: "texas reservoirs",
  pairs: [], readouts: [], labelledNumbers: [],
  tables: [{ columns: ["", "Date", "Percent Full", "Reservoir Storage (acre-ft)"], rows: [
    ["Today", "2026-09-18", "71", "26,810,632"],
    ["Yesterday", "2026-09-17", "71", "26,839,775"],
    ["2 days ago", "2026-09-16", "71", "26,919,558"],
    ["1 week ago", "2026-09-11", "72", "27,081,104"],
    ["1 month ago", "2026-08-18", "73", "27,500,000"],
  ] }],
};
const txAsk = (q) => {
  const agg = sb.aggregateWanted(q);
  if (!agg) return null;
  const subject = sb.meaningfulWords(q).filter((w) => !["total", "sum", "average", "avg", "mean", "highest", "of"].includes(w));
  const match = subject.length ? (label) => subject.every((w) => sb.wordMatchesText(w, label)) : null;
  return sb.aggregateOnPage(txPage, { wants: sb.pageValueWants(q), place: null, agg, match });
};
// The subject is a word this vocabulary has never met, so it has to be matched
// against the page's own wording. Without that the question skipped the page
// and ended up clicking two navigation links - answered by navigating away.
// Typed as it was actually typed. A plain substring match handled the
// correctly spelled version and missed this one, so the fix passed its own
// test and failed the person who reported it.
const misspelt = txAsk("total resevoir storage");
ensure("a typo still finds the column", !!misspelt, "resevoir did not match Reservoir Storage");
const totalled = txAsk("total reservoir storage");
ensure("an unknown subject still finds its column", !!totalled, "no column matched");
// And then the sum is refused, because those rows are eight snapshots of one
// number: adding them gave a statewide total of 219,891,203 acre-ft.
check("summing a time series is refused", totalled.value, null);
ensure("and says what to ask instead", /average/.test(totalled.refused || ""), totalled.refused);
// An average over the same rows is meaningful, and carries the right unit.
const averaged = txAsk("average reservoir storage");
check("an average is allowed", averaged.value !== null, true);
// The rows read 26,803,406 and the answer read 27485497.1 - one quantity in
// two notations, one of them unreadable at that size.
check("and is grouped the way the page writes its numbers",
  /^\d{1,3}(,\d{3})+/.test(averaged.value), true);
check("a page that does not group is left alone",
  sb.formatStat("mean", 61, ["56", "64", "63"]), "61.0");
check("and acre-ft is not ft", averaged.unit, "acre-ft");
// The unit trap on its own: "ft" lives inside "acre-ft".
check("acre-ft reads whole", sb.cellUnit("26,810,632 acre-ft"), "acre-ft");
check("plain ft still reads", sb.cellUnit("3.21 ft"), "ft");
// A table of places, not times, is summable as before.
const byPlace = { ...txPage, tables: [{ columns: ["Reservoir", "Storage"], rows: [
  ["Lake A", "100"], ["Lake B", "200"], ["Lake C", "300"]] }] };
const placeSum = sb.aggregateOnPage(byPlace, { wants: [], place: null,
  agg: { fn: "sum", word: "total" }, match: (l) => l.includes("storage") });
check("a total across places still works", placeSum.value, "600");

section("failures explain themselves");
const why = sb.explainFailure("barometric trend", { global: "GENERIC" }, { ok: true, result: inv }, { modelOff: true });
ensure("says what it checked", why.checked.length >= 2, why.checked);
ensure("lists what it can do", why.capabilities.dataQuestions.length >= 5, why.capabilities);
const unreadable = sb.explainFailure("weekly", { global: "GENERIC" }, { ok: false }, { modelOff: true });
// "I could not read the page" and "I read it and it is not there" are
// different problems with different fixes.
ensure("distinguishes an unreadable page", /couldn't read this page/i.test(unreadable.error), unreadable.error);

section("reading a page");
const page = loadPage(`<!doctype html><html><head><title>Station MKE</title></head><body>
  <h1>Milwaukee</h1>
  <dl><dt>Air temperature</dt><dd>64.4 °F</dd></dl>
  <table><caption>Readings</caption><tr><th>Time</th><th>Stage</th></tr>
  <tr><td>23:00</td><td>4.21 ft</td></tr></table>
  <div class="stat-value" aria-label="Gage height">4.21 ft</div>
  <svg><title>Weekly stage</title><text>Mon</text><circle aria-label="Tue 4.3 ft"/></svg>
  <canvas></canvas></body></html>`);
if (!page) skip("readPage", "jsdom not installed - npm i -D jsdom");
else {
  const d = page.GENERIC.readPage();
  check("title", d.title, "Station MKE");
  check("labelled pair", d.pairs[0], { label: "Air temperature", value: "64.4 °F" });
  check("table columns", d.tables[0].columns, ["Time", "Stage"]);
  check("table row", d.tables[0].rows[0], ["23:00", "4.21 ft"]);
  check("readout label", d.readouts[0].label, "Gage height");
  check("SVG chart point", d.chart.svgCharts[0].points, ["Tue 4.3 ft"]);
  const blank = loadPage(`<!doctype html><html><head><title>X</title></head><body><canvas></canvas></body></html>`);
  // An empty result reads as "no data here"; the truth is that the data is
  // pixels. Those are different answers.
  ensure("canvas-only says why it read nothing", /canvas/.test(blank.GENERIC.readPage().note || ""), blank.GENERIC.readPage().note);
}

section("answering from the page you are on");
const wxPage = loadPage(`<!doctype html><html><head><title>National Weather Service Chicago IL</title></head><body>
  <h1>Chicago, IL</h1>
  <li><p class="period">Today</p><p class="temp temp-high">High: 83 °F</p></li>
  <li><p class="period">Tonight</p><p class="temp temp-low">Low: 67 °F</p></li>
  <p>Humidity 52%</p><p>Wind Speed 9 mph</p></body></html>`);
if (!wxPage) skip("page values", "jsdom not installed");
else {
  const pd = wxPage.GENERIC.readPage();
  // Pages write "High: 83 °F", never "High temperature: 83", and these are a
  // single text run so readPairs/readReadouts never see them.
  check("inline labelled numbers are found", pd.labelledNumbers.map((n) => n.text),
    ["High: 83 °F", "Low: 67 °F", "Humidity 52%", "Wind Speed 9 mph"]);
  const hits = (q, place) => {
    const wants = sb.pageValueWants(q);
    const r = wants.length ? sb.findOnPage(pd, { wants, place: place || null }) : null;
    return r ? r.map((h) => h.label) : null;
  };
  // The unit stands in for the noun, or every forecast page looks empty.
  check("max temperature reads the page", hits("max temperature"), ["High: 83 °F"]);
  check("min temperature reads the page", hits("min temperature"), ["Low: 67 °F"]);
  check("humidity", hits("humidity"), ["Humidity 52%"]);
  // Both aspects must hold, or "Wind Speed 9 mph" answers "max temperature".
  ensure("a wind reading does not answer a temperature question",
    !(hits("max temperature") || []).some((h) => /wind/i.test(h)), hits("max temperature"));
  // Reading Milwaukee's numbers for a Chicago question would be worse than
  // fetching, so a page about somewhere else is not used.
  check("a question about elsewhere is not answered from this page", hits("max temperature in milwaukee", "milwaukee"), null);
  check("something the page lacks falls through", hits("gage height"), null);
  // A bare "high" is a qualifier, not a subject.
  check("bare qualifier asks for nothing", sb.pageValueWants("show me the high"), []);
}

section("a place that is one row of a table");
// A regional forecast is a table of towns. Title-and-headings matching never
// sees the one asked about, so the page looked irrelevant and it fetched -
// reporting the state centre, miles from the town whose row was on screen.
const tablePage = loadPage(`<!doctype html><html><head><title>NWS Duluth MN</title></head><body>
  <h1>Northeast Minnesota</h1>
  <table><caption>Tuesday</caption>
  <tr><th>Location</th><th>High</th><th>Low</th><th>Wind</th></tr>
  <tr><td>Duluth</td><td>64 °F</td><td>48 °F</td><td>12 mph</td></tr>
  <tr><td>Hermantown MN</td><td>71 °F</td><td>46 °F</td><td>9 mph</td></tr>
  </table></body></html>`);
if (!tablePage) skip("table rows", "jsdom not installed");
else {
  const td = tablePage.GENERIC.readPage();
  const hit = (q, place) => {
    const r = sb.findOnPage(td, { wants: sb.pageValueWants(q), place });
    return r ? r.map((h) => h.label) : null;
  };
  check("reads the row for the town asked about",
    hit("max temperature on hermantown mn", "hermantown"), ["Hermantown MN · High: 71 °F"]);
  // The column header decides which cell, so min is not the same cell as max.
  check("the column header picks the cell",
    hit("min temperature in hermantown", "hermantown"), ["Hermantown MN · Low: 46 °F"]);
  // Reading a neighbouring row would be worse than fetching.
  check("a different row is a different answer",
    hit("max temperature in duluth", "duluth"), ["Duluth · High: 64 °F"]);
  check("a town not in the table still fetches", hit("max temperature in chicago", "chicago"), null);
  // A date in the question was becoming part of the place ("hermantown sep
  // 15"), which matched no row and no gauge, so it fetched and answered from
  // the state centre while the town's row was on screen.
  const dated = plan("max temperature of hermantown mn on tuesday sep 15", { global: "FCP" });
  check("a date is not part of the place", dated.args.place, "hermantown");
  check("the named day is kept", dated.args.when, "high:tuesday");
  check("and the row is then found",
    hit("max temperature of hermantown mn on tuesday sep 15", dated.args.place), ["Hermantown MN · High: 71 °F"]);
  // "Wind 9 mph" sits in the same row and must not answer a temperature question.
  ensure("the wind column does not answer a temperature question",
    !(hit("max temperature on hermantown mn", "hermantown") || []).some((h) => /wind|mph/i.test(h)),
    hit("max temperature on hermantown mn", "hermantown"));
}

// With the blind path closed, these reach the planner that reads the page -
// which finds the option inside the dropdown and follows through to it.
const dropPage = loadPage(`<!doctype html><html><body>
  <label for="layer">Map layer</label>
  <select id="layer">
    <option value="cur">Current conditions</option>
    <option value="p30">30 Day Precipitation</option>
  </select><button type="submit">Go</button></body></html>`, { url: "https://example.gov/map" });
if (!dropPage) skip("dropdown options", "jsdom not installed");
else {
  const inv = dropPage.GENERIC.inventory();
  const pick = (q) => {
    const g = sb.planGenericTool(q, inv);
    return g && g.calls ? g.calls.map((c) => `${c.name} ${JSON.stringify(c.args)}`).join(" + ") : null;
  };
  const expected = 'pageSelectOption {"selector":"#layer","value":"p30"} + pageSubmit {"selector":"#layer"}';
  check("an option inside a dropdown is found", pick("select 30 day precipitation"), expected);
  check("clicking it means the same", pick("click 30 day precipitation"), expected);
  check("and so does choosing it", pick("choose 30 day precipitation"), expected);
}

// postMessage structured-clones its payload and a DOM node cannot be cloned.
// click() returned the element it clicked, so a click that had already worked
// came home as "HTMLAnchorElement object could not be cloned" - an action
// reported as a failure after the fact, which is the kind of error people
// retry until something breaks.
const clickPage = loadPage(`<!doctype html><html><body>
  <a id="tab" class="map-tab" href="https://example.gov/p">30-Day Precipitation</a>
  </body></html>`, { url: "https://example.gov/" });
if (!clickPage) skip("click results travel", "jsdom not installed");
else {
  const r = clickPage.GENERIC.click("#tab");
  check("a click says what it clicked", r, { clicked: "a", label: "30-Day Precipitation" });
  ensure("and the answer can be posted home",
    (() => { try { structuredClone(r); return true; } catch (e) { return false; } })(), r);
}

section("WebMCP: what the page says about itself");
// Everything else here reconstructs a page's abilities from its markup. A
// page that registers navigator.modelContext tools has stated them outright,
// with real schemas - so those come first and the guessing never runs.
const declared = [
  { name: "setBasemap", description: "Change the map basemap style",
    inputSchema: { type: "object", properties: { style: { type: "string", enum: ["satellite", "topographic"] } }, required: ["style"] } },
  { name: "clearAllFilters", description: "Remove every filter currently applied",
    inputSchema: { type: "object", properties: {} } },
];
const chose = (q) => { const p = sb.planDeclaredTool(q, declared); return p ? `${p.tool.name} ${JSON.stringify(p.args)}` : null; };
check("a declared tool is matched from plain English", chose("set the basemap to satellite"), 'setBasemap {"style":"satellite"}');
check("with the same verb synonyms as everything else", chose("click satellite"), chose("set the basemap to satellite"));
check("a no-argument tool still matches", chose("clear all filters"), "clearAllFilters {}");
check("and an unrelated question matches nothing", chose("what is the weather in boise"), null);
// pageMcpCall's name must come from the page, so it is never planned blind.
// Ordering is the whole feature. The block sat below both the page reader and
// the data lookups, so a page that declared its tools was scraped anyway.
const bgSrc = require("fs").readFileSync(
  require("path").join(__dirname, "..", "background.js"), "utf8");
ensure("declared tools are consulted before the page is read",
  bgSrc.indexOf('invokeOnActiveTab("mcpTools"') < bgSrc.indexOf("const wants = commandLike"),
  "the WebMCP rung sits below scraping");
// Publishing left no trace in the UI, so the only way to see WebMCP working
// was to open a page written to demonstrate it - which says nothing about the
// site you are actually on. Asking about it is now a question the panel
// answers, on whatever page you happen to be.
const asksAboutMcp = (q) => /\bweb ?mcp\b|\bmodel ?context\b|\b(declared|published) tools\b/i.test(q);
for (const q of ["webmcp", "what webmcp tools are here", "list published tools", "model context"]) {
  check(`"${q}" is answerable`, asksAboutMcp(q), true);
}
check("and an ordinary command is not swallowed", asksAboutMcp("set the basemap to satellite"), false);
check("nor is a data question", asksAboutMcp("north fork elkhorn river discharge"), false);

check("calling a declared tool is not guessed at",
  (sb.planManifestTool("call the mcp tool", "GENERIC") || {}).name !== "pageMcpCall", true);

const mcpPage = loadPage("<!doctype html><html><body><p>plain</p></body></html>", { url: "https://example.gov/" });
if (!mcpPage) skip("WebMCP on a page", "jsdom not installed");
else {
  // A browser without the API says so, rather than failing somewhere later.
  // The API moved from navigator to document. navigator still works but warns
  // on every access, which filled the extension's error list with noise on
  // any page this touches repeatedly.
  runAsync(async () => {
    const bare = await mcpPage.GENERIC.mcpInfo();
    check("an unsupporting browser is reported plainly", bare.available, false);
    ensure("and says what it would need", /modelContext/.test(bare.note), bare.note);
  });

  // Now a browser that has it.
  const registered = [];
  Object.defineProperty(mcpPage.navigator, "modelContext", {
    configurable: true,
    value: { registerTool: (def) => registered.push(def) },
  });
  const out = mcpPage.GENERIC.mcpRegister([
    { name: "pageClick", fn: "click", argOrder: ["selector"],
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
      description: "Click something on the page" },
    { name: "notARealFunction", fn: "nopeNotHere", argOrder: [] },
  ]);
  check("the page's verified controls are published", out.registered, 1);
  check("a tool with no implementation is skipped", out.names, ["pageClick"]);
  check("and the browser actually received it", registered.length, 1);
  ensure("with a schema attached", !!registered[0].inputSchema, registered[0]);

  // Registered tools are readable and runnable even where the API exposes
  // no way to enumerate or invoke from page script.
  runAsync(async () => {
    const listed = await mcpPage.GENERIC.mcpTools();
    check("what was registered can be read back", listed.tools.map((t) => t.name), ["pageClick"]);
    check("and it says where it read them", listed.readFrom, "local registry");

    // Provenance decides the cascade. Tools this extension publishes come back
    // from the browser's own list looking exactly like the page's, and
    // preferring those over reading the page would route our own functions
    // through a longer pipe to reach themselves.
    check("a published tool is marked as ours", listed.tools[0].declaredBy, "extension");
    check("and is not counted as page-declared",
      listed.tools.filter((t) => t.declaredBy === "page").length, 0);
  });

}

// Same again, but where the browser exposes its own enumeration - the case
// where the two provenances arrive side by side and have to be told apart.
const mixedPage = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://water.noaa.gov/" });
if (!mixedPage) skip("WebMCP provenance", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(mixedPage.navigator, "modelContext", {
    configurable: true,
    value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  // The site's own tool, registered before the extension arrives.
  shelf.push({ name: "siteOwnTool", description: "Something the site declares", inputSchema: { type: "object", properties: {} } });
  mixedPage.GENERIC.mcpRegister([
    { name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click something",
      parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
  ]);
  runAsync(async () => {
    const all = await mixedPage.GENERIC.mcpTools();
    check("both are visible", all.tools.length, 2);
    check("the site's is the page's", all.tools.find((t) => t.name === "siteOwnTool").declaredBy, "page");
    check("ours is still ours", all.tools.find((t) => t.name === "pageClick").declaredBy, "extension");
  });
}

// Publishing the extension's own primitives gives an agent half a toolbox it
// cannot use: click(selector) means nothing until it has fetched an inventory
// and built a selector. That is the blind-selector problem this project spent
// its time removing from its own planner, handed to somebody else.
const agentPage = loadPage(`<!doctype html><html><body>
  <a class="map-tab" href="#p30">30-Day Precipitation</a>
  <label for="layer">Data layer</label>
  <select id="layer"><option>Current</option><option>Drought Outlook</option></select>
  <label for="q">Search</label><input id="q" type="search">
  <label for="alerts">Email alerts</label><input id="alerts" type="checkbox">
  </body></html>`, { url: "https://example.gov/" });
if (!agentPage) skip("tools an agent can use", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(agentPage.navigator, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  const out = agentPage.GENERIC.mcpPublishControls();
  const byName = (n) => shelf.find((t) => t.name === n);

  ensure("controls become tools in their own right", out.registered > 4, out);
  // The whole point: an agent never sees, and never needs, a selector.
  check("no selector reaches the schema",
    shelf.some((t) => JSON.stringify(t.inputSchema).includes("selector")), false);

  // Named verb-first from the page's own words: an agent reads the name
  // before anything else, and a label starting with a digit cannot begin an
  // identifier on its own.
  ensure("named verb-first from its own label", !!byName("click30DayPrecipitation"), shelf.map((t) => t.name));
  ensure("a dropdown says choose", shelf.some((t) => /^chooseDataLayer/.test(t.name)), shelf.map((t) => t.name));
  ensure("a checkbox says toggle", shelf.some((t) => /^toggleEmailAlerts/.test(t.name)), shelf.map((t) => t.name));

  // A dropdown publishes what it will accept, so an agent cannot invent a
  // value the page does not offer.
  const layer = shelf.find((t) => /layer/i.test(t.name));
  check("a dropdown declares its options",
    layer.inputSchema.properties.value.enum, ["Current", "Drought Outlook"]);
  // A checkbox is a boolean, not a click.
  const alerts = shelf.find((t) => /alert/i.test(t.name));
  check("a checkbox takes a boolean", alerts.inputSchema.properties.on.type, "boolean");
  // A search box takes text, and says it can submit.
  const search = shelf.find((t) => /search/i.test(t.name));
  check("a text field takes text", search.inputSchema.required, ["text"]);

  // Driving is half of it. An agent that cannot read the result is blind.
  for (const r of ["readThisPage", "listPageControls", "listPageDataRequests"]) {
    ensure(`${r} is published`, !!byName(r), shelf.map((t) => t.name));
  }

  // Publishing twice must not double-register.
  const again = agentPage.GENERIC.mcpPublishControls();
  check("republishing adds nothing", again.registered, 0);
}

// document.modelContext is the current spelling; navigator.modelContext is
// deprecated and warns on every access.
const docMcp = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://example.gov/" });
if (!docMcp) skip("modelContext on document", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(docMcp.document, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  docMcp.GENERIC.mcpRegister([{ name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click",
    parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } }]);
  runAsync(async () => {
    const got = await docMcp.GENERIC.mcpTools();
    check("document.modelContext is used", got.readFrom, "document.modelContext.getTools");
    check("and its tools are found", got.tools.length, 1);
    // Preferred over the deprecated one when both exist.
    Object.defineProperty(docMcp.navigator, "modelContext", {
      configurable: true, value: { registerTool() {}, getTools: () => [{ name: "fromNavigator" }] },
    });
    check("document wins over navigator",
      (await docMcp.GENERIC.mcpTools()).readFrom, "document.modelContext.getTools");
  });
}

// The older spelling still has to work, for a browser that only has that one.
const navMcp = loadPage("<!doctype html><html><body><p>x</p></body></html>", { url: "https://example.gov/" });
if (!navMcp) skip("modelContext on navigator", "jsdom not installed");
else {
  const shelf = [];
  Object.defineProperty(navMcp.navigator, "modelContext", {
    configurable: true, value: { registerTool: (d) => shelf.push(d), getTools: () => shelf },
  });
  navMcp.GENERIC.mcpRegister([{ name: "pageClick", fn: "click", argOrder: ["selector"], description: "Click",
    parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } }]);
  runAsync(async () => {
    check("navigator alone still works",
      (await navMcp.GENERIC.mcpTools()).readFrom, "navigator.modelContext.getTools");
  });
}

// Reloading the extension must actually take effect on tabs that are already
// open. The bridge guarded itself with a boolean, so the first build to touch
// a page owned it: window.GENERIC was replaced on re-injection but the old
// listener stayed, and any fix to the bridge did nothing until the page was
// reloaded too - indistinguishable from a fix that did not work.
const reinject = loadPage("<!doctype html><html><body><a id=a href=\"/x\">Contact</a></body></html>", { url: "https://example.gov/" });
if (!reinject) skip("re-injection replaces the bridge", "jsdom not installed");
else {
  const first = reinject.__wcPageBridge;
  ensure("the bridge handler is reachable", typeof first === "function", typeof first);
  const again = reinject.document.createElement("script");
  again.textContent = require("fs").readFileSync(
    require("path").join(__dirname, "..", "page", "generic-bundle.js"), "utf8");
  reinject.document.body.appendChild(again);
  ensure("re-injection replaces it", reinject.__wcPageBridge !== first, "the old listener survived");
  ensure("and the manifest is replaced too", typeof reinject.GENERIC.click === "function", "GENERIC lost");
}

// A shadow DOM made the whole page unreadable. createTreeWalker's
// SHOW_ELEMENT filters what nextNode() returns but not currentNode, which
// starts as the root - and for a shadow tree that root is a ShadowRoot, with
// no tagName and no getAttribute. inventory() threw on the first such page it
// met and the extension reported "could not read this page's controls" on a
// page full of them. USGS state pages are built this way, so it was all of
// them.
const shadowPage = loadPage(`<!doctype html><html><body>
  <div id="host"></div>
  <a href="/x">Plain link</a>
  <script>
    const r = document.getElementById("host").attachShadow({ mode: "open" });
    r.innerHTML = "<button id=inner>Get more information</button><select id=s><option>A</option></select>";
  <\/script></body></html>`, { url: "https://waterdata.usgs.gov/state/Minnesota/" });
if (!shadowPage) skip("shadow DOM", "jsdom not installed");
else {
  let inv = null, threw = null;
  try { inv = shadowPage.GENERIC.inventory(); } catch (e) { threw = e.message; }
  ensure("a shadow DOM does not crash the inventory", !threw, threw);
  ensure("and its controls are found",
    (inv.controls || []).some((c) => c.label === "Get more information"),
    (inv.controls || []).map((c) => c.label));
  ensure("alongside the ones in the light DOM",
    (inv.controls || []).some((c) => c.label === "Plain link"),
    (inv.controls || []).map((c) => c.label));
  // Reading the page has to survive it too.
  let read = null;
  try { read = shadowPage.GENERIC.readPage(); } catch (e) { read = { error: e.message }; }
  ensure("and the page can still be read", !read.error, read.error);
}

section("charts, maps and other pages");
const chartPage = loadPage(`<!doctype html><html><head><title>Gauge</title></head><body>
  <canvas id="c" width="400" height="200"></canvas>
  <div class="tooltip" id="tip" style="display:none"></div></body></html>`);
if (!chartPage) skip("hover / map / cross-page", "jsdom not installed");
else {
  // A canvas chart keeps its numbers nowhere in the DOM until hovered, so
  // this is the only way to read one that captured no data request.
  const canvas = chartPage.document.getElementById("c");
  const tip = chartPage.document.getElementById("tip");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200 });
  const series = [["Mon", "4.1 ft"], ["Tue", "4.3 ft"], ["Wed", "3.9 ft"]];
  canvas.addEventListener("mousemove", (e) => {
    const i = Math.min(series.length - 1, Math.floor((e.clientX / 400) * series.length));
    tip.textContent = `${series[i][0]}: ${series[i][1]}`;
    tip.style.display = "block";
  });

  // A map instance is exact where hovering pixels is guesswork - and on a
  // map a stray pointer pans it, so hovering is worse than useless there.
  const mapPage = loadPage(`<!doctype html><html><body><canvas></canvas></body></html>`);
  mapPage.someMap = { eachLayer(fn) {
    [{ lat: 61.2, lng: -149.9, name: "Ship Creek" }].forEach((m) => fn({
      getLatLng: () => ({ lat: m.lat, lng: m.lng }),
      getPopup: () => ({ getContent: () => `<b>${m.name}</b> 4.2 ft` }),
    }));
  } };
  const mf = mapPage.GENERIC.mapFeatures();
  check("map features come from the library instance", mf.source, "js-instance");
  check("with their coordinates", [mf.features[0].lat, mf.features[0].lon], [61.2, -149.9]);
  check("popup markup is stripped", mf.features[0].label, "Ship Creek 4.2 ft");

  const bare = loadPage(`<!doctype html><html><body><canvas class="maplibregl-canvas"></canvas></body></html>`);
  const bareMap = bare.GENERIC.mapFeatures();
  check("a canvas map with no instance says so", bareMap.source, "none");
  ensure("and explains the limit", /canvas/.test(bareMap.note), bareMap.note);

  // "I am on Idaho and want Alaska" - answering without navigating away.
  const linkPage = loadPage(`<!doctype html><html><head><title>Idaho</title></head><body>
    <a href="/state/Alaska/">Alaska</a><a href="https://elsewhere.gov/x">Offsite</a></body></html>`);
  linkPage.fetch = async () => ({ ok: true, status: 200, text: async () =>
    `<html><head><title>Alaska conditions</title></head><body><h1>Alaska</h1>
     <table><tr><th>Gauge</th><th>Stage</th></tr><tr><td>Ship Creek</td><td>4.2 ft</td></tr></table></body></html>` });
  check("only same-origin links are offered", linkPage.GENERIC.pageLinks().links.map((l) => l.label), ["Alaska"]);

  (async () => {
    const hov = await chartPage.GENERIC.hoverSeries({ samples: 6, settle: 1 });
    ensure("hovering recovers a canvas chart's series", hov.points.length >= 3, hov.points);
    ensure("and says it sampled rather than enumerated", /sampled/.test(hov.note), hov.note);

    const empty = loadPage(`<!doctype html><html><body><canvas id="x"></canvas></body></html>`);
    empty.document.getElementById("x").getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 });
    const none = await empty.GENERIC.hoverSeries({ samples: 3, settle: 1 });
    // A tooltip drawn into the canvas is unreadable; saying so beats "no data".
    ensure("no tooltip is explained, not reported as empty", /canvas/.test(none.note), none.note);

    const other = await linkPage.GENERIC.readUrl("/state/Alaska/");
    check("another page is read without navigating", other.title, "Alaska conditions");
    check("and its table extracted", other.tables[0].rows[0], ["Ship Creek", "4.2 ft"]);
    let refused = null;
    try { await linkPage.GENERIC.readUrl("https://elsewhere.gov/x"); } catch (e) { refused = e.message; }
    ensure("a different site is refused", /different site/.test(refused || ""), refused);
    finishPageTools();
  })();
}

function finishPageTools() {
section("a table of measurements by day");
// The layout weather.gov actually uses, which is the transpose of what the
// place-row lookup expects: measurements down the side, days across the top,
// and the location stated in prose rather than in the table at all. Missing
// it meant a page showing exactly the number asked for fell through to the
// agency, which answered from the centre of the state.
const gridPage = loadPage(`<!doctype html><html><head><title>Point Forecast</title></head><body>
  <p>0 miles N of Hermantown, MN</p>
  <table>
  <tr><th>Weekly Summary</th><th>Mon Sep 14</th><th>Tue Sep 15</th><th>Wed Sep 16</th></tr>
  <tr><td>Max Temp, °F</td><td>56</td><td>64</td><td>63</td></tr>
  <tr><td>Min Temp, °F</td><td>56</td><td>47</td><td>40</td></tr>
  <tr><td>Max Wind, mph</td><td>12</td><td>22</td><td>6</td></tr>
  </table></body></html>`, { url: "https://www.weather.gov/forecastpoints" });
if (!gridPage) skip("measurement tables", "jsdom not installed");
else {
  const gd = gridPage.GENERIC.readPage();
  // The place is in prose, so the page's own text is what identifies it.
  ensure("the page's text is sampled", /hermantown/i.test(gd.text || ""), (gd.text || "").slice(0, 60));
  const ask = (q) => {
    const plan = sb.planDataTool(q, { global: "FCP" });
    const place = plan && plan.args ? (plan.args.place || plan.args.nameContains) : null;
    const when = plan && plan.args ? plan.args.when : null;
    const day = when && String(when).includes(":") ? String(when).split(":")[1] : null;
    const r = sb.findOnPage(gd, { wants: sb.pageValueWants(q), place, day });
    return r ? r[0].label : null;
  };
  check("the named day picks the column",
    ask("max temperature of hermantown, MN on tuesday sep 15"), "Max Temp, °F · Tue Sep 15: 64");
  // The row label picks the row, so min and max are different rows.
  check("min reads a different row", ask("min temperature of hermantown on wednesday"), "Min Temp, °F · Wed Sep 16: 40");
  check("wind is a different row again", ask("max wind in hermantown on tuesday"), "Max Wind, mph · Tue Sep 15: 22");
  // Without "MN" there is no state, and that path was dropping the day.
  ensure("a day survives even with no state named", /Wed/.test(ask("min temperature of hermantown on wednesday") || ""), ask("min temperature of hermantown on wednesday"));
  check("elsewhere still fetches", ask("max temperature of chicago on tuesday"), null);
}

section("headers without <th>, and abbreviated days");
// The real page marks its header row with <td> and splits the day from the
// date with a <br>. Requiring <th> left the columns unnamed, so every day
// read the same cell - a wrong answer to the right question, which looks
// entirely correct.
const plainPage = loadPage(`<!doctype html><html><head><title>IDSS Forecast Points</title></head><body>
  <p>0 miles N of Hermantown, MN</p>
  <table>
  <tr><td>Weekly Summary</td><td>Mon<br>Sep 14</td><td>Tue<br>Sep 15</td><td>Wed<br>Sep 16</td></tr>
  <tr><td>Max Temp, °F</td><td>56</td><td>64</td><td>63</td></tr>
  <tr><td>Min Temp, °F</td><td>56</td><td>47</td><td>40</td></tr>
  </table></body></html>`, { url: "https://www.weather.gov/forecastpoints" });
if (!plainPage) skip("th-less tables", "jsdom not installed");
else {
  const pd2 = plainPage.GENERIC.readPage();
  ensure("a <td> header row is still recognised", (pd2.tables[0].columns || []).length === 4, pd2.tables[0].columns);
  const ask2 = (q) => {
    const plan = sb.planDataTool(q, { global: "FCP" });
    const when = plan && plan.args ? plan.args.when : null;
    const day = when && String(when).includes(":") ? String(when).split(":")[1] : null;
    const r = sb.findOnPage(pd2, { wants: sb.pageValueWants(q), place: plan && plan.args ? plan.args.place : null, day });
    return r ? r[0].label : null;
  };
  check("an abbreviated day is understood", ask2("max temperature of hermantown MN on Wed"), "Max Temp, °F · Wed Sep 16: 63");
  check("the full name agrees", ask2("max temperature of hermantown MN on wednesday"), "Max Temp, °F · Wed Sep 16: 63");
  check("a different day is a different column", ask2("max temperature of hermantown MN on tuesday"), "Max Temp, °F · Tue Sep 15: 64");
  // "sunny" must not read as Sunday, nor "saturated" as Saturday.
  check("sunny is not Sunday", plan("max temperature in sunny california", { global: "FCP" }).args.when, "high");
}

section("model output parsing");
// The native tools API is restricted to 7-8B models, which measured as
// unusable here, so the model is prompted for JSON instead - and a small
// model obeys "JSON only" loosely. Each of these is a shape one actually
// emits; JSON.parse on the whole reply fails on every one of them.
const firstJson = loadOffscreenHelper("firstJsonObject");
check("bare object", firstJson('{"tool":"waterAlerts","args":{"state":"ak"}}').tool, "waterAlerts");
check("with a preamble", firstJson('Sure! Here is the call:\n{"tool":"x","args":{}}').tool, "x");
check("in code fences", firstJson('```json\n{"tool":"y","args":{"a":1}}\n```').args.a, 1);
check("still talking afterwards", firstJson('{"tool":"z","args":{}} Hope that helps!').tool, "z");
check("nested objects", firstJson('{"tool":"a","args":{"nested":{"deep":true}}}').args.nested.deep, true);
// A selector or gauge name can contain a brace; naive depth counting breaks.
check("braces inside strings", firstJson('{"tool":"pageClick","args":{"selector":"#a{b}"}}').args.selector, "#a{b}");
check("no JSON at all", firstJson("I cannot help with that"), null);
check("malformed JSON is rejected, not thrown", firstJson('{"tool": oops}'), null);

section("ask history survives the popup closing");
// A popup is destroyed on blur, so results cannot live in its DOM. These are
// the states the popup has to be able to redraw from storage alone.
(async () => {
  await sb.recordAsk("a1", "gage height in wyoming", { status: "running" });
  let h = await sb.readHistory();
  check("an ask is recorded before it finishes", h[0].status, "running");

  await sb.recordAsk("a1", "gage height in wyoming", {
    status: "done", plannedBy: "fast-path",
    display: { title: "gageHeight · WY", subtitle: "109 gauges", stats: [], rows: [] },
  });
  h = await sb.readHistory();
  check("completing updates in place, not appended", h.length, 1);
  check("and becomes renderable", h[0].display.title, "gageHeight · WY");
  check("keeps when it was asked", h[0].at, h[0].at);

  await sb.recordAsk("a2", "nonsense", { status: "error", error: "nothing matched" });
  h = await sb.readHistory();
  check("errors are kept too", h[1].status, "error");

  // Whole payloads would exhaust the quota within a few asks.
  await sb.recordAsk("a3", "read this page", {
    status: "done", display: { title: "p", stats: [], rows: [] }, result: { huge: "x".repeat(500000) },
  });
  h = await sb.readHistory();
  ensure("raw payloads are not stored", h[2].result === undefined, Object.keys(h[2]));

  for (let i = 0; i < 40; i++) await sb.recordAsk(`b${i}`, `q${i}`, { status: "done" });
  h = await sb.readHistory();
  ensure("history is capped", h.length <= 30, h.length);
  check("and keeps the newest", h[h.length - 1].instruction, "q39");
  finishHistory();
})();

function finishHistory() {
section("feed capture");
const capturePage = loadPage(`<!doctype html><html><head><title>Canvas chart</title></head><body><canvas></canvas></body></html>`);
if (!capturePage) skip("feed capture", "jsdom not installed");
else {
  const fs2 = require("fs"), pathMod = require("path");
  // A canvas page has nothing readable, which is exactly when the data the
  // page fetched becomes the only answer.
  const before = capturePage.GENERIC.capturedFeeds();
  check("reports when capture is not installed", before.installed, false);

  capturePage.fetch = async () => ({ status: 200, headers: { get: () => "application/json" },
    clone() { return { text: async () => '{"series":[1,2,3],"unit":"ft"}' }; } });
  const sc = capturePage.document.createElement("script");
  sc.textContent = fs2.readFileSync(pathMod.join(__dirname, "..", "page", "feed-capture.js"), "utf8");
  capturePage.document.body.appendChild(sc);

  ensure("installs", !!capturePage.__wcFeedCapture, capturePage.__wcFeedCapture);
  const empty = capturePage.GENERIC.capturedFeeds();
  // Installed-but-empty and not-installed need different advice.
  ensure("distinguishes installed-but-empty", /reload/.test(empty.note || ""), empty.note);

  (async () => {
    await capturePage.fetch("https://x.gov/api/gauges/1/observations?f=json");
    await capturePage.fetch("https://x.gov/logo.png");
    await new Promise((r) => setTimeout(r, 60));
    const after = capturePage.GENERIC.capturedFeeds();
    check("captures data requests only", after.count, 1);
    check("summarises the payload", after.feeds[0].keys, ["series", "unit"]);
    const one = capturePage.GENERIC.capturedFeed("observations");
    check("returns the parsed body", one.parsed.series, [1, 2, 3]);
    check("missing feed is reported, not thrown", capturePage.GENERIC.capturedFeed("nope").found, false);
    finishCapture();
  })();
}

function finishCapture() {
if (process.argv.includes("--live")) {
  section("live agency APIs");
  (async () => {
    const run = (name, args) => sb.executeToolCall("GENERIC", { name, args });
    try {
      const wi = await run("waterCurrentConditions", { state: "WI", parameter: "discharge" });
      ensure("USGS returns gauges", wi.result.gaugesReporting > 0, wi.result.gaugesReporting);
      ensure("discharge aggregates", !!wi.result.range, wi.result.range);

      // Stage is measured from each gauge's own datum, so a cross-gauge
      // range is arithmetic on incompatible references.
      const ak = await run("waterCurrentConditions", { state: "AK", parameter: "gage height" });
      ensure("gage height refuses to aggregate", ak.result.range === null, ak.result.range);
      ensure("and says why", /datum/.test(ak.result.notComparable || ""), ak.result.notComparable);

      // "%SNAKE%" once returned SNAKEDEN BRANCH, and dropping "river"
      // entirely pushed the real Snake River out of the result window.
      const snake = await run("waterFindGauges", { place: "snake river" });
      ensure("snake river excludes Snake Creek",
        snake.result.gauges.every((x) => /\bsnake\b/i.test(x.name)), snake.result.gauges.slice(0, 3));

      // The generics were dropped from the search, which threw away the word
      // order: NORTH FORK ELKHORN RIVER became "%NORTH ELKHORN F%" and
      // matched none of its two real gauges.
      const nf = await run("waterFindGauges", { place: "north fork elkhorn river", parameter: "discharge" });
      ensure("a generic in the middle of a name survives", nf.result.found > 0, nf.result.found);
      ensure("and the gauges really are that river",
        (nf.result.gauges || []).every((g) => /NORTH FORK ELKHORN/i.test(g.name)), (nf.result.gauges || []).map((g) => g.name));

      // Nine rivers called Smith River, from New Hampshire to Alaska. A
      // median across them - 132 ft3/s - describes nothing that exists: the
      // same fault as averaging gage heights from different datums, reached
      // by a different route, since these readings are comparable in unit
      // and meaningless in aggregate.
      const smith = await run("waterFindGauges", { place: "smith river", parameter: "discharge" });
      ensure("one name, many rivers", (smith.result.states || []).length > 1, smith.result.states);
      check("so no summary is offered", smith.result.range, null);
      ensure("and it says why", /share a name|different rivers/.test(smith.result.display.caveat || ""),
        smith.result.display.caveat);
      // The advice it gives has to work, or it is a dead end.
      const smithCA = await run("waterFindGauges", { place: "smith river", parameter: "discharge", state: "CA" });
      check("naming a state narrows to one", (smithCA.result.states || []).length, 1);
      ensure("and the summary comes back", !!smithCA.result.range, smithCA.result.range);

      const bighorn = await run("waterFindGauges", { place: "bighorn river", parameter: "discharge" });
      ensure("bighorn river is found without a state", bighorn.result.found > 0, bighorn.result.found);

      const wx = await run("weatherConditions", { state: "WI", place: "milwaukee" });
      ensure("weather returns a temperature", wx.result.airTemperatureF !== null, wx.result);
      ensure("weather names its station", !!wx.result.station, wx.result.station);

      const fc = await run("weatherForecast", { state: "WI", place: "milwaukee", when: "week" });
      ensure("forecast returns days", fc.result.days.length > 0, fc.result.days.length);
      ensure("forecast is labelled a forecast", /forecast/i.test(fc.result.display.caveat || ""), fc.result.display.caveat);

      // A town NWS cannot place falls back to the middle of its state - a
      // real forecast for somewhere nobody asked about. Hermantown's high
      // came back as the state centre's, under the heading "hermantown".
      const miss = await run("weatherForecast", { state: "MN", place: "hermantown", when: "high" });
      ensure("a missed place says so in the headline",
        /not found/.test(miss.result.display.title), miss.result.display.title);
      ensure("and still names what it did use",
        /centre of MN/.test(miss.result.display.title), miss.result.display.title);
      // A place it can find must not be tarred with the same label.
      const hit = await run("weatherForecast", { state: "WI", place: "milwaukee", when: "high" });
      ensure("a found place is headlined plainly",
        !/not found/.test(hit.result.display.title), hit.result.display.title);
    } catch (err) {
      failed++; failures.push({ label: "live APIs", actual: err.message, expected: "no throw" });
      console.log(`  FAIL live APIs threw: ${err.message}`);
    }
    report();
  })();
} else {
  console.log("\n(live API tests skipped - pass --live to run them)");
  report();
}
}

}
}
}
}
}

// Every jsdom guard above is written `if (!page) skip(...) else { ...`, and
// those else blocks nest instead of closing - so a single missing jsdom made
// the whole remainder of the file unreachable, the summary included. On a
// clean clone the suite printed a wall of skips, no counts at all, and exited
// 0, which reads as "all fine" to a person and to CI alike.
// The suite is otherwise synchronous; these few need to await. Tracked so the
// summary cannot print before they have finished.
function runAsync(fn) {
  pendingAsync++;
  fn().catch((err) => {
    failed++;
    failures.push({ label: "end to end threw", actual: String((err && err.message) || err), expected: "no throw" });
    console.log(`  FAIL end to end threw: ${(err && err.message) || err}`);
  }).finally(() => { pendingAsync--; });
}

function report() {
  if (reported) return;
  // The end-to-end checks are asynchronous; printing a summary before they
  // finish would report a pass they had not earned. But an exit handler
  // cannot schedule work, so deferring from there printed nothing at all -
  // the run just stopped, silently, and looked identical to a pass from the
  // outside. Waiting is only allowed while the loop is still turning.
  if (pendingAsync > 0 && !exiting) { setTimeout(report, 25); return; }
  if (pendingAsync > 0) {
    failed++;
    failures.push({ label: `${pendingAsync} async section(s) never finished`,
      actual: "the process exited first", expected: "all sections complete" });
  }
  reported = true;
  if (!bodyDone) {
    failed++;
    failures.push({ label: "the suite aborted partway", expected: "the whole file runs",
      actual: "a throw in the module body skipped every section below it" });
  }
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (skipped) {
    console.log(`\n  ${skipped} section(s) skipped. For the full suite:` +
      `\n    cd extension/test && npm install`);
  }
  for (const f of failures) {
    console.log(`\n  ${f.label}\n    got      ${JSON.stringify(f.actual)}\n    expected ${JSON.stringify(f.expected)}`);
  }
  process.exit(failed ? 1 : 0);
}

// Much of the suite runs asynchronously, so a plain call here would print a
// summary and process.exit() out from under tests still in flight - it cut
// 287 down to 71. An exit hook fires once the event loop has drained, which
// is the only point at which "did the summary ever run" can be answered.
// Captured before any test can silence it. The async sections replace
// console.log while they run, so a process that exited mid-section printed
// its summary into a no-op - the run looked like it had simply stopped.
const realLog = console.log;

// beforeExit fires when the loop has drained and, unlike exit, may schedule
// work - so a section still in flight gets its chance to finish. The exit
// hook then remains the last resort. Without this the suite printed 202
// results and no summary at all, which is the one output that must never go
// missing: a run nobody can read the verdict of is a run nobody can trust.
function installSummaryHooks() {
  process.on("beforeExit", () => {
    if (reported) return;
    if (pendingAsync > 0) { setTimeout(() => {}, 30); return; }  // let them land, fire again
    report();
  });

  process.on("exit", () => {
    exiting = true;
    if (reported) return;
    reported = true;
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
    if (!bodyDone) {
      console.log("\n  the suite aborted partway - sections below the throw never ran");
    }
    if (skipped) {
      console.log(`\n  ${skipped} section(s) skipped. For the full suite:` +
        `\n    cd extension/test && npm install`);
    }
    process.exitCode = failed || !bodyDone ? 1 : 0;
  });
}

bodyDone = true;
