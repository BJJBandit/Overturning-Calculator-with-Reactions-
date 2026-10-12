/*
 * Overturning & hold-down calculation engine.
 * Builds on the wind actions engine (data.js / calc.js -- load those first): design wind speeds
 * and the Section 5 pressure coefficients come from there, this file turns them into whole-building
 * forces, overturning moments and hold-down point reactions.
 *
 * Conventions for one wind direction:
 *   b = across-wind plan dimension, d = along-wind plan dimension, h = average roof height
 *   x = distance from the windward edge, z = height above the base
 *   horizontal force F positive downwind; uplift U positive upward
 *   point reaction R positive = compression into the foundation, negative = tension (hold-down)
 */

// Appendix A values for circular bins, silos and tanks
const OT_TANK_CSHP = 0.63; // overall drag shape factor, Cl A.5.2.1
const OT_TANK_ROOF_CP = -0.8; // roof Zone A, Table A.4(A), sealed (Cp,i = 0)

// -- Wind actions on an enclosed rectangular building, one wind direction ------

// Table 5.3(A) roof zones clipped to the along-wind depth d. Each piece: { x0, x1, cpe: [more-neg, less-neg] }
function otRoofZones(hd, h, d) {
  return cpeRoofLowPitch(hd)
    .filter((z) => Array.isArray(z.values) && z.from * h < d)
    .map((z) => ({ label: `Roof, ${z.label}`, x0: z.from * h, x1: Math.min(z.to * h, d), cpe: z.values }));
}

// Returns the two Clause 5.4.1 roof load cases for one wind direction, each as lists of horizontal
// forces { label, cp, F, z } and roof uplift pieces { label, cp, U, x }, in kN and m (unfactored).
// cpi is the internal pressure coefficient acting on the underside of the roof (0 to ignore it).
function otBuildingActions({ Vdes, Cdyn, b, d, h, pitch, roofType, ridgeTheta, cpi }) {
  const q = windPressure(Vdes, 1, Cdyn) / 1000; // kPa
  const hd = h / d;
  const cpeWw = cpeWindwardWall(h);
  const cpeLw = cpeLeewardWall({ theta: ridgeTheta, pitch, db: d / b, roofType });

  // Roof slope geometry only matters when the wind is normal to the ridge on a pitched roof --
  // otherwise the building is treated as a box of height h (the average roof height).
  const pitched = pitch >= 10 && pitch <= 45 && ridgeTheta === 0;
  const mono = roofType === "monoslope";
  const rise = pitched ? (mono ? d : d / 2) * Math.tan((pitch * Math.PI) / 180) : 0;
  const hWw = Math.max(0, h - rise / 2); // windward wall (eave) height
  const hLw = mono ? h + rise / 2 : hWw; // leeward wall height (monoslope: wind taken up the slope)
  const notes = [];

  const cases = [0, 1].map((k) => {
    const horizontal = [
      { label: "Windward wall", cp: cpeWw, F: cpeWw * q * b * hWw, z: hWw / 2 },
      { label: "Leeward wall", cp: cpeLw, F: -cpeLw * q * b * hLw, z: hLw / 2 },
    ];
    const uplift = [];
    const addRoof = (label, cpe, x0, x1) => {
      uplift.push({ label, cp: cpe - cpi, U: -(cpe - cpi) * q * b * (x1 - x0), x: (x0 + x1) / 2 });
    };

    if (pitched) {
      const cpeU = cpeRoofUpwindPitched(hd, pitch)[k];
      if (mono) {
        addRoof("Roof, single slope", cpeU, 0, d);
        horizontal.push({ label: "Roof slope (horizontal component)", cp: cpeU, F: cpeU * q * b * rise, z: h });
      } else {
        const cpeD = cpeRoofDownwindPitched(hd, pitch, b / d);
        addRoof("Roof, upwind slope", cpeU, 0, d / 2);
        addRoof("Roof, downwind slope", cpeD, d / 2, d);
        const zRoof = hWw + rise / 2;
        horizontal.push({ label: "Upwind roof slope (horizontal component)", cp: cpeU, F: cpeU * q * b * rise, z: zRoof });
        horizontal.push({ label: "Downwind roof slope (horizontal component)", cp: cpeD, F: -cpeD * q * b * rise, z: zRoof });
      }
    } else {
      otRoofZones(hd, h, d).forEach((z) => addRoof(z.label, z.cpe[k], z.x0, z.x1));
    }

    const Fh = horizontal.reduce((a, f) => a + f.F, 0);
    const Mh = horizontal.reduce((a, f) => a + f.F * f.z, 0);
    const U = uplift.reduce((a, u) => a + u.U, 0);
    return {
      label: k === 0 ? "max uplift" : "min uplift",
      horizontal, uplift, Fh, Mh, U,
      MuCentre: uplift.reduce((a, u) => a + u.U * (d / 2 - u.x), 0), // about the plan centre
      MuEdge: uplift.reduce((a, u) => a + u.U * (d - u.x), 0), // about the leeward edge
    };
  });

  if (pitched && roofType === "hip") {
    notes.push("Hip roof: roof forces are taken on the gable-equivalent upwind / downwind slopes (hip ends ignored).");
  }
  if (pitched && mono) {
    notes.push("Monoslope: wind is taken as blowing up the slope (Table 5.3(B)) for both the front and back directions.");
  }
  if (pitch >= 10 && !pitched) {
    notes.push(pitch > 45
      ? "Roof pitch > 45°: outside Table 5.3(B) — roof uplift is taken from the Table 5.3(A) zones as an approximation."
      : "Wind parallel to the ridge: roof uplift is taken from the Table 5.3(A) zones by distance from the windward edge (crosswind slopes, R).");
  }

  return { q, b, d, h, cpi, cases, notes };
}

