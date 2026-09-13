/* ============================================================================
 * webmcp-register.js - paste AFTER web-controls.js or generic-controls.js
 * (needs window.USGS or window.GENERIC already loaded).
 *
 * Everything else in this repo is the extension consuming a page. This file
 * is the other direction: it wraps the manifest already loaded and registers
 * it with the browser's own navigator.modelContext.registerTool() API, the
 * real WebMCP standard, so this page becomes usable by ANY WebMCP-aware
 * agent, not just this project's own extension. USGS.gov never has to write
 * a line of code for that to be true.
 *
 * This is genuinely new (W3C Draft Community Group Report, April 2026).
 * Edge 147 ships it natively; Chrome 149 has it in an Origin Trial only, so
 * navigator.modelContext may not exist at all in a stock, un-flagged Chrome
 * yet. This checks for it and says so plainly rather than failing silently.
 * ========================================================================== */
(() => {
  if (!(navigator.modelContext && typeof navigator.modelContext.registerTool === "function")) {
    console.log("%cnavigator.modelContext.registerTool is not available in this browser.", "color:#a00;font-weight:bold");
    console.log("Needs Edge 147+, or Chrome with the WebMCP Origin Trial enabled. Nothing registered.");
    return;
  }

  const registered = [];
  const register = (def) => {
    navigator.modelContext.registerTool(def);
    registered.push(def.name);
  };

  if (window.USGS) {
    // named manifest: precise tools, real parameter enums pulled straight
    // from SUPPLIED, the same domain knowledge USGS.setParameter() itself uses.
    const paramNames = [...new Set(Object.keys(USGS.SUPPLIED.PARAMS))];

    register({
      name: "usgsSetParameter",
      description: "Set which water parameter is shown on this USGS state map (discharge, gage height, water level, water temperature, or all).",
      inputSchema: {
        type: "object",
        properties: { parameter: { type: "string", description: "e.g. discharge, gage height, water temperature, water level, all", enum: paramNames } },
        required: ["parameter"],
      },
      async execute({ parameter }) { return { code: USGS.setParameter(parameter) }; },
    });

    register({
      name: "usgsGroupBy",
      description: "Group the map's stream sites by county, HUC-8 subbasin, or HUC-6 basin.",
      inputSchema: {
        type: "object",
        properties: { groupBy: { type: "string", enum: ["county", "huc8", "huc6"] } },
        required: ["groupBy"],
      },
      async execute({ groupBy }) { return { value: USGS.groupBy(groupBy) }; },
    });

    register({
      name: "usgsSetRecency",
      description: "Filter sites to only those with data in the last 120 days, or show all years of historical data.",
      inputSchema: {
        type: "object",
        properties: { recency: { type: "string", enum: ["120 days", "all"] } },
        required: ["recency"],
      },
      async execute({ recency }) { return { value: await USGS.setRecency(recency) }; },
    });

    register({
      name: "usgsGetState",
      description: "Read the current parameter, grouping, sort order, recency filter, and map visibility on this page.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() { return USGS.getState(); },
    });
  } else if (window.GENERIC) {
    // zero-manifest tier: generic tools, real page content described only
    // at call time (inventory), since there's no per-site domain knowledge
    // to bake into a description the way USGS's tools above have.
    register({
      name: "pageInventory",
      description: "List every interactive control on the current page (buttons, dropdowns, checkboxes, inputs) with a CSS selector for each, so they can be acted on directly.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() { return GENERIC.inventory(); },
    });

    register({
      name: "pageClick",
      description: "Click an element on the page by CSS selector, e.g. one returned by pageInventory.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string", description: "CSS selector of the element to click" } },
        required: ["selector"],
      },
      async execute({ selector }) { GENERIC.click(selector); return { clicked: selector }; },
    });

    register({
      name: "pageFill",
      description: "Type text into an input or textarea on the page by CSS selector.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the field" },
          text: { type: "string", description: "text to type into it" },
        },
        required: ["selector", "text"],
      },
      async execute({ selector, text }) { GENERIC.fill(selector, text); return { filled: selector, text }; },
    });

    register({
      name: "pageSelectOption",
      description: "Choose an option in a <select> dropdown on the page by CSS selector and the option's value or visible text.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the <select>" },
          value: { type: "string", description: "option value or visible text to choose" },
        },
        required: ["selector", "value"],
      },
      async execute({ selector, value }) { return { chosen: GENERIC.selectOption(selector, value) }; },
    });
  } else {
    console.log("Neither window.USGS nor window.GENERIC is loaded. Paste web-controls.js or generic-controls.js first.");
    return;
  }

  console.log(`%cRegistered ${registered.length} WebMCP tool(s): ${registered.join(", ")}`, "color:green;font-weight:bold");
})();
