# Design reference (read-only)

These are the original Claude design-canvas artboards (`.dc.html`) the React code was derived from.
Open them in a browser for a quick look, or use them as the visual source of truth when a Tailwind class is ambiguous.
Live canvas: https://claude.ai/artifact/7X1XCdKyTVBkZWugc3BU3g (private to the owner; ask for access).

They need the canvas runtime (`support.js`) to render fully. Do NOT import them into the app.

| Artboard | React equivalent |
| --- | --- |
| Main.dc.html | docs/HANDOFF.md (tokens) and packages/config |
| Landing.dc.html | apps/web |
| BO-Dashboard.dc.html | apps/backoffice/src/app/page.tsx |
| BO-Inventory.dc.html | apps/backoffice/src/app/inventory/page.tsx |
| SA-Dashboard.dc.html | apps/admin/src/app/page.tsx |
| POS-Login.dc.html | apps/pos/src/app/page.tsx |
| POS-Sell.dc.html | apps/pos/src/app/sell/page.tsx |
| POS-Checkout.dc.html | apps/pos/src/app/checkout/page.tsx |
| POS-Close.dc.html | apps/pos/src/app/close/page.tsx |
