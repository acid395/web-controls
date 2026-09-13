function log(s) {
  const pre = document.getElementById("log");
  pre.textContent += s + "\n\n";
  pre.scrollTop = pre.scrollHeight;
}

// chrome.permissions.request() must run inside the click handler itself to
// count as triggered by a user gesture - relaying it through background.js
// via chrome.runtime.sendMessage risks Chrome not recognizing the gesture,
// since the message-passing boundary can strip that context. So this one
// talks to chrome.permissions directly, not through invokeOnActiveTab.
document.getElementById("enable").addEventListener("click", async () => {
  const status = document.getElementById("enableStatus");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) { status.textContent = "no active tab"; return; }
  let pattern;
  try {
    const u = new URL(tab.url);
    pattern = `${u.protocol}//${u.hostname}/*`;
  } catch (e) {
    status.textContent = "couldn't read this tab's URL";
    return;
  }
  chrome.permissions.request({ origins: [pattern] }, (granted) => {
    status.textContent = granted
      ? `enabled on ${pattern}. Try Call with function "inventory" now.`
      : `permission denied for ${pattern}`;
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
