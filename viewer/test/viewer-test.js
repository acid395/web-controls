/* viewer-test.js - the parts that need no browser.
 *
 *   node viewer/test/viewer-test.js
 */
const assert = require("assert");
const ProxyUrl = require("../public/proxy-url.js");
const { parse } = require("../public/commands.js");
const { pointAtProxy, injectAgent, blockedHost, unproxyQuery, unproxyBody } = require("../server.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`); }
}

// --- addresses --------------------------------------------------------------

const urls = ProxyUrl.create("localhost:5280");

test("https site maps to a subdomain, path kept", () => {
  assert.strictEqual(urls.toProxy("https://waterdata.usgs.gov/state/Idaho/?a=1#x"),
    "http://waterdata--usgs--gov.localhost:5280/state/Idaho/?a=1#x");
});
test("http and ports survive the round trip", () => {
  for (const real of ["http://example.com/a", "https://example.com:8443/b?c", "http://a-b.example.org:81/"]) {
    assert.strictEqual(urls.toReal(urls.toProxy(real)), real);
  }
});
test("proxied addresses are recognised, others are not", () => {
  assert.ok(urls.isProxy("http://www--weather--gov.localhost:5280/"));
  assert.ok(!urls.isProxy("http://localhost:5280/"));
  assert.ok(!urls.isProxy("https://www.weather.gov/"));
  assert.strictEqual(urls.realOrigin("http://www--weather--gov.localhost:5280/x"), "https://www.weather.gov");
});
test("hosts the encoding cannot carry are refused", () => {
  assert.strictEqual(urls.toProxy("https://xn--bcher-kva.example/"), null);
  assert.strictEqual(urls.toProxy("ftp://example.com/"), null);
});
test("an already-proxied address is left alone", () => {
  const p = "http://water--noaa--gov.localhost:5280/gauges";
  assert.strictEqual(urls.toProxy(p), p);
});

// --- the proxy's rewriting --------------------------------------------------

test("absolute links to the site point at its proxy", () => {
  const html = `<a href="https://water.noaa.gov/x">a</a><img src="//water.noaa.gov/i.png"><a href="https://other.gov/">b</a>`;
  const out = pointAtProxy(html, "https://water.noaa.gov", "http://water--noaa--gov.localhost:5280");
  assert.ok(out.includes(`href="http://water--noaa--gov.localhost:5280/x"`));
  assert.ok(out.includes(`src="http://water--noaa--gov.localhost:5280/i.png"`));
  assert.ok(out.includes(`href="https://other.gov/"`));
});
test("a longer host is not mistaken for the site", () => {
  const out = pointAtProxy(`https://water.noaa.gov.evil.com/`, "https://water.noaa.gov", "http://p");
  assert.strictEqual(out, `https://water.noaa.gov.evil.com/`);
});
test("the agent goes first in <head>, and a meta CSP goes", () => {
  const out = injectAgent(`<!doctype html><html><head lang="en"><meta http-equiv="Content-Security-Policy" content="x"><script>1</script></head></html>`);
  assert.ok(/<head lang="en"><script src="\/__wc\/agent.js"><\/script><script>1/.test(out), out);
  assert.ok(!/Content-Security-Policy/i.test(out));
});
test("a page with no <head> still gets the agent", () => {
  assert.ok(injectAgent("<p>hi</p>").startsWith(`<script src="/__wc/agent.js">`));
});
test("a proxied page address in a query string goes back to the real one", () => {
  const encoded = "/maps/api/js/AuthenticationService.Authenticate?1shttp%3A%2F%2Fwaterdata--usgs--gov.localhost%3A5280%2Fstate%2FIdaho%2F&4sKEY";
  assert.strictEqual(unproxyQuery(encoded),
    "/maps/api/js/AuthenticationService.Authenticate?1shttps%3A%2F%2Fwaterdata.usgs.gov%2Fstate%2FIdaho%2F&4sKEY");
  assert.strictEqual(unproxyQuery("/x?u=http://www--weather--gov.localhost:5280/a"), "/x?u=https://www.weather.gov/a");
  assert.strictEqual(unproxyQuery("/http://a--b.localhost:5280/no-query"), "/http://a--b.localhost:5280/no-query");
});
test("a proxied page address in a JSON body goes back to the real one", () => {
  // What Maps JS v67 posts to MapsJsInternalService/GetViewportInfo.
  const body = Buffer.from(`[[[17.2,-149.4],[61.7,-47.4]],5,null,"en-US",0,"m@805000000",0,0,null,null,null,1,"http://hydroinformatics--tulane--edu.localhost:5280/lab/fims/",1]`);
  assert.ok(String(unproxyBody(body, "application/json+protobuf")).includes(`"https://hydroinformatics.tulane.edu/lab/fims/"`));
  // Binary bodies are left alone: their lengths are part of the encoding.
  assert.strictEqual(unproxyBody(body, "application/x-protobuf"), body);
});
test("local and private addresses are blocked", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.20.0.1", "169.254.169.254", "printer.local"]) {
    assert.ok(blockedHost(h), h);
  }
  for (const h of ["waterdata.usgs.gov", "8.8.8.8", "172.32.0.1"]) assert.ok(!blockedHost(h), h);
});

