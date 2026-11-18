/* Hold to talk, shared by the side panel and the widget.
 *
 * Pressing the button starts listening and letting go stops it; what is
 * heard shows in the box as it is said, and on release it is sent the way
 * typed text is. Anything already typed is kept in front of it. A hearing
 * that ends on its own while the button is still held - a silence limit,
 * an error - is kept for the release rather than lost.
 *
 *   WC_HOLD_TO_TALK(button, { value, setValue, send, say, denied })
 *     value()      what the box holds now
 *     setValue(t)  show t in the box
 *     send(t)      send t as an ask
 *     say(t)       a short status, lowercase
 *     denied()     the microphone was refused; say how to allow it
 *
 * Returns false, and hides the button, where the browser cannot listen.
 */
globalThis.WC_HOLD_TO_TALK = function holdToTalk(button, { value, setValue, send, say, denied }) {
  const Rec = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!button) return false;
  if (!Rec) { button.hidden = true; return false; }
  let rec = null, held = false, heard = "", interim = "", prior = "", pending = "";
  const joined = () => [prior, heard, interim].join(" ").replace(/\s+/g, " ").trim();
  const start = (e) => {
    if (held) return;
    if (e && e.preventDefault) e.preventDefault();
    held = true; heard = ""; interim = ""; pending = "";
    prior = String(value() || "").trim();
    rec = new Rec();
    rec.lang = (globalThis.navigator && navigator.language) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) heard += " " + t; else interim += " " + t;
      }
      setValue(joined());
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") denied();
      else if (ev.error === "no-speech") say("didn't hear anything - hold the button while you speak");
      else if (ev.error !== "aborted") say(`the microphone failed: ${ev.error}`);
      heard = ""; interim = "";
    };
    rec.onend = () => {
      button.classList.remove("listening");
      // The last few words are often still interim when the button is let
      // go: they count.
      const spoke = (heard + interim).trim();
      const said = joined();
      heard = ""; interim = ""; rec = null;
      if (!spoke) { setValue(prior); held = false; return; }
      if (held) { pending = said; return; } // ended on its own; sent on release
      send(said);
    };
    try { rec.start(); button.classList.add("listening"); }
    catch (err) { held = false; rec = null; say(`the microphone failed: ${(err && err.message) || err}`); }
  };
  const stop = () => {
    if (!held) return;
    held = false;
    if (rec) { rec.stop(); return; }
    button.classList.remove("listening");
    if (pending) { const p = pending; pending = ""; send(p); }
  };
  button.addEventListener("pointerdown", (e) => {
    try { if (button.setPointerCapture && e.pointerId != null) button.setPointerCapture(e.pointerId); } catch (x) { /* not a pointer */ }
    start(e);
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  // Keyboard too: hold space or enter on the focused button.
  button.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  button.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") stop(); });
  globalThis.addEventListener("blur", stop);
  return true;
};
