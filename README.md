# Overturning Calculator with Reactions

A static web calculator for wind overturning, stability and hold-down point reactions of
square / rectangular buildings and circular tanks. It is built directly on the
[Wind Actions to AS/NZS 1170.2](https://wind-actions-to-1170.onrender.com/) calculator: sections 1–3
(building, site & design wind speed, design wind pressure) are that calculator's own code, and
sections 4–5 add the overturning check and hold-down points.

## Running it

No build step — host the folder as a static site (Render, publish directory `.`), or locally:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

then browse to http://localhost:8765/.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Wind calculator page, with sections 4–5 added |
| `data.js`, `calc.js`, `app.js` | Unmodified from `BJJBandit/Wind-Actions-to-1170` — re-copy when that project changes |
| `overturning.js` | Overturning and hold-down calculation engine |
| `overturning-ui.js`, `overturning.css` | Form wiring, results tables and diagrams for sections 4–5 |
| `serve.ps1` | Minimal local static server |

## What sections 4–5 calculate

**Shape, size and height** come from Section 1: a rectangular building (W × L, average roof height
h, roof type and pitch) or a circular bin / silo / tank (diameter D, height h).

**Wind actions, per wind direction**

- Rectangular building — all 4 orthogonal axes, each with its own V_des,θ from Section 2, and both
  roof load cases of Clause 5.4.1 (8 load cases):
  - horizontal force from the windward wall (Table 5.2(A)) and leeward wall (Table 5.2(B));
  - roof uplift from the Table 5.3(A) zones by distance from the windward edge, or the Table
    5.3(B)/(C) upwind / downwind slopes for pitch ≥ 10° with wind normal to the ridge (including the
    horizontal component of the slope pressures);
  - optional internal pressure under the roof (largest C_p,i of the Section 3 case).
- Circular tank — governing V_des from any direction, wall drag C_shp = 0.63 at h/2 (Cl A.5.2.1) and
  uniform roof uplift, net C_p = −0.8 by default (Table A.4(A), sealed).

**Stability** about the leeward base edge: γ_G·W·d/2 ≥ γ_W·M_OT, where
M_OT = ΣF·z + ΣU·(lever to the leeward edge). Defaults γ_G = 0.9, γ_W = 1.0 (AS/NZS 1170.0 stability
combination with ultimate wind). For a working-load factor-of-safety check use γ_G = 1.0, γ_W = FoS.

**Hold-down points**

- Circle: pitch circle diameter (PCD) and number of points, point 1 at the windward position.
- Rectangle: an n_W × n_L array, perimeter only or full grid, with an edge distance from the wall
  line.

Reactions use a rigid-base linear distribution about the centroid of the point group:
R_i = N/n + M·s_i / Σs_i², with N = γ_G·W − γ_W·U, M the factored overturning moment about the plan
centre at base level, and s_i the point's distance downwind of the centroid. Each point reports its
minimum reaction per wind direction and the envelope hold-down tension and compression.

## Assumptions and limits

- Preliminary hand check only; have results verified by a qualified structural engineer.
- Wind is checked along the 4 orthogonal axes only (not at 45°), and wall friction drag (Cl 5.5) is
  ignored.
- Wind parallel to the ridge with pitch ≥ 10° uses the Table 5.3(A) zones for roof uplift.
- Hip roofs are treated as gable-equivalent slopes; monoslope roofs take the wind as blowing up the
  slope for both front and back directions.
- Self-weight acts at the plan centre. Every point is assumed able to take tension and compression.
- Sliding, bearing, anchor / foundation design, shell buckling and dynamic response are not covered.
