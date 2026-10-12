/*
 * Calculation engine for the tank overturning check & base reactions.
 * Mirrors the "Overturning" tab of Wind_Actions_AS-NZS1170.2.xlsx (and the Wind Speed,
 * Wall Drag and Roof & Internal tabs that feed it). Spreadsheet cell references are given
 * in comments so results can be traced back to the workbook.
 * Wind speed comes from the Wind Actions to AS/NZS 1170.2 engine (wind/data.js + wind/calc.js,
 * load those before this file).
 */

// -- Wind (Wind Speed tab) -----------------------------------------------------

// Appendix A values used by the spreadsheet.
const TANK_CSHP_DRAG = 0.63; // Wall Drag!B7 -- overall drag shape factor, Cl A.5.2.1
const TANK_ROOF_CPE = -0.8; // Roof & Internal!B5 -- roof Zone A, Table A.4(A)
const ULS_MIN_VDES = 30; // m/s, Clause 2.3

// mdMode: 'tank'  -> Md = 1.0 (circular tank, Cl 3.3 -- the spreadsheet's basis, Inputs!C13)
//         'table' -> governing (maximum) Md over the 8 cardinal directions, Table 3.2
function computeTankWind({ regionKey, R, terrainCategory, z, s, Mt, mdMode, applyUlsMin }) {
  const site = computeSiteWindSpeeds({ regionKey, R, terrainCategory, z, h: z, s, Mt });
  const mdGoverning = Math.max(...site.perDirection.map((d) => d.Md));
  const Md = mdMode === "table" ? mdGoverning : 1.0;
  // Wind Speed!B13 -- Vsit = VR Mc Md (Mz,cat Ms Mt), Equation 2.2
  const Vsit = site.vr.value * site.mc * Md * (site.mzcat.value * site.ms.value * Mt);
  const Vdes = applyUlsMin ? Math.max(Vsit, ULS_MIN_VDES) : Vsit;
  // Wind Speed!B15 -- qz = 0.5 rho Vdes^2 (kPa), Equation 2.4(1) with Cshp = Cdyn = 1
  const qz = windPressure(Vdes, 1, 1) / 1000;
  return { site, Md, Vsit, Vdes, qz, belowUlsMin: Vsit < ULS_MIN_VDES };
}

// -- Roof net pressure coefficient (Roof & Internal tab) -----------------------

// Returns { cpe, cpi, net } for the roof. Negative net = outward (uplift).
function roofNetCp(roofCase, b, c) {
  const cpiVented = -0.9 - 0.35 * Math.log10(c / b); // Equation A.5(5), Roof & Internal!C7
  const cases = {
    sealed: { cpe: TANK_ROOF_CPE, cpi: 0 }, // row 5 -- the Overturning tab's basis
    dominant: { cpe: TANK_ROOF_CPE, cpi: 0.7 }, // row 8 -- Cl 5.3 / Table 5.1(B)
    vented: { cpe: TANK_ROOF_CPE, cpi: cpiVented }, // row 7
    none: { cpe: 0, cpi: 0 },
  };
  const k = cases[roofCase] || cases.sealed;
  return { ...k, net: k.cpe - k.cpi };
}

// -- Overturning & reactions (Overturning tab) ---------------------------------

// reactionBasis: 'sheet'   -> reactions use M_OT = M_w + M_u, exactly as the spreadsheet does
//                'statics' -> reactions use M_w only (uplift acts through the base centre, so it
//                             is already in N and adds no moment about the centre)
function computeOverturning({ b, c, qz, Cshp, roofCp, W, fos, n, reactionBasis }) {
  const Az = b * c; // Wall Drag!B10
  const Fw = Cshp * qz * Az; // B8  = Wall Drag!B11
  const dragLever = c / 2; // B9
  const pRoof = roofCp * qz; // B10
  const Ap = (Math.PI * b * b) / 4; // B11
  // B12 = |p_roof| x A_p. A net inward (positive) roof pressure is not counted as restoring.
  const U = Math.max(0, -pRoof) * Ap;

  const Mw = Fw * dragLever; // B19
  const Mu = U * (b / 2); // B20
  const Mot = Mw + Mu; // B21
  const Mr = W * (b / 2); // B22
  const ratio = Mot === 0 ? Infinity : Mr / Mot; // B23
  const ok = ratio >= fos; // B24
  const Wreq = (fos * Mot) / (b / 2); // B25

  const N = W - U; // B30
  const Mreact = reactionBasis === "statics" ? Mw : Mot;
  const Rnear = N / 2 + Mreact / b; // B32
  const Rfar = N / 2 - Mreact / b; // B33
  const holdDown = Rfar < 0 ? -Rfar : 0; // B34

  // n discrete reaction points, point 1 farthest windward (rows 48-71)
  const radius = b / 2; // B49
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const angle = ((i - 1) * 360) / n; // column C
    const x = radius * Math.cos((angle * Math.PI) / 180); // column D
    pts.push({ i, angle, x });
  }
  const sumX2 = pts.reduce((acc, p) => acc + p.x * p.x, 0); // F65
  const x0 = Mreact === 0 ? Infinity : ((N / n) * sumX2) / Mreact; // F66
  pts.forEach((p) => {
    p.R = N / n - (Mreact * p.x) / sumX2; // column F
    p.T = p.R < 0 ? fos * -p.R : 0; // column G
    p.toNeutral = p.x - x0; // column I
  });
  const Rs = pts.map((p) => p.R);

  return {
    Az, Fw, dragLever, pRoof, Ap, U, Mw, Mu, Mot, Mr, ratio, ok, Wreq,
    N, Mreact, Rnear, Rfar, holdDown, shear: Fw,
    radius, pts, sumX2, x0,
    Rmax: Math.max(...Rs), // F67
    Rmin: Math.min(...Rs), // F68
    Tmax: Math.max(...pts.map((p) => p.T)), // F69
    sumR: Rs.reduce((a, v) => a + v, 0), // F70
    sumT: pts.reduce((a, p) => a + p.T, 0), // F71
  };
}
