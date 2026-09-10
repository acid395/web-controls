/* verify-usgs.js. Self-test for web-controls.js on the USGS Idaho state page.
 * Paste web-controls.js FIRST, then paste this. It exercises each tool,
 * checks the DOM actually changed, restores state, and prints a PASS/FAIL table.
 */
(async () => {
  if (!window.USGS || !window.WC) { console.error("Paste web-controls.js first."); return; }
  const { deepQueryAll, wait } = WC;
  const results = [];
  const rec = (test, pass, detail = "") => {
    results.push({ test, result: pass ? "PASS" : "FAIL", detail });
    console.log(`${pass ? "✅" : "❌"} ${test}${detail ? "  (" + detail + ")" : ""}`);
  };
  const radioVal = (name) => {
    const r = deepQueryAll(`input[name="${name}"]`).find((x) => x.checked);
    return r ? r.value : null;
  };

  const before = USGS.getState();
  console.log("state before:", before);

  try {
    const p = USGS.listParameters();
    rec("listParameters() -> 5 rows", Array.isArray(p) && p.length === 5, `got ${p && p.length}`);
  } catch (e) { rec("listParameters()", false, e.message); }

  try {
    USGS.setParameter("gage height"); await wait(400);
    rec("setParameter('gage height') -> 00065", radioVal("map-quick-select-radios") === "00065", `now ${radioVal("map-quick-select-radios")}`);
    USGS.setParameter("discharge"); await wait(400);
    rec("setParameter('discharge') -> 00060", radioVal("map-quick-select-radios") === "00060");
  } catch (e) { rec("setParameter()", false, e.message); }

  try {
    USGS.groupBy("huc8"); await wait(400);
    rec("groupBy('huc8')", radioVal("locationGroupButtons") === "huc8", `now ${radioVal("locationGroupButtons")}`);
    USGS.groupBy("county"); await wait(400);
    rec("groupBy('county')", radioVal("locationGroupButtons") === "county");
  } catch (e) { rec("groupBy()", false, e.message); }

  try {
    USGS.sortBy("id descending"); await wait(400);
    rec("sortBy('id descending') -> id-descending", radioVal("location-sort-order") === "id-descending", `now ${radioVal("location-sort-order")}`);
    USGS.sortBy("name ascending"); await wait(300);
    rec("sortBy('name ascending') -> name-ascending", radioVal("location-sort-order") === "name-ascending");
  } catch (e) { rec("sortBy()", false, e.message); }

  try {
    const v0 = USGS.mapVisible();
    USGS.toggleMap(); await wait(500);
    rec("toggleMap() flips visibility", USGS.mapVisible() === !v0, `${v0} -> ${USGS.mapVisible()}`);
    USGS.setMap(v0); await wait(400);
    rec("setMap() restores", USGS.mapVisible() === v0);
  } catch (e) { rec("toggleMap()", false, e.message); }

  try {
    await USGS.setRecency("all"); await wait(400);
    rec("await setRecency('all') -> all", radioVal("filterByDate") === "all", `now ${radioVal("filterByDate")}`);
    await USGS.setRecency("120 days"); await wait(300);
    rec("await setRecency('120 days') -> P120D", radioVal("filterByDate") === "P120D");
  } catch (e) { rec("setRecency()", false, e.message); }

  try {
    await USGS.setDataTypeMatch("all"); await wait(300);
    rec("await setDataTypeMatch('all')", radioVal("matching-parameter-codes-radio-group") === "all");
    await USGS.setDataTypeMatch("any"); await wait(300);
    rec("await setDataTypeMatch('any') -> atLeastOne", radioVal("matching-parameter-codes-radio-group") === "atLeastOne");
  } catch (e) { rec("setDataTypeMatch()", false, e.message); }

  try {
    const dts = await USGS.listDataTypes();
    rec("await listDataTypes() non-empty", Array.isArray(dts) && dts.length > 0, `${dts && dts.length} types`);
    await USGS.toggleDataType("00300", true); await wait(300);
    const cb = deepQueryAll('input[name="show-data-type-checkbox"]').find((c) => c.value === "00300");
    rec("await toggleDataType('00300', true)", !!cb && cb.checked === true);
    await USGS.toggleDataType("00300", false); await wait(200);
    rec("await toggleDataType('00300', false)", !!cb && cb.checked === false);
  } catch (e) { rec("toggleDataType()", false, e.message); }

  try {
    const el = USGS.selectCounty("Ada"); await wait(200);
    rec("selectCounty('Ada') no-throw", !!el);
  } catch (e) { rec("selectCounty()", false, e.message); }

  console.log("state after:", USGS.getState());
  console.log("(not auto-tested, since they navigate or have side effects: selectState, openSite, favoriteSite)");
  console.table(results);
  const fails = results.filter((r) => r.result === "FAIL");
  console.log(
    `%c${fails.length ? fails.length + " FAILED" : "ALL " + results.length + " PASSED"}`,
    `font-weight:bold;font-size:14px;color:${fails.length ? "red" : "green"}`
  );
  window.__verify = results;
})();
