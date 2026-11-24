/* commands.js - plain English into the commands frame/agent.js carries out.
 *
 *   parse("select Alaska then click Apply")
 *   -> [{ action: "select", option: "Alaska", ... }, { action: "click", target: "Apply" }]
 *
 * Pattern matching, no model: instant, and it says what it understood.
 * Steps are split on "then" and ";". Anything no pattern claims becomes
 * { action: "auto" }, which the page answers with its best guess (an option
 * of that name, else a button or link of that name).
 */
(function () {
  const unquote = (s) => String(s || "").trim().replace(/^["'“‘](.*)["'”’]$/, "$1").trim();
  const strip = (s) => String(s || "")
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/^(?:please\s+|can you\s+|could you\s+|would you\s+|i want to\s+|i'd like to\s+|let's\s+)+/i, "")
    .replace(/\s+please$/i, "")
    .trim();
  const drop = (s, re) => unquote(String(s || "").replace(re, "").trim());

  const LOOKS_LIKE_URL = /^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]\S*)?$/i;

  const RULES = [
    [/^(?:go to|open|load|navigate to|visit|browse to)\s+(\S+)$/i, (m) => (LOOKS_LIKE_URL.test(m[1]) ? { action: "navigate", url: m[1] } : null)],
    [/^(?:go\s+)?back$/i, () => ({ action: "back" })],
    [/^(?:go\s+)?forward$/i, () => ({ action: "forward" })],
    [/^(?:reload|refresh)(?:\s+(?:the\s+)?page)?$/i, () => ({ action: "reload" })],
    [/^(?:help|\?|what can you do|commands)$/i, () => ({ action: "help" })],
    [/^(?:(?:list|show)(?:\s+me)?(?:\s+all)?(?:\s+the)?\s+(?:controls|options|buttons|links|fields|inputs|filters|dropdowns)(?:\s+on\s+(?:this|the)\s+page)?|what can i do(?:\s+here)?|controls|inventory)$/i,
      () => ({ action: "inventory" })],
    [/^(?:read|summari[sz]e|describe)(?:\s+(?:this|the))?(?:\s+page)?$|^what(?:'s| is)\s+on\s+(?:this|the)\s+page$/i, () => ({ action: "read" })],
    [/^scroll(?:\s+(up|down))?$/i, (m) => ({ action: "scroll", to: (m[1] || "down").toLowerCase() })],
    [/^scroll\s+to\s+(?:the\s+)?(top|bottom)$/i, (m) => ({ action: "scroll", to: m[1].toLowerCase() })],
    [/^scroll\s+(?:down\s+)?to\s+(?:the\s+)?(.+)$/i, (m) => ({ action: "find", text: unquote(m[1]) })],
    [/^(?:go\s+to\s+the\s+)?(top|bottom)(?:\s+of\s+(?:the\s+)?page)?$/i, (m) => ({ action: "scroll", to: m[1].toLowerCase() })],
    [/^search(?:\s+for)?\s+(.+?)(?:\s+in\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|bar))?)?$/i,
      (m) => ({ action: "type", text: unquote(m[1]), field: m[2] ? unquote(m[2]) : "search", submit: true })],
    [/^(?:type|enter|fill\s+in|fill|write|put|input)\s+(.+?)\s+(?:in|into|on)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|input|textbox|bar))?(?:\s+and\s+(submit|search|press enter|go))?$/i,
      (m) => ({ action: "type", text: unquote(m[1]), field: unquote(m[2]), submit: !!m[3] })],
    [/^(?:type|enter|write|input)\s+(.+?)(?:\s+and\s+(submit|search|press enter|go))?$/i,
      (m) => ({ action: "type", text: unquote(m[1]), submit: !!m[2] })],
    [/^(?:set|change)\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i, (m) => ({ action: "set", control: drop(m[1], /\s+(?:dropdown|menu|field|filter|option|select)$/i), value: unquote(m[2]) })],
    [/^(check|tick|enable|turn on|switch on|show|uncheck|untick|disable|turn off|switch off|hide|toggle)\s+(?:the\s+)?(.+?)\s+(checkbox|check box|box|switch|toggle|layer)$/i,
      (m) => ({ action: "check", label: unquote(m[2]), on: onOff(m[1]) })],
    [/^(check|tick|enable|turn on|switch on|uncheck|untick|disable|turn off|switch off|toggle)\s+(?:the\s+)?(.+)$/i,
      (m) => ({ action: "check", label: unquote(m[2]), on: onOff(m[1]) })],
    [/^(?:select|choose|pick|switch to|change to|use|filter by|filter to)\s+(?:the\s+)?(.+)$/i, (m) => selectStep(m[1])],
    [/^(?:find|locate|where is|where's|show me where)\s+(?:the\s+)?(.+)$/i, (m) => ({ action: "find", text: unquote(m[1]) })],
    [/^(?:click|press|tap|hit|open|expand|close|collapse|go to|show|view)\s+(?:on\s+)?(?:the\s+)?(.+)$/i,
      (m) => ({ action: "click", target: drop(m[1], /\s+(?:button|link|tab|menu|item|icon|page|section)$/i) })],
  ];

  function onOff(verb) {
    const v = verb.toLowerCase();
    if (v === "toggle") return null;
    return !/^(uncheck|untick|disable|turn off|switch off|hide)$/.test(v);
  }

  // "Alaska", "Alaska in the state dropdown", "Alaska from State".
  function selectStep(rest) {
    const whole = unquote(drop(rest, /\s+(?:option|item)$/i));
    // A quoted option is taken whole: select "Gage height in feet" in Parameter.
    const quoted = rest.match(/^["“]([^"”]+)["”](?:\s+(?:in|from|on|under|for)\s+(?:the\s+)?(.+))?$/i);
    if (quoted) {
      const control = quoted[2] ? unquote(drop(quoted[2], /\s+(?:dropdown|drop-down|menu|list|select|selector|filter|field|box|picker)$/i)) : undefined;
      return { action: "select", option: quoted[1].trim(), control, whole: quoted[1].trim() };
    }
    const m = rest.match(/^(.+?)\s+(?:in|from|on|under|for)\s+(?:the\s+)?(.+?)$/i);
    if (!m) return { action: "select", option: whole, whole };
    return {
      action: "select",
      option: unquote(drop(m[1], /\s+(?:option|item)$/i)),
      control: unquote(drop(m[2], /\s+(?:dropdown|drop-down|menu|list|select|selector|filter|field|box|picker)$/i)),
      whole,
    };
  }

  function parseStep(text) {
    const s = strip(text);
    if (!s) return null;
    for (const [re, build] of RULES) {
      const m = s.match(re);
      if (!m) continue;
      const out = build(m);
      if (out) return out;
    }
    return { action: "auto", text: unquote(s) };
  }

  function parse(text) {
    return String(text || "")
      .split(/\s*(?:;|,?\s+and\s+then\s+|,?\s+then\s+)\s*/i)
      .map(parseStep)
      .filter(Boolean);
  }

  // What the person will see the command was read as.
  function describe(c) {
    switch (c.action) {
      case "navigate": return `open ${c.url}`;
      case "click": return `click "${c.target}"`;
      case "select": return c.control ? `select "${c.option}" in "${c.control}"` : `select "${c.option}"`;
      case "type": return `type "${c.text}"${c.field ? ` into "${c.field}"` : ""}${c.submit ? " and submit" : ""}`;
      case "set": return `set "${c.control}" to "${c.value}"`;
      case "check": return `${c.on == null ? "toggle" : c.on ? "check" : "uncheck"} "${c.label}"`;
      case "scroll": return `scroll ${c.to}`;
      case "find": return `find "${c.text}"`;
      case "auto": return `"${c.text}"`;
      default: return c.action;
    }
  }

  const HELP = [
    ["select Alaska", "picks an option in a dropdown, radio group or custom menu"],
    ["select Discharge in Parameter", "names the dropdown when there are several"],
    ["set State to Idaho", "a dropdown, text field or checkbox, by its label"],
    ["click Download", "buttons, links, tabs, menu items"],
    ["type 13206000 into site number", "fills a field"],
    ["search for Boise River", "fills the search box and submits"],
    ["check Show map / uncheck Show map", "checkboxes and switches"],
    ["scroll down · scroll to top · find Flood stage", "moves around the page"],
    ["read this page · list controls", "what's on the page, and what can be operated"],
    ["back · reload · open water.noaa.gov", "navigation"],
    ["select Alaska then click Apply", "several steps in a row"],
  ];

  const api = { parse, parseStep, describe, HELP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else self.WCCommands = api;
})();
