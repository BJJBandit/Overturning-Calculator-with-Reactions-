/*
 * UI wiring for the tank overturning calculator. Depends on wind/data.js, wind/calc.js
 * and overturning.js. Everything recalculates live on any input change.
 */

function $(id) {
  return document.getElementById(id);
}

function fmt(x, dp = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return "–";
  if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
  return x.toFixed(dp).replace("-", "−");
}

function num(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// Populate dropdowns
// ---------------------------------------------------------------------------

function populateRegions() {
  const sel = $("region");
  Object.keys(REGIONS).forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${key} – ${REGIONS[key].label}`;
    sel.appendChild(opt);
  });
}

function populateLocations() {
  const sel = $("siteLocation");
  LOCATIONS.forEach((loc) => {
    const opt = document.createElement("option");
    opt.value = loc.name;
    opt.textContent = loc.name + (loc.confidence === "high" ? "" : " *");
    sel.appendChild(opt);
  });
  sel.addEventListener("change", applyLocation);
  $("region").addEventListener("change", () => {
    // a manual region change breaks the link to the picked location
    const loc = LOCATIONS.find((l) => l.name === sel.value);
    if (loc && loc.region !== $("region").value) {
      sel.value = "";
      $("locationNote").innerHTML = "";
    }
  });
}

function applyLocation() {
  const loc = LOCATIONS.find((l) => l.name === $("siteLocation").value);
  const note = $("locationNote");
  if (!loc) {
    note.innerHTML = "";
    return;
  }
  $("region").value = loc.region;
  note.innerHTML = `<p class="note">Region ${loc.region} auto-filled (${loc.confidence} confidence). ${loc.note}</p>`;
}

function populateAri() {
  const sel = $("ari");
  VR_STANDARD_R.forEach((R) => {
    const opt = document.createElement("option");
    opt.value = R;
    opt.textContent = `R = ${R} years`;
    sel.appendChild(opt);
  });
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom R (≥5 years)";
  sel.appendChild(custom);
  sel.value = "50";
}

function refreshVisibility() {
  $("ariCustomWrap").hidden = $("ari").value !== "custom";
  const mode = $("mtMode").value;
  $("mtManualWrap").hidden = mode !== "manual";
  $("mhInputs").hidden = mode !== "hill";
  const regionIsA4orNZ = ["A4", "NZ1", "NZ2", "NZ3", "NZ4"].includes($("region").value);
  $("mhElevWrap").hidden = !(mode === "hill" && regionIsA4orNZ);
}

// ---------------------------------------------------------------------------
// Read form
// ---------------------------------------------------------------------------

function readAriYears() {
  if ($("ari").value === "custom") return Math.max(5, num("ariCustom", 5));
  return parseFloat($("ari").value);
}

// Same logic as the Wind Actions calculator's topography panel.
function computeMtFromForm(regionKey, z) {
  const mode = $("mtMode").value;
  if (mode === "flat") return { value: 1.0, formula: "Mt = 1.0 (no local topographic feature)" };
  if (mode === "manual") return { value: num("mtManual", 1.0), formula: "Manual entry" };

  const mh = computeMh({ H: num("mhH", 0), Lu: num("mhLu", 1) || 1, x: num("mhX", 0), z, downwindType: $("mhType").value });
  const regionIsA4orNZ = ["A4", "NZ1", "NZ2", "NZ3", "NZ4"].includes(regionKey);
  const elevation = num("mhElev", 0);
  let mtMode = "default";
  if (regionKey === "A0") mtMode = "A0";
  else if (regionIsA4orNZ && elevation > 500) mtMode = "A4_high";
  const mt = computeMt({ regionKey, Mh: mh.Mh, Mlee: 1.0, elevationE: elevation, mode: mtMode });
  return { ...mt, mh };
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

// rows: [label, value, unit, basis, rowClass]
function table(headers, rows) {
  const head = headers.map((h, i) => `<th${i === 1 ? ' class="num"' : ""}>${h}</th>`).join("");
  const body = rows
    .map(([label, value, unit, basis, cls]) =>
      `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td><td class="num">${value}</td><td>${unit}</td><td class="basis">${basis}</td></tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function stat(label, value, unit) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value} <span class="stat-unit">${unit}</span></div></div>`;
}

// A straight arrow with a solid head at (x2, y2).
function arrow(x1, y1, x2, y2, cls) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 10;
  const spread = 0.42;
  const bx = x2 - head * 0.8 * Math.cos(ang);
  const by = y2 - head * 0.8 * Math.sin(ang);
  const p1 = `${x2 - head * Math.cos(ang - spread)},${y2 - head * Math.sin(ang - spread)}`;
  const p2 = `${x2 - head * Math.cos(ang + spread)},${y2 - head * Math.sin(ang + spread)}`;
  return `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" class="d-arrow ${cls}" /><polygon points="${x2},${y2} ${p1} ${p2}" class="${cls}" />`;
}