// -- Wind actions on a circular bin, silo or tank (any direction) --------------

function otTankActions({ Vdes, Cdyn, D, h, Cshp, roofCp }) {
  const q = windPressure(Vdes, 1, Cdyn) / 1000;
  const horizontal = [{ label: "Wall drag", cp: Cshp, F: Cshp * q * D * h, z: h / 2 }];
  const U = -roofCp * q * (Math.PI * D * D) / 4;
  const uplift = [{ label: "Roof", cp: roofCp, U, x: D / 2 }];
  const Fh = horizontal[0].F;
  return {
    q, b: D, d: D, h, cpi: 0, notes: [],
    cases: [{ label: "", horizontal, uplift, Fh, Mh: Fh * (h / 2), U, MuCentre: 0, MuEdge: U * (D / 2) }],
  };
}

// -- Stability about the leeward base edge -------------------------------------

// Factored check: gammaG x (W d/2) >= gammaW x M_OT.
function otStability(c, d, W, gammaG, gammaW) {
  const MotUnfactored = c.Mh + c.MuEdge;
  const Mot = gammaW * MotUnfactored;
  const Mr = gammaG * W * (d / 2);
  return {
    Mot, Mr,
    ratio: Mot > 0 ? Mr / Mot : Infinity,
    Wreq: Math.max(0, (gammaW * MotUnfactored) / (gammaG * (d / 2))), // self-weight for ratio = 1.0
    N: gammaG * W - gammaW * c.U, // net vertical load on the base
    Mc: gammaW * (c.Mh + c.MuCentre), // overturning moment about the plan centre at base level
    V: gammaW * c.Fh, // base shear
  };
}

// -- Hold-down point layouts ---------------------------------------------------

// Rectangular array: nW points across the W dimension (X), nL along the L dimension (Y), the
// outer lines set in by `edge` from the wall lines. perimeterOnly drops the interior points.
function otRectPoints({ W, L, nW, nL, edge, perimeterOnly }) {
  const spanX = Math.max(0, W - 2 * edge);
  const spanY = Math.max(0, L - 2 * edge);
  const sx = nW > 1 ? spanX / (nW - 1) : 0;
  const sy = nL > 1 ? spanY / (nL - 1) : 0;
  const pts = [];
  for (let r = 0; r < nL; r++) {
    for (let c = 0; c < nW; c++) {
      const onPerimeter = r === 0 || r === nL - 1 || c === 0 || c === nW - 1;
      if (perimeterOnly && !onPerimeter) continue;
      pts.push({ X: nW > 1 ? -spanX / 2 + c * sx : 0, Y: nL > 1 ? -spanY / 2 + r * sy : 0 });
    }
  }
  return { pts, sx, sy };
}

// Circular array: n points evenly spaced on the pitch circle diameter, point 1 at the windward position.
function otCirclePoints({ pcd, n }) {
  const r = pcd / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i * 2 * Math.PI) / n;
    pts.push({ X: r * Math.sin(t), Y: -r * Math.cos(t), angle: (i * 360) / n });
  }
  return { pts };
}

// -- Concrete footing ----------------------------------------------------------

// Minimum concrete volume (m3) whose weight resists a hold-down tension T (kN) with the given
// factor of safety: fos x T <= unitWeight x volume.
function otFootingVolume(T, fos, unitWeight) {
  return (fos * T) / unitWeight;
}

// Round (cylindrical) footing, volume = pi D^2 / 4 x depth. Given the volume and one dimension (m),
// returns the minimum value of the other.
function otFootingDepth(volume, diameter) {
  return volume / ((Math.PI * diameter * diameter) / 4);
}

function otFootingDiameter(volume, depth) {
  return Math.sqrt((4 * volume) / (Math.PI * depth));
}

// -- Hold-down point reactions -------------------------------------------------

// Rigid base, linear distribution about the centroid of the point group:
//   R_i = N/n + Mc * s_i / sum(s_i^2),  s_i = distance downwind of the group centroid.
// `travel` is the unit vector [tx, ty] of the wind's direction of travel in plan.
function otReactions(pts, travel, N, Mc) {
  const s = pts.map((p) => p.X * travel[0] + p.Y * travel[1]);
  const sMean = s.reduce((a, v) => a + v, 0) / s.length;
  const arm = s.map((v) => v - sMean);
  const sumS2 = arm.reduce((a, v) => a + v * v, 0);
  if (sumS2 < 1e-9) return { R: null, sumS2: 0 }; // all points on one line across the wind: no moment resistance
  return { R: arm.map((a) => N / pts.length + (Mc * a) / sumS2), sumS2 };
}
