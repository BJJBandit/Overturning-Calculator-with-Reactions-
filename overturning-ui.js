/*
 * UI wiring for the overturning & hold-down sections (4 and 5).
 * Runs after app.js: it reuses that file's helpers ($, fmt), its Section 2 / Section 3 calculations
 * (runSpeedCalc, renderPressureResults) and the per-axis design wind speeds they cache
 * (lastDesignResults). All engineering lives in overturning.js.
 */

// Wind's direction of travel in plan for the 4 orthogonal axes (X across W, Y along L, theta = 0
// wind arriving on the W face and travelling along +Y; drawn with that face at the top).
const OT_AXIS_TRAVEL = [[0, 1], [-1, 0], [0, -1], [1, 0]];

let otHasRun = false;

function otNum(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function otIsCircle() {
  return $("buildingType").value === "bins";
}

// ---------------------------------------------------------------------------
// Shape-dependent form state
// ---------------------------------------------------------------------------

const OT_LABELS = {};

function otSetLabel(inputId, html) {
  const label = document.querySelector(`label[for="${inputId}"]`);
  if (!(inputId in OT_LABELS)) OT_LABELS[inputId] = label.innerHTML;
  label.innerHTML = html || OT_LABELS[inputId];
}

function otRefreshShape() {
  const circle = otIsCircle();
  ["bldD", "roofType", "roofPitch", "buildingSize"].forEach((id) => {
    $(id).closest(".field").hidden = circle;
  });
  otSetLabel("bldB", circle ? "Tank diameter, D (m)" : "");
  otSetLabel("bldH", circle ? "Tank height, h = z (m)" : "");
  $("otRectInputs").hidden = circle;
  $("otCircleInputs").hidden = !circle;
  $("otCpiWrap").hidden = circle;
  $("otCshpWrap").hidden = !circle;
  $("otRoofCpWrap").hidden = !circle;
}

function otSetupBuildingTypes() {
  const sel = $("buildingType");
  const names = { enclosed: "Square / rectangular building (Section 5)", bins: "Circular bin, silo or tank (Appendix A)" };
  Array.from(sel.options).forEach((opt) => {
    if (names[opt.value]) opt.textContent = names[opt.value];
    else opt.remove();
  });
  sel.addEventListener("change", otRefreshShape);
  otRefreshShape();
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function otStat(label, value, unit, sub) {
  return `<div class="ot-stat"><div class="ot-stat-label">${label}</div>
    <div class="ot-stat-value">${value} <span class="ot-stat-unit">${unit}</span></div>
    ${sub ? `<div class="ot-stat-sub">${sub}</div>` : ""}</div>`;
}

function otArrow(x1, y1, x2, y2, cls) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = 10;
  const spread = 0.42;
  const bx = x2 - head * 0.8 * Math.cos(ang);
  const by = y2 - head * 0.8 * Math.sin(ang);
  const p1 = `${x2 - head * Math.cos(ang - spread)},${y2 - head * Math.sin(ang - spread)}`;
  const p2 = `${x2 - head * Math.cos(ang + spread)},${y2 - head * Math.sin(ang + spread)}`;
  return `<line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" class="ot-arrow ${cls}" /><polygon points="${x2},${y2} ${p1} ${p2}" class="${cls}" />`;
}

function otText(x, y, text, cls, anchor = "middle") {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${text}</text>`;
}

function otCaseName(lc) {
  return lc.caseLabel ? `${lc.axisLabel}, ${lc.caseLabel}` : lc.axisLabel;
}

// ---------------------------------------------------------------------------
// Load cases
// ---------------------------------------------------------------------------

function otBuildLoadCases() {
  const W = Math.max(0, otNum("otWeight", 0));
  const gammaG = Math.max(0, otNum("otGammaG", 0.9));
  const gammaW = Math.max(0, otNum("otGammaW", 1.0));
  const Cdyn = otNum("pCdyn", 1.0) || 1.0;
  const h = Math.max(0.1, otNum("bldH", 1));
  const bldB = Math.max(0.1, otNum("bldB", 1));
  const bldD = Math.max(0.1, otNum("bldD", 1));
  const axes = lastDesignResults;

  if (otIsCircle()) {
    const Vdes = Math.max(...axes.map((a) => a.Vdes));
    const actions = otTankActions({ Vdes, Cdyn, D: bldB, h, Cshp: Math.max(0, otNum("otCshp", OT_TANK_CSHP)), roofCp: otNum("otRoofCp", OT_TANK_ROOF_CP) });
    const c = actions.cases[0];
    return [{ axisIndex: 0, axisLabel: "Any direction", caseLabel: "", Vdes, actions, c, d: bldB, travel: [0, 1], st: otStability(c, bldB, W, gammaG, gammaW) }];
  }

  const pitch = otNum("roofPitch", 0);
  const roofType = $("roofType").value || "gable";
  let cpi = 0;
  if ($("otInternal").value === "include") {
    const cpiCase = CPI_CASES.find((x) => x.id === $("cpiCase").value);
    cpi = cpiCase.cpi === "cpe_ww" ? cpeWindwardWall(h) : Math.max(...cpiCase.cpi);
  }

  return axes.flatMap((axis, i) => {
    const ridgeTheta = i % 2 === 0 ? 0 : 90;
    const b = ridgeTheta === 0 ? bldB : bldD;
    const d = ridgeTheta === 0 ? bldD : bldB;
    const actions = otBuildingActions({ Vdes: axis.Vdes, Cdyn, b, d, h, pitch, roofType, ridgeTheta, cpi });
    return actions.cases.map((c) => ({
      axisIndex: i, axisLabel: axis.label, caseLabel: c.label, Vdes: axis.Vdes, actions, c, d,
      travel: OT_AXIS_TRAVEL[i], st: otStability(c, d, W, gammaG, gammaW),
    }));
  });
}

// ---------------------------------------------------------------------------
// Section 4 -- overturning & stability
// ---------------------------------------------------------------------------

function otFbdSvg(lc) {
  const { c, d } = lc;
  const h = lc.actions.h;
  const ground = 235;
  const scale = Math.min(200 / d, 150 / h);
  const w = d * scale;
  const ht = h * scale;
  const left = 220 - w / 2;
  const right = left + w;
  const top = ground - ht;

  let s = `<line x1="40" y1="${ground}" x2="400" y2="${ground}" class="ot-ground" />`;
  s += `<rect x="${left}" y="${top}" width="${w}" height="${ht}" class="ot-outline" />`;

  const zF = c.Fh !== 0 ? Math.min(h, Math.max(0, c.Mh / c.Fh)) : h / 2;
  const yF = ground - zF * scale;
  s += otArrow(left - 90, yF, left - 6, yF, "ot-c-drag");
  s += otText(left - 92, yF - 22, "Wind &rarr;", "ot-label ot-c-wind", "start");
  s += otText(left - 92, yF - 8, `F = ${fmt(c.Fh, 1)} kN`, "ot-label ot-c-drag", "start");
  s += otText(left - 92, yF + 16, `at z = ${fmt(zF, 2)} m`, "ot-text", "start");

  if (c.U > 0) {
    const xU = Math.min(d, Math.max(0, d - c.MuEdge / c.U));
    const px = left + xU * scale;
    s += otArrow(px, top - 6, px, top - 50, "ot-c-uplift");
    s += otText(px, top - 56, `U = ${fmt(c.U, 1)} kN`, "ot-label ot-c-uplift");
  }

  const cx = left + w / 2;
  const midY = ground - ht / 2;
  s += otArrow(cx, midY - 24, cx, midY + 24, "ot-c-weight");
  s += otText(cx, midY + 40, `W = ${fmt(otNum("otWeight", 0), 1)} kN`, "ot-label ot-c-weight");

  s += `<circle cx="${right}" cy="${ground}" r="4.5" class="ot-c-weight" />`;
  s += otText(right + 8, ground + 16, "pivot (leeward edge)", "ot-text", "start");
  s += otText(cx, ground + 16, `d = ${fmt(d, 2)} m`, "ot-text");
  s += otText(right + 8, midY, `h = ${fmt(h, 2)} m`, "ot-text", "start");
  return `<svg viewBox="0 0 440 265" role="img" aria-label="Free-body diagram of the governing overturning case">${s}</svg>`;
}

function otComponentTables(lc) {
  const hRows = lc.c.horizontal
    .map((f) => `<tr><td>${f.label}</td><td class="num">${cpeSpan(f.cp)}</td><td class="num">${fmt(f.F, 2)}</td><td class="num">${fmt(f.z, 2)}</td><td class="num">${fmt(f.F * f.z, 1)}</td></tr>`)
    .join("");
  const uRows = lc.c.uplift
    .map((u) => `<tr><td>${u.label}</td><td class="num">${cpeSpan(u.cp)}</td><td class="num">${fmt(u.U, 2)}</td><td class="num">${fmt(lc.d - u.x, 2)}</td><td class="num">${fmt(u.U * (lc.d - u.x), 1)}</td></tr>`)
    .join("");
  return `
    <h4>${lc.caseLabel ? `Roof case: ${lc.caseLabel}` : "Actions"}</h4>
    <div class="ot-table-wrap"><table>
      <thead><tr><th>Horizontal force</th><th class="num">C<sub>p</sub></th><th class="num">F (kN)</th><th class="num">Height z (m)</th><th class="num">Moment (kN·m)</th></tr></thead>
      <tbody>${hRows}</tbody>
      <thead><tr><th>Roof uplift</th><th class="num">Net C<sub>p</sub></th><th class="num">U (kN)</th><th class="num">Lever to leeward edge (m)</th><th class="num">Moment (kN·m)</th></tr></thead>
      <tbody>${uRows}</tbody>
    </table></div>`;
}

function otRenderStability(loadCases) {
  const gov = loadCases.reduce((a, b) => (b.st.ratio < a.st.ratio ? b : a));
  const stable = gov.st.ratio >= 1;
  const maxV = loadCases.reduce((a, b) => (b.st.V > a.st.V ? b : a));
  const maxWreq = Math.max(...loadCases.map((lc) => lc.st.Wreq));
  const status = (ok) => `<span class="ot-status ${ok ? "ok" : "hold"}">${ok ? "STABLE" : "HOLD-DOWN REQUIRED"}</span>`;

  const headline = `<div class="ot-headline">
    ${otStat("Stability ratio, γ<sub>G</sub>M<sub>R</sub> / γ<sub>W</sub>M<sub>OT</sub>", fmt(gov.st.ratio, 2), status(stable), otCaseName(gov))}
    ${otStat("Overturning moment, γ<sub>W</sub>M<sub>OT</sub>", fmt(gov.st.Mot, 0), "kN·m", "governing case, about the leeward edge")}
    ${otStat("Base shear, γ<sub>W</sub>F", fmt(maxV.st.V, 1), "kN", otCaseName(maxV))}
    ${otStat("Self-weight for stability", fmt(maxWreq, 0), "kN", "W needed for a ratio of 1.0 with no hold-downs")}
  </div>`;

  const rows = loadCases
    .map((lc) => `<tr${lc === gov ? ' class="ot-governing"' : ""}>
      <td>${lc.axisLabel}</td><td>${lc.caseLabel || "&mdash;"}</td>
      <td class="num">${fmt(lc.Vdes, 1)}</td><td class="num">${fmt(lc.actions.q, 3)}</td>
      <td class="num">${fmt(lc.c.Fh, 1)}</td><td class="num">${fmt(lc.c.U, 1)}</td>
      <td class="num">${fmt(lc.st.Mot, 0)}</td><td class="num">${fmt(lc.st.Mr, 0)}</td>
      <td class="num">${Number.isFinite(lc.st.ratio) ? fmt(lc.st.ratio, 2) : "&infin;"}</td><td>${status(lc.st.ratio >= 1)}</td></tr>`)
    .join("");

  const byAxis = [];
  loadCases.forEach((lc) => {
    (byAxis[lc.axisIndex] = byAxis[lc.axisIndex] || []).push(lc);
  });
  const details = byAxis
    .filter(Boolean)
    .map((group) => {
      const a = group[0].actions;
      const notes = a.notes.map((n) => `<div class="note">${n}</div>`).join("");
      return `<details class="subpanel">
        <summary>${group[0].axisLabel} &mdash; force breakdown <span class="ref">(b = ${fmt(a.b, 2)} m across wind, d = ${fmt(a.d, 2)} m along wind, q = ${fmt(a.q, 3)} kPa)</span></summary>
        ${otIsCircle() ? "" : `<div class="pill">C<sub>p,i</sub> under roof = ${fmt(a.cpi, 2)}</div>`}
        ${notes}
        ${group.map(otComponentTables).join("")}
      </details>`;
    })
    .join("");

  const message = stable
    ? `<p class="note">Self-weight alone keeps the structure stable against overturning in every direction checked. Hold-downs may still see
        tension where the roof uplift exceeds the weight locally &mdash; see Section&nbsp;5.</p>`
    : `<div class="warning">Self-weight alone does not resist overturning for the governing case &mdash; the hold-down points must carry the
        tension shown in Section&nbsp;5 into a foundation heavy enough to resist it.</div>`;

  const el = $("otResults");
  el.hidden = false;
  el.innerHTML = `
    ${headline}
    ${message}
    <div class="ot-split">
      <div>
        <h3>Load cases <span class="ref">(factored; forces F and U shown unfactored)</span></h3>
        <div class="ot-table-wrap"><table>
          <thead><tr><th>Wind direction</th><th>Roof case</th><th class="num">V<sub>des</sub> (m/s)</th><th class="num">q (kPa)</th>
            <th class="num">F (kN)</th><th class="num">U (kN)</th><th class="num">γ<sub>W</sub>M<sub>OT</sub></th><th class="num">γ<sub>G</sub>M<sub>R</sub></th>
            <th class="num">Ratio</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <figure class="ot-diagram">${otFbdSvg(gov)}
        <figcaption class="hint">Governing case (${otCaseName(gov)}), unfactored forces. Schematic &mdash; roof shape not drawn.</figcaption>
      </figure>
    </div>
    ${details}
    <p class="note">F = horizontal wind force on walls (and roof slopes for pitched roofs, wind normal to the ridge); U = net roof uplift.
      M<sub>OT</sub> = &Sigma;F&middot;z + &Sigma;U&middot;(lever to the leeward edge); M<sub>R</sub> = W&middot;d/2. Wall friction drag
      (Clause 5.5) is not included.</p>`;
}

// ---------------------------------------------------------------------------
// Section 5 -- hold-down points
// ---------------------------------------------------------------------------

function otReadPoints() {
  if (otIsCircle()) {
    const n = Math.min(72, Math.max(3, Math.round(otNum("otNPts", 6))));
    const pcd = Math.max(0.01, otNum("otPcd", 1));
    return { ...otCirclePoints({ pcd, n }), circle: true, pcd };
  }
  const W = Math.max(0.1, otNum("bldB", 1));
  const L = Math.max(0.1, otNum("bldD", 1));
  const nW = Math.min(50, Math.max(1, Math.round(otNum("otNW", 2))));
  const nL = Math.min(50, Math.max(1, Math.round(otNum("otNL", 2))));
  const edge = Math.min(Math.max(0, otNum("otEdge", 0)), Math.min(W, L) / 2);
  return { ...otRectPoints({ W, L, nW, nL, edge, perimeterOnly: $("otLayout").value === "perimeter" }), circle: false, W, L, nW, nL };
}

function otPlanSvg(layout, env) {
  const cx = 220;
  const cy = 190;
  const circle = layout.circle;
  const D = circle ? Math.max(otNum("bldB", 1), layout.pcd) : 0;
  const scale = circle ? 230 / D : Math.min(250 / layout.W, 230 / layout.L);
  let s = "";

  if (circle) {
    s += `<circle cx="${cx}" cy="${cy}" r="${(otNum("bldB", 1) / 2) * scale}" class="ot-outline" />`;
    s += `<circle cx="${cx}" cy="${cy}" r="${(layout.pcd / 2) * scale}" class="ot-pcd" />`;
    s += otArrow(cx, 8, cx, 44, "ot-c-wind");
    s += otText(cx + 10, 22, "Wind", "ot-label ot-c-wind", "start");
  } else {
    const hw = (layout.W / 2) * scale;
    const hl = (layout.L / 2) * scale;
    s += `<rect x="${cx - hw}" y="${cy - hl}" width="${2 * hw}" height="${2 * hl}" class="ot-outline" />`;
    s += otArrow(cx, cy - hl - 44, cx, cy - hl - 12, "ot-c-wind") + otText(cx + 10, cy - hl - 30, "θ=0°", "ot-label ot-c-wind", "start");
    s += otArrow(cx, cy + hl + 44, cx, cy + hl + 12, "ot-c-wind") + otText(cx + 10, cy + hl + 38, "θ=180°", "ot-label ot-c-wind", "start");
    s += otArrow(cx + hw + 44, cy, cx + hw + 12, cy, "ot-c-wind") + otText(cx + hw + 14, cy - 10, "θ=90°", "ot-label ot-c-wind", "start");
    s += otArrow(cx - hw - 44, cy, cx - hw - 12, cy, "ot-c-wind") + otText(cx - hw - 14, cy - 10, "θ=270°", "ot-label ot-c-wind", "end");
    s += otText(cx, cy + 4, `W ${fmt(layout.W, 1)} × L ${fmt(layout.L, 1)} m`, "ot-text");
  }

  const n = layout.pts.length;
  const r = n > 60 ? 3.5 : n > 24 ? 5 : 7;
  layout.pts.forEach((p, i) => {
    const px = cx + p.X * scale;
    const py = cy + p.Y * scale;
    s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" class="${env[i].minR < 0 ? "ot-c-tension" : "ot-c-comp"}" />`;
    if (n <= 24) {
      // number sits just inside the outline, toward the centre
      const len = Math.hypot(p.X, p.Y) || 1;
      s += otText((px - (p.X / len) * 16).toFixed(1), (py - (p.Y / len) * 16 + 3.5).toFixed(1), i + 1, "ot-ptnum");
    }
  });
  return `<svg viewBox="0 0 440 380" role="img" aria-label="Plan of hold-down points">${s}</svg>`;
}