// --- commands -----------------------------------------------------------------

const one = (text) => { const steps = parse(text); assert.strictEqual(steps.length, 1, JSON.stringify(steps)); return steps[0]; };
const has = (text, expected) => test(`"${text}"`, () => {
  const got = one(text);
  for (const [k, v] of Object.entries(expected)) assert.deepStrictEqual(got[k], v, `${k} in ${JSON.stringify(got)}`);
});

has("select Alaska", { action: "select", option: "Alaska", control: undefined });
has("Please select Alaska.", { action: "select", option: "Alaska" });
has("choose Discharge from the parameter dropdown", { action: "select", option: "Discharge", control: "parameter" });
has("select Gage height in Parameter", { action: "select", option: "Gage height", control: "Parameter", whole: "Gage height in Parameter" });
has(`select "Gage height in feet" in Parameter`, { action: "select", option: "Gage height in feet", control: "Parameter" });
has("set State to Idaho", { action: "set", control: "State", value: "Idaho" });
has("change the time range dropdown to 30 days", { action: "set", control: "time range", value: "30 days" });
has("click the Download button", { action: "click", target: "Download" });
has("open the resources menu", { action: "click", target: "resources" });
has("go to the fire weather page", { action: "click", target: "fire weather" });
has("open water.noaa.gov", { action: "navigate", url: "water.noaa.gov" });
has("go to https://www.drought.gov/", { action: "navigate", url: "https://www.drought.gov/" });
has("type 13206000 into the site number field", { action: "type", text: "13206000", field: "site number", submit: false });
has(`enter "Boise River" in search and submit`, { action: "type", text: "Boise River", field: "search", submit: true });
has("search for Boise River", { action: "type", text: "Boise River", field: "search", submit: true });
has("check Show map", { action: "check", label: "Show map", on: true });
has("turn off the streams layer", { action: "check", label: "streams", on: false });
has("toggle legend", { action: "check", label: "legend", on: null });
has("scroll down", { action: "scroll", to: "down" });
has("scroll to the bottom", { action: "scroll", to: "bottom" });
has("scroll to flood categories", { action: "find", text: "flood categories" });
has("where is the flood stage", { action: "find", text: "flood stage" });
has("list controls", { action: "inventory" });
has("what can I do here", { action: "inventory" });
has("read this page", { action: "read" });
has("go back", { action: "back" });
has("refresh the page", { action: "reload" });
has("help", { action: "help" });
has("Alaska", { action: "auto", text: "Alaska" });

test("steps split on then and ;", () => {
  const steps = parse("select Alaska then click Apply; scroll down");
  assert.deepStrictEqual(steps.map((s) => s.action), ["select", "click", "scroll"]);
});
test("'and' alone does not split an option name", () => {
  assert.strictEqual(parse("select Rivers and Streams").length, 1);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
