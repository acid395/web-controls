// Asks for the microphone once, for the extension's origin. Chrome remembers
// the answer, which is what lets the side panel listen from then on.
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  stream.getTracks().forEach((t) => t.stop());
  document.getElementById("state").textContent = "Allowed. Close this tab and hold the microphone button in the panel.";
}).catch((e) => {
  document.getElementById("state").textContent =
    `Not allowed (${e.name}). Click the microphone icon in the address bar, allow it, then reload this page.`;
});
