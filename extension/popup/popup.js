function log(s) {
  const pre = document.getElementById("log");
  pre.textContent += s + "\n\n";
  pre.scrollTop = pre.scrollHeight;
}

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

  log(`-> USGS.${fn}(${JSON.stringify(args)})`);
  chrome.runtime.sendMessage({ type: "invoke", fn, args }, (res) => {
    if (chrome.runtime.lastError) {
      log("runtime error: " + chrome.runtime.lastError.message);
      return;
    }
    log(JSON.stringify(res, null, 2));
  });
});