function otRenderPoints(loadCases) {
  const layout = otReadPoints();
  const { pts } = layout;
  const n = pts.length;
  const el = $("otPointResults");
  el.hidden = false;

  const results = loadCases.map((lc) => ({ lc, ...otReactions(pts, lc.travel, lc.st.N, lc.st.Mc) }));
  const unstable = results.filter((r) => !r.R);
  const usable = results.filter((r) => r.R);

  if (n < 2 || !usable.length) {
    el.innerHTML = `<div class="warning">The hold-down points cannot resist overturning &mdash; at least two points spaced along the wind direction are needed.</div>`;
    return;
  }

  // Envelope per point over every load case
  const env = pts.map((p, i) => {
    let min = null;
    let max = null;
    usable.forEach((r) => {
      if (!min || r.R[i] < min.R) min = { R: r.R[i], lc: r.lc };
      if (!max || r.R[i] > max.R) max = { R: r.R[i], lc: r.lc };
    });
    return { minR: min.R, minCase: min.lc, maxR: max.R, maxCase: max.lc };
  });
  const worstT = env.reduce((a, b) => (b.minR < a.minR ? b : a));
  const worstC = env.reduce((a, b) => (b.maxR > a.maxR ? b : a));
  const maxV = Math.max(...loadCases.map((lc) => lc.st.V));
  const tensionPts = env.filter((e) => e.minR < 0).length;
  const maxT = Math.max(0, -worstT.minR);

  const headline = `<div class="ot-headline">
    ${otStat("Hold-down points", n, "", layout.circle
      ? `on a ${fmt(layout.pcd, 2)} m PCD, ${fmt(360 / n, 1)}° apart`
      : `${layout.nW} × ${layout.nL} array, ${fmt(layout.sx, 2)} m × ${fmt(layout.sy, 2)} m spacing`)}
    ${otStat("Max hold-down tension per point", fmt(maxT, 1), "kN", maxT > 0 ? otCaseName(worstT.minCase) : "no point goes into tension")}
    ${otStat("Max compression per point", fmt(Math.max(0, worstC.maxR), 1), "kN", otCaseName(worstC.maxCase))}
    ${otStat("Shear per point", fmt(maxV / n, 1), "kN", "base shear shared equally")}
  </div>`;

  // Per-direction minimum reaction (most tension) for each point
  const axisIds = [...new Set(usable.map((r) => r.lc.axisIndex))];
  const axisMin = (i, axisIndex) => Math.min(...usable.filter((r) => r.lc.axisIndex === axisIndex).map((r) => r.R[i]));
  const axisLabel = (axisIndex) => usable.find((r) => r.lc.axisIndex === axisIndex).lc.axisLabel;
  const cell = (v) => `<td class="num">${v < 0 ? `<span class="ot-tension">${fmt(v, 1)}</span>` : fmt(v, 1)}</td>`;

  const rows = pts
    .map((p, i) => `<tr><td>${i + 1}</td>
      ${layout.circle ? `<td class="num">${fmt(p.angle, 1)}</td>` : ""}
      <td class="num">${fmt(p.X, 2)}</td><td class="num">${fmt(p.Y, 2)}</td>
      ${axisIds.map((a) => cell(axisMin(i, a))).join("")}
      <td class="num">${env[i].minR < 0 ? `<span class="ot-tension">${fmt(-env[i].minR, 1)}</span>` : fmt(0, 1)}</td>
      <td class="num">${fmt(Math.max(0, env[i].maxR), 1)}</td></tr>`)
    .join("");

  const warn = unstable.length
    ? `<div class="warning">All points lie on one line across the wind for ${[...new Set(unstable.map((r) => r.lc.axisLabel))].join(", ")} &mdash;
        they cannot resist overturning in that direction, so it is left out of the results below.</div>`
    : "";

  el.innerHTML = `
    ${headline}
    ${warn}
    <div class="ot-split">
      <div>
        <h3>Point reactions <span class="ref">(kN, factored; + compression, &minus; tension)</span></h3>
        <div class="ot-table-wrap tall"><table>
          <thead><tr><th>Point</th>${layout.circle ? '<th class="num">Angle (°)</th>' : ""}<th class="num">X (m)</th><th class="num">Y (m)</th>
            ${axisIds.map((a) => `<th class="num">Min R, ${axisLabel(a).replace(" (front)", "")}</th>`).join("")}
            <th class="num">Hold-down tension</th><th class="num">Max compression</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <figure class="ot-diagram">${otPlanSvg(layout, env)}
        <figcaption class="hint">Plan. Amber = point goes into tension in at least one load case, blue = compression only.
          ${layout.circle ? "Dashed circle = PCD; point 1 is at the windward position, numbered clockwise." : "Points numbered row by row from the θ=0° windward face."}</figcaption>
      </figure>
    </div>
    <p class="note">${tensionPts} of ${n} points need hold-down capacity. X is measured across W and Y along L from the plan centre.
      ${layout.circle ? "With point 1 directly windward the tension in it is the largest any point can see for wind from any direction." : ""}
      Tension shown is the factored design action &mdash; no additional factor of safety is applied. The rigid-base model assumes every point
      can take both tension and compression; a flexible base or bearing on a slab between points will redistribute load.</p>`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function otRunAll() {
  runSpeedCalc();
  if (!otIsCircle()) renderPressureResults();
  const loadCases = otBuildLoadCases();
  otRenderStability(loadCases);
  otRenderPoints(loadCases);
  otHasRun = true;
}

document.addEventListener("DOMContentLoaded", () => {
  otSetupBuildingTypes();
  $("calcOverturning").addEventListener("click", otRunAll);

  // Once calculated, keep every section in step with the inputs.
  const rerun = (evt) => {
    if (!otHasRun || evt.target.closest("#pressureDiagrams")) return;
    otRunAll();
  };
  document.querySelector("main").addEventListener("input", rerun);
  document.querySelector("main").addEventListener("change", rerun);

  otRunAll();
});
