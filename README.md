# Overturning Calculator with Reactions

A static web calculator for the wind overturning check and base reactions of a circular bin, silo or
tank. It reproduces the **Overturning** tab of `Wind_Actions_AS-NZS1170.2.xlsx`, with the wind
actions determined by the [Wind Actions to AS/NZS 1170.2](https://wind-actions-to-1170.onrender.com/)
calculator's engine.

## Running it

No build step. Open `index.html` over HTTP — for example host the folder on Render / GitHub Pages as
a static site, or locally:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

then browse to http://localhost:8765/.

## What it calculates

| Step | Result | Spreadsheet source |
| --- | --- | --- |
| Site & design wind speed | V_R, M_c, M_d, M_z,cat, M_s, M_t → V_sit, V_des, q_z | Inputs, Wind Speed |
| Wall drag | F_w = C_shp · q_z · b · c, acting at c/2 (C_shp = 0.63) | Wall Drag |
| Roof uplift | U = \|p_roof\| · π b²/4, net C_p from the roof case | Roof & Internal |
| Overturning | M_OT = M_w + M_u, M_R = W · b/2, ratio vs FoS_req, W required | Overturning rows 19–25 |
| Edge reactions | N = W − U, R_near / R_far = N/2 ± M/b, hold-down, base shear | Overturning rows 30–35 |
| n-point reactions | R_i = N/n − M · x_i / Σx_i², hold-down T_i, neutral-axis offset | Overturning rows 48–71 |

With the default inputs (Hobart, Region A4, R = 50, TC4, b = 2.8 m, c = 4.3 m, W = 25 kN,
FoS = 1.5, n = 6) every result matches the spreadsheet.

## Files

- `index.html`, `style.css`, `app.js` — page and UI wiring.
- `overturning.js` — the overturning / reactions calculation, with spreadsheet cell references.
- `wind/data.js`, `wind/calc.js` — unmodified copies of the Wind Actions to AS/NZS 1170.2
  calculator's tables and functions (from `BJJBandit/Wind-Actions-to-1170`). Re-copy them when that
  project changes.
- `serve.ps1` — minimal local static server.

## Differences from the spreadsheet

- **Wind speed** comes from the wind calculator's tables rather than the workbook's `Lists` tab, so
  M_z,cat is interpolated for the actual height, R covers every tabulated value for every region,
  and shielding / hill-shape topography can be calculated.
- **M_d** defaults to 1.0 (circular tank), as in the spreadsheet; the governing Table 3.2 value can
  be selected instead.
- **30 m/s minimum** (Clause 2.3, ULS) is flagged when V_sit is below it and can be switched on. It
  is off by default to match the spreadsheet.
- **Roof case** is selectable (sealed, dominant opening, vented, none). The spreadsheet's Overturning
  tab always uses the sealed case. A net inward roof pressure is taken as zero uplift.
- **Moment used for reactions** defaults to M_OT = M_w + M_u, as the spreadsheet does. Because the
  uplift U acts through the base centre it is already in N = W − U, so including M_u again is
  conservative rather than statically exact; the "M_w only" option gives the equilibrium answer.

## Scope

Preliminary hand-check only. Actions are unfactored and compared with a target factor of safety.
Sliding, bearing, anchorage design, shell buckling and dynamic response are not covered.