function label(x, y, text, cls, anchor = "middle", sub = false) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${sub ? "d-sub" : "d-label"} ${cls}">${text}</text>`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderWind(wind, mt, z) {
  const { site } = wind;
  const rows = [
    ["Regional wind speed, V<sub>R</sub>", fmt(site.vr.value, 1), "m/s", site.vr.source],
    ["Climate change multiplier, M<sub>c</sub>", fmt(site.mc, 2), "–", "Table 3.3"],
    ["Wind direction multiplier, M<sub>d</sub>", fmt(wind.Md, 2), "–", $("mdMode").value === "table" ? "Table 3.2, governing direction" : "Circular tank, Cl 3.3"],
    ["Terrain/height multiplier, M<sub>z,cat</sub>", fmt(site.mzcat.value, 3), "–", site.mzcat.note || `Table 4.1 at z = ${fmt(z, 2)} m`],
    ["Shielding multiplier, M<sub>s</sub>", fmt(site.ms.value, 3), "–", site.ms.note || "Table 4.2"],
    ["Topographic multiplier, M<sub>t</sub>", fmt(mt.value, 3), "–", mt.formula],
    ["Site wind speed, V<sub>sit,β</sub>", fmt(wind.Vsit, 2), "m/s", "Eq. 2.2: V<sub>R</sub> M<sub>c</sub> M<sub>d</sub> (M<sub>z,cat</sub> M<sub>s</sub> M<sub>t</sub>)"],
    ["Design wind speed, V<sub>des</sub>", fmt(wind.Vdes, 2), "m/s", wind.Vdes > wind.Vsit ? "Cl 2.3: 30 m/s minimum governs" : "Cl 2.3 (= V<sub>sit,β</sub>)", "total"],
    ["Design wind pressure, q<sub>z</sub>", fmt(wind.qz, 4), "kPa", "Eq. 2.4(1): 0.5 ρ<sub>air</sub> V<sub>des</sub>² (ρ<sub>air</sub> = 1.2 kg/m³)", "total"],
  ];
  let warnings = "";
  if (site.vr.warning) warnings += `<div class="warning">${site.vr.source}</div>`;
  if (mt.mh && mt.mh.warning) warnings += `<div class="warning">${mt.mh.warning}</div>`;
  if (wind.belowUlsMin && !$("ulsMin").checked) {
    warnings += `<div class="warning">V<sub>sit,β</sub> is below 30 m/s. Clause 2.3 sets a 30 m/s minimum design wind speed for ultimate limit states &mdash; tick the box above to apply it.</div>`;
  }
  $("windResults").innerHTML = table(["Parameter", "Value", "Unit", "Basis"], rows) + warnings;
}

function renderActions(o, roof, roofCase) {
  const roofBasis = {
    sealed: "Table A.4(A) Zone A, sealed",
    dominant: "Table A.4(A) Zone A; Cl 5.3 dominant opening",
    vented: "Table A.4(A) Zone A; Eq. A.5(5)",
    none: "no roof uplift taken",
  }[roofCase];
  const rows = [
    ["Projected area, A<sub>z</sub> = b·c", fmt(o.Az, 2), "m²", "elevation area"],
    ["Wall drag force, F<sub>w</sub> = C<sub>shp</sub>·q<sub>z</sub>·A<sub>z</sub>", fmt(o.Fw, 2), "kN", "Eq. 2.1; acts at c/2", "total"],
    ["Drag lever arm, c/2", fmt(o.dragLever, 2), "m", "above base"],
    ["Roof net C<sub>p</sub> = C<sub>p,e</sub> − C<sub>p,i</sub>", fmt(roof.net, 3), "–", `${fmt(roof.cpe, 2)} − (${fmt(roof.cpi, 3)}); ${roofBasis}`],
    ["Roof net pressure", fmt(o.pRoof, 3), "kPa", "negative = outward (uplift)"],
    ["Plan area, A<sub>p</sub> = π·b²/4", fmt(o.Ap, 2), "m²", "circular plan"],
    ["Roof uplift force, U", fmt(o.U, 2), "kN", "|p<sub>roof</sub>|·A<sub>p</sub>, acts through the centroid", "total"],
  ];
  let extra = "";
  if (o.pRoof > 0) {
    extra = `<p class="note">The net roof pressure is inward (downward) for this case, so no uplift is taken and it is not counted as restoring.</p>`;
  }
  $("actionResults").innerHTML = table(["Item", "Value", "Unit", "Basis"], rows) + extra;
}

