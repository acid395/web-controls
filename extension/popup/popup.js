function log(s) {
  const pre = document.getElementById("log");
  pre.textContent += s + "\n\n";
  pre.scrollTop = pre.scrollHeight;
}

// chrome.permissions.request() only counts as triggered by a real click if
// there's no await before it in the same handler - an await, even a fast
// one, can cross a task boundary Chrome uses to decide "was this a genuine
// user gesture." So the tab's URL is looked up once when the popup opens
// (there's nothing else competing for the gesture at that point), cached,
// and the click handler below calls chrome.permissions.request as its
// first and only step, synchronously, using that cached value.
let currentOriginPattern = null;
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url) return;
  try {
    const u = new URL(tab.url);
    currentOriginPattern = `${u.protocol}//${u.hostname}/*`;
  } catch (e) { /* not a http(s) page, e.g. chrome:// - leave it null */ }
});

document.getElementById("enable").addEventListener("click", () => {
  const status = document.getElementById("enableStatus");
  if (!currentOriginPattern) {
    status.textContent = "couldn't read this tab's URL (not a normal http/https page?)";
    return;
  }
  chrome.permissions.request({ origins: [currentOriginPattern] }, (granted) => {
    status.textContent = granted
      ? `enabled on ${currentOriginPattern}. Try Call with function "inventory" now.`
      : `permission denied for ${currentOriginPattern}`;
  });
});

document.getElementById("call").addEventListener("click", () => {
  const fn = document.getElementById("fn").value.trim();
  const argsText = document.getElementById("args").value.trim() || "[]";
  let args;
  try {
    args = JSON.parse(argsText);
  } catch (e) {
    log("bad arguments JSON: " + e.message);
    return;
  }

  // Which manifest (USGS vs GENERIC) actually runs is decided by
  // background.js's ROUTES, based on the active tab's URL, not known here.
  // The response's calledOn field says which one it was.
  log(`-> ${fn}(${JSON.stringify(args)})`);
  chrome.runtime.sendMessage({ type: "invoke", fn, args }, (res) => {
    if (chrome.runtime.lastError) {
      log("runtime error: " + chrome.runtime.lastError.message);
      return;
    }
    log(JSON.stringify(res, null, 2));
  });
});

document.getElementById("ask").addEventListener("click", () => {
  const instruction = document.getElementById("instruction").value.trim();
  if (!instruction) return;

  log(`ask: "${instruction}"`);
  chrome.runtime.sendMessage({ type: "ask", instruction }, (res) => {
    if (chrome.runtime.lastError) {
      log("runtime error: " + chrome.runtime.lastError.message);
      return;
    }
    log(JSON.stringify(res, null, 2));
  });
});
