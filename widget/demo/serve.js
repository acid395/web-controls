/* serve.js - the demo, on localhost.
 *
 *   node widget/demo/serve.js        then open http://localhost:5180
 *
 * Localhost because WebGPU needs a secure context and localhost counts as
 * one. CORS is open so the bookmarklet can load the widget - and the
 * widget can load WebLLM - from here into another site's page.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 5180;
const ROOT = path.join(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/demo/index.html";
  if (!rel.startsWith("/demo/") && !rel.startsWith("/dist/")) rel = `/demo${rel}`;
  const file = path.normalize(path.join(ROOT, rel));
  // ROOT plus a separator: a bare prefix test let "/demo/../../widget-x/..."
  // through to any sibling directory whose name merely starts with "widget".
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      // Chrome asks a public page for permission to reach localhost; this is
      // the server's half of that agreement.
      "Access-Control-Allow-Private-Network": "true",
      "Cache-Control": "no-cache",
    };
    if (err) { res.writeHead(404, headers); res.end("not found"); return; }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
// This machine only. With CORS open to every origin, listening on all
// interfaces would serve these files to anything on the same network.
}).listen(PORT, "127.0.0.1", () => {
  console.log(`web-controls widget demo: http://localhost:${PORT}`);
  console.log(`try it on another site:   http://localhost:${PORT}/try-on-any-site.html`);
});