function renderMoments(o, fos) {
  const status = `<span class="status ${o.ok ? "ok" : "fail"}">${o.ok ? "OK" : "FAIL"}</span>`;
  const headline = `<div class="headline">
    ${stat("Overturning moment, M<sub>OT</sub>", fmt(o.Mot, 2), "kN·m")}
    ${stat("Restoring moment, M<sub>R</sub>", fmt(o.Mr, 2), "kN·m")}
    ${stat(`Stability ratio (target ${fmt(fos, 2)})`, fmt(o.ratio, 2), status)}
    ${stat("Base shear", fmt(o.shear, 2), "kN")}
  </div>`;
  const rows = [
    ["Wind drag, M<sub>w</sub> = F<sub>w</sub>·(c/2)", fmt(o.Mw, 2), "kN·m", "horizontal drag about the pivot"],
    ["Roof uplift, M<sub>u</sub> = U·(b/2)", fmt(o.Mu, 2), "kN·m", "uplift acts at the centre"],
    ["Total overturning, M<sub>OT</sub> = M<sub>w</sub> + M<sub>u</sub>", fmt(o.Mot, 2), "kN·m", "destabilising", "total"],
    ["Restoring, M<sub>R</sub> = W·(b/2)", fmt(o.Mr, 2), "kN·m", "stabilising (weight at centre)", "total"],
    ["Stability ratio, M<sub>R</sub> / M<sub>OT</sub>", fmt(o.ratio, 2), "–", `${o.ok ? "≥" : "&lt;"} FoS<sub>req</sub> = ${fmt(fos, 2)}`, "total"],
    ["W required for FoS<sub>req</sub>", fmt(o.Wreq, 2), "kN", "FoS<sub>req</sub>·M<sub>OT</sub> / (b/2) — minimum self-weight without hold-down"],
    ["Base shear = F<sub>w</sub>", fmt(o.shear, 2), "kN", "resisted by fixing / friction — check sliding separately"],
  ];
  $("momentResults").innerHTML = headline + table(["Component", "Value", "Unit", "Note"], rows);
}

function renderEdges(o) {
  const mLabel = o.Mreact === o.Mot ? "M<sub>OT</sub>" : "M<sub>w</sub>";
  const far = o.Rfar < 0 ? `<span class="val-uplift">${fmt(o.Rfar, 2)}</span>` : fmt(o.Rfar, 2);
  const rows = [
    ["Net vertical load, N = W − U", fmt(o.N, 2), "kN", "weight minus uplift"],
    [`Moment for reactions, M = ${mLabel}`, fmt(o.Mreact, 2), "kN·m", ""],
    ["Near-side (leeward) reaction, R<sub>near</sub>", fmt(o.Rnear, 2), "kN", "N/2 + M/b — max compression", "total"],
    ["Far-side (windward) reaction, R<sub>far</sub>", far, "kN", "N/2 − M/b — negative needs hold-down", "total"],
    ["Required hold-down at far edge", fmt(o.holdDown, 2), "kN", o.holdDown > 0 ? "tension the anchors must carry" : "none — far edge stays in compression"],
  ];
  $("edgeResults").innerHTML = table(["Reaction", "Value", "Unit", "Formula"], rows);
}

function renderFbd(o, b, c) {
  const ground = 300;
  const cx = 215;
  const scale = Math.min(150 / b, 185 / c);
  const w = b * scale;
  const h = c * scale;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = ground - h;
  const mid = ground - h / 2;

  let hatch = "";
  for (let x = 60; x <= 380; x += 20) hatch += `<line x1="${x}" y1="${ground}" x2="${x - 9}" y2="${ground + 9}" class="d-hatch" />`;

  let s = `<line x1="50" y1="${ground}" x2="385" y2="${ground}" class="d-ground" />${hatch}`;
  s += `<path d="M ${left} ${top} Q ${cx} ${top - 14} ${right} ${top} L ${right} ${ground} L ${left} ${ground} Z" class="d-outline" />`;

  // wind drag at c/2
  s += arrow(left - 95, mid, left - 6, mid, "c-drag");
  s += label(left - 100, mid - 24, "Wind →", "c-wind", "start");
  s += label(left - 100, mid - 9, `F_w = ${fmt(o.Fw, 2)} kN`, "c-drag", "start");
  s += label(left - 100, mid + 16, "at c/2", "c-drag", "start", true);

  // roof uplift
  if (o.U > 0) {
    s += arrow(cx, top - 16, cx, top - 62, "c-uplift");
    s += label(cx, top - 68, `U = ${fmt(o.U, 2)} kN`, "c-uplift");
  }

  // self-weight
  s += arrow(cx, mid - 28, cx, mid + 28, "c-weight");
  s += label(cx, mid - 34, `W = ${fmt(o.W, 2)} kN`, "c-weight");

  // dimensions
  s += `<line x1="${right + 26}" y1="${top}" x2="${right + 26}" y2="${ground}" class="d-dim" />`;
  s += `<line x1="${right + 21}" y1="${top}" x2="${right + 31}" y2="${top}" class="d-dim" /><line x1="${right + 21}" y1="${ground}" x2="${right + 31}" y2="${ground}" class="d-dim" />`;
  s += `<text x="${right + 32}" y="${mid + 4}" class="d-text">c = ${fmt(c, 2)} m</text>`;
  s += `<line x1="${left}" y1="${ground - 14}" x2="${right}" y2="${ground - 14}" class="d-dim" />`;
  s += `<text x="${cx}" y="${ground - 19}" text-anchor="middle" class="d-text">b = ${fmt(b, 2)} m</text>`;

  // reactions: ground pushes up in compression, anchor pulls down in uplift
  const react = (x, R, name, anchor) => {
    const cls = R < 0 ? "c-tension" : "c-comp";
    const a = R < 0 ? arrow(x, ground + 4, x, ground + 44, cls) : arrow(x, ground + 46, x, ground + 6, cls);
    return a + label(x, ground + 60, `${name} = ${fmt(R, 2)} kN`, cls, anchor) + label(x, ground + 74, R < 0 ? "uplift — hold-down" : "compression", cls, anchor, true);
  };
  s += react(left, o.Rfar, "R_far", "end");
  s += react(right, o.Rnear, "R_near", "start");
  s += `<circle cx="${right}" cy="${ground}" r="4" class="c-weight" />`;
  s += `<text x="${right + 8}" y="${ground - 4}" class="d-text">pivot</text>`;

  $("fbdSvg").innerHTML = s;
}

function renderPoints(o, fos) {
  const rows = o.pts
    .map((p) => {
      const up = p.R < 0;
      return `<tr><td>${p.i}</td><td class="num">${fmt(p.angle, 1)}</td><td class="num">${fmt(p.x, 3)}</td>
        <td class="num">${up ? `<span class="val-uplift">${fmt(p.R, 2)}</span>` : fmt(p.R, 2)}</td>
        <td class="num">${fmt(p.T, 2)}</td><td>${up ? '<span class="val-uplift">UPLIFT</span>' : "comp."}</td>
        <td class="num">${fmt(p.toNeutral, 3)}</td></tr>`;
    })
    .join("");
  $("pointResults").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Point</th><th class="num">θ (°)</th><th class="num">x<sub>i</sub> (m)</th><th class="num">R<sub>i</sub> (kN)</th>
      <th class="num">Hold-down T<sub>i</sub> (kN)</th><th>Sense</th><th class="num">x<sub>i</sub> − x<sub>0</sub> (m)</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;

  const summary = [
    ["Σ x<sub>i</sub>²", fmt(o.sumX2, 3), "m²", "all points"],
    ["Neutral-axis offset, x<sub>0</sub> = (N/n)·Σx² / M", fmt(o.x0, 3), "m", "from the geometric axis, + = toward windward"],
    ["Max compression reaction, R<sub>max</sub>", fmt(o.Rmax, 2), "kN", "largest downward point load", "total"],
    ["Min reaction, R<sub>min</sub>", fmt(o.Rmin, 2), "kN", "windward point 1 — drives hold-down", "total"],
    ["Hold-down per point, T<sub>max</sub> = FoS·|R<sub>min</sub>|", fmt(o.Tmax, 2), "kN", `governing anchor design tension (FoS = ${fmt(fos, 2)})`, "total"],
    ["Total hold-down, Σ T<sub>i</sub>", fmt(o.sumT, 2), "kN", "all uplift points"],
    ["Check Σ R<sub>i</sub>", fmt(o.sumR, 2), "kN", `equals N = ${fmt(o.N, 2)} kN`],
  ];
  $("pointSummary").innerHTML = table(["Result", "Value", "Unit", "Note"], summary);
}

function renderPlan(o) {
  const cx = 200;
  const cy = 170;
  const r = 105;
  const k = r / o.radius;
  let s = "";

  // neutral axis (x measured toward windward = left) and the uplift zone beyond it
  const nx = cx - o.x0 * k;
  const showNeutral = Number.isFinite(o.x0) && nx > 40 && nx < 360;
  if (showNeutral && o.Rmin < 0) s += `<rect x="40" y="35" width="${nx - 40}" height="270" class="d-uplift-zone" />`;

  s += `<circle cx="${cx}" cy="${cy}" r="${r}" class="d-ring" />`;
  s += `<line x1="${cx}" y1="${cy - r - 22}" x2="${cx}" y2="${cy + r + 22}" class="d-axis" />`;
  s += `<circle cx="${cx}" cy="${cy}" r="3" class="c-weight" />`;
  if (showNeutral) s += `<line x1="${nx}" y1="40" x2="${nx}" y2="300" class="d-neutral" />`;

  s += arrow(8, cy, 52, cy, "c-wind");
  s += label(8, cy - 10, "Wind", "c-wind", "start");

  o.pts.forEach((p) => {
    const t = (p.angle * Math.PI) / 180;
    const px = cx - r * Math.cos(t);
    const py = cy - r * Math.sin(t);
    const cls = p.R < 0 ? "c-tension" : "c-comp";
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" class="${cls}" />`;
    // labels sit outside the ring; point 1 drops below its dot to clear the wind arrow
    const anchor = Math.cos(t) > 0.3 ? "end" : Math.cos(t) < -0.3 ? "start" : "middle";
    const tx = cx - (r + 14) * Math.cos(t);
    const ly = p.i === 1 ? cy + 26 : cy - (r + 30) * Math.sin(t);
    s += label(tx.toFixed(1), (ly - 2).toFixed(1), p.i, cls, anchor);
    s += label(tx.toFixed(1), (ly + 11).toFixed(1), `${fmt(p.R, 1)} kN`, cls, anchor, true);
  });

  $("planSvg").innerHTML = s;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function calculate() {
  refreshVisibility();

  const b = Math.max(0.01, num("tankB", 0.01));
  const c = Math.max(0.01, num("tankC", 0.01));
  const W = Math.max(0, num("tankW", 0));
  const fos = Math.max(0, num("fos", 1.5));
  const n = Math.min(12, Math.max(3, Math.round(num("nPoints", 6))));

  const regionKey = $("region").value;
  const sRaw = $("shieldingS").value;
  const mt = computeMtFromForm(regionKey, c);
  const wind = computeTankWind({
    regionKey,
    R: readAriYears(),
    terrainCategory: parseFloat($("terrainCategory").value),
    z: c,
    s: sRaw === "" ? null : parseFloat(sRaw),
    Mt: mt.value,
    mdMode: $("mdMode").value,
    applyUlsMin: $("ulsMin").checked,
  });

  const roofCase = $("roofCase").value;
  const roof = roofNetCp(roofCase, b, c);
  const o = computeOverturning({
    b, c, W, fos, n,
    qz: wind.qz,
    Cshp: Math.max(0, num("cshp", TANK_CSHP_DRAG)),
    roofCp: roof.net,
    reactionBasis: $("reactionBasis").value,
  });
  o.W = W;

  renderWind(wind, mt, c);
  renderActions(o, roof, roofCase);
  renderMoments(o, fos);
  renderEdges(o);
  renderFbd(o, b, c);
  renderPoints(o, fos);
  renderPlan(o);
}

document.addEventListener("DOMContentLoaded", () => {
  populateRegions();
  populateLocations();
  populateAri();
  $("siteLocation").value = "Hobart, TAS";
  applyLocation();

  document.querySelector("main").addEventListener("input", calculate);
  document.querySelector("main").addEventListener("change", calculate);
  calculate();
});
