# HCS UI handoff (for Codex)

Source of truth for behavior: `PROJECT_SPEC.md` (HCS v1 LOCKED). Source of truth for look: `design-reference/` and this doc.
Design direction: **Obsidian and gold, glassmorphism.** Black, gray and white carry the UI. Gold is the accent. Glass gives depth.

## 1. Status

| Check | Result |
| --- | --- |
| `tsc --noEmit` on all 5 workspaces (strict, noUncheckedIndexedAccess) | Pass |
| Tailwind CLI compile for all 4 apps (`@apply`, plugin components), plus a scan that every utility class used in source is generated | Pass |
| `next build` for all 4 apps, all routes prerender | Pass (fonts stubbed for the test, see below) |
| Visual comparison against the design canvas | **Not done.** No screenshots were taken. Do a visual pass. |
| Unit, component or e2e tests | **None written.** |
| Accessibility audit with a screen reader | **Not done.** Semantics and labels are in place, but untested with assistive tech. |
| Test on real POS tablets (blur performance) | **Not done.** |

`next/font/google` downloads fonts at build time. The environment that produced this could not reach Google Fonts, so the build was verified with the font import temporarily removed. With network access, `next build` will fetch Bricolage Grotesque and Figtree normally.

## 2. Structure

```
hcs/
  apps/
    web/          hustlercentral.com. Marketing landing page (not in the spec; copy derived from it)
    backoffice/   app.hustlercentral.com. Dashboard, Inventory
    pos/          pos.hustlercentral.com. PIN sign-in, Sell, Checkout, Close register
    admin/        HCS Super Admin. Platform dashboard. SEPARATE domain and auth (spec section 3, 32)
  packages/
    config/       hcs-preset.ts (Tailwind tokens + glass plugin), globals.css (base, components, fallbacks)
    ui/           shared components: Surface, Glass, Button, Chip, Field, Keypad, StateCard, Logo, money helpers
  design-reference/   original canvas artboards, read-only
  docs/HANDOFF.md
```

Each app: `src/app` (routes), `src/components` (screen components), `src/mock` (sample data, replace with API), `tailwind.config.ts` (uses the preset).
`apps/web` keeps its copy in `src/content.ts`.

Note: the spec's monorepo lists `apps/api, backoffice, pos` and `packages/shared, ui, types, config`. This handoff adds `apps/web` and `apps/admin`, and has no `packages/shared` or `packages/types` yet. When the API contract exists, move the mock types (`Product`, `StockRow`, `Movement`, ...) into `packages/types`.

### Routes

| Route | App | Spec |
| --- | --- | --- |
| `/` | pos | 6, 10.1: employee PIN sign-in |
| `/sell` | pos | 31: barcode/search, categories, quantity, customer, retail/wholesale, hold |
| `/checkout` | pos | 31, 27.2: cash, e-wallet, card, split, receipt |
| `/close` | pos | 10.1, 10.3: counted vs expected cash, variance, manager approval |
| `/` | backoffice | 28: Dashboard / Command Center |
| `/inventory` | backoffice | 9: stock levels, movement ledger |
| `/` | web | none: landing page |
| `/` | admin | 32, 33: platform dashboard |

Sidebar links to other Back Office sections (`/sales`, `/products`, `/finance`, ...) exist but have no pages yet.

## 3. Design system rules (do not break these)

**Surfaces.** Glass needs something behind it to blur.
- Dark: POS, landing, Super Admin. `<Surface tone="dark" glows={[...]}>`
- Light: Back Office. `<Surface tone="light" glows={[...]}>` with a black glass sidebar (`Glass variant="dark"`).
- Every screen = solid base + 2 to 3 glows (`glow-gold`, `glow-gray`). Glows are absolutely positioned, `-z-10`, and live inside the `isolate` surface.
- Glass variants (`packages/ui/Glass`): `base`, `strong` (cart, receipt, drawers), `gold` (selected, the one suggestion), `dark` (BO sidebar), `light` (BO cards), `data` (tables and long text, 84% fill).
- Never stack more than two glass layers. Long text and tables use `data`.
- Do not put `filter`, `opacity < 1`, `mask` or `will-change` on an ancestor of a glass element. It breaks `backdrop-filter`.
- Fallbacks are in `globals.css`: `@supports not (backdrop-filter)` and `prefers-reduced-transparency` turn every glass solid.

**Color.** Tokens are in `packages/config/hcs-preset.ts`. Never use raw hex in components. There is none today; keep it that way.
- `gold-500` is the ONE primary action per screen (`Button variant="primary"`): Charge, Start free, Complete sale.
- Buttons are always solid, never glass. Confirm is white on dark and black on light (handled by `.surface-light`).
- Status colors live in `signal.dark.*` and `signal.light.*`. Use `<Chip tone surface>`. Map spec enums to tones in one place per domain (see `mock/dashboard.ts`, `mock/inventory.ts`, `mock/platform.ts`).
- Text on gold is `ink-950`. Small gold text on light is `gold-800`, never `gold-500`.

**Type.** `font-display` (Bricolage Grotesque) for headings and big numbers. `font-sans` (Figtree) for everything else. Tabular figures are on globally, so amounts align. Named sizes: `text-display`, `text-h1..h4`, `text-body-lg`, `text-body`, `text-small`, `text-caption`, `text-pos-price`, `text-pos-total`. The screens currently use some arbitrary sizes (`text-[15px]`); moving them to the named scale is a cheap cleanup.

**Touch and density.** POS controls are at least 44px (`min-h-touch`), primary POS actions 64px (`min-h-touch-xl`). Back Office controls are 40 to 44px.

**Accessibility conventions already in place.** Real `<button>`, `<a>`, `<label>`. Icon-only buttons have `aria-label`. `aria-pressed` on toggles, `aria-current="page"` in nav, `role="status"` on the sync pill and change due. Visible focus ring (gold on dark, black on light).

**Blocked states** (spec section 26). Every blocked state answers: what happened, why, did the action go through, what next. Use `<StateCard>` and `<Field error>`. POS wording stays short. Never show "failed" when payment status is unknown.

## 4. Money and data rules to keep in the logic

- **Money is integer centavos** in the UI (`@hcs/ui`: `formatPeso`, `parsePeso`). Never a float, except inside `formatPeso` for display. The API must send integer centavos or decimal strings.
- Inventory: balance is a summary, the movement ledger is the truth. No UI edits a balance. `available = on_hand - reserved`, computed by the inventory service.
- Completed sales are never deleted. Refund, return, exchange and void create linked reversals.
- Idempotency keys for sale submission, payment submission and transfer actions (spec section 36). Generate the key when the screen opens.
- Sale + payment + stock movement is one atomic server transaction. Secondary failures (email receipt) are reported separately from success.
- Tenant, location and register come from the authenticated session or registered device, never from the client.
- Nav and feature visibility: platform available, tenant entitled, tenant enabled, employee permitted (`resolveNav` in `apps/backoffice/src/mock/nav.ts`). Not entitled means locked. Entitled but off means hidden.
- Funds: HCS recommends, the user confirms. No automatic real bank transfer.
- Register close is not clock out. A large variance needs an action-specific manager approval and raises an alert. A problematic register is never closed silently.
- Offline and sync state stays visible on every POS screen (`SyncPill`).

## 5. Dependencies

Runtime
- `next` ^14.2, `react` and `react-dom` ^18.3
- `lucide-react` (icons). Icons are imported per component. All Back Office nav icons are in `mock/nav.ts`.
- `clsx` (class joining, via `cn`)
- `next/font/google` (built into Next): Bricolage Grotesque and Figtree

Dev
- `tailwindcss` ^3.4, `postcss`, `postcss-import` (lets each `globals.css` import `@hcs/config/globals.css`), `autoprefixer`
- `typescript` ^5.5, `@types/react`, `@types/react-dom`, `@types/node`

No Tailwind plugins other than the inline glass plugin in `hcs-preset.ts`. No animation library: nothing animates except the syncing dot (`animate-pulse`). Not needed today: Framer Motion, a chart library (the sales chart is pure SVG), a form library.

Likely additions, when the logic arrives
- Client state for the POS cart shared by Sell and Checkout (Zustand or React context)
- Data fetching and cache (TanStack Query) and a typed API client generated from the API contract
- Offline sale queue for POS (IndexedDB, for example `idb`) and a service worker. Spec section 27.6 and the paid "Advanced Offline POS" module
- Form validation (Zod) shared with the API types
- Testing: Vitest + Testing Library, Playwright for e2e, Storybook for `packages/ui`

## 6. What is real and what is mock

Real interactions (client state only)
- POS sign-in: PIN entry, 4 to 6 digits, Sign in enabled at 4.
- POS Sell: category filter, search, add product, quantity steppers, automatic wholesale pricing at the threshold, manual retail/wholesale override, dismissible wholesale banner.
- POS Checkout: payment method select, keypad, quick amounts, change due or amount still needed, Complete sale disabled until enough cash.
- POS Close: editable cash count, computed counted/expected/variance, variance limit, manager PIN flow (any 4 digits approves in the mock), Close disabled until approved when over the limit.
- Back Office Inventory: search, SKU selection, ledger drawer. Dashboard chart is computed from data.

Mock data to replace (all under `src/mock`, all marked in file headers)
- `apps/pos/src/mock/pos.ts`: products, cart, denominations, reconciliation, thresholds (`LOW_STOCK_AT`, `WHOLESALE_MIN_QTY`, `VARIANCE_LIMIT`)
- `apps/backoffice/src/mock/dashboard.ts`, `inventory.ts`, `nav.ts` (`NAV_CONTEXT`)
- `apps/admin/src/mock/platform.ts`
- `web/src/content.ts`: copy. Prices and the testimonial are placeholders on purpose.

Sample names and numbers (Mabuhay Trading, Ana Reyes, Kape Kalye Co., all pesos) are invented for the design. The dashboards show a "Sample data" chip. Remove it when real data is wired.

## 7. Open items

Screens from the spec that are not designed or built yet
- POS: Open Register and Opening Cash, Receipts (search, reprint, refund, return, exchange, void), Cash In/Out and Shift Expense, Manager Approval modal (standalone), open tickets, offline and syncing states as full screens
- Back Office: Products, Sales, Purchasing and Suppliers, Transfers and Restock, Customers, Loyalty, Wholesale, Approvals, Alerts, Finance (Daily Close, Fund Allocation, ...), Reports, Audit, Notifications, Locations, Data/Tools, Settings, Employees
- Onboarding wizard (spec section 25)
- Super Admin: every page except the dashboard
- Responsive behavior: Back Office and admin are desktop layouts. POS is designed for a 1280x800 landscape tablet. Landing has no mobile layout yet.

Known shortcuts
- Sell and Checkout each read the cart independently. Checkout uses the mock `initialCart`. Lift the cart into shared state before wiring the API.
- Pages such as `/sales` are linked in the sidebar but do not exist yet (404).
- The dashboard "Sample data" chip and static date are hard-coded.
- Filters (date, location, channel) are visual only. Put them in URL search params.
- Fixed pixel sizes were kept close to the design (for example the 400px cart, 248px sidebar). Review at other viewport sizes.
- Inventory tabs and Sales chart range buttons are not wired.
- The sidebar "Free core plan" card and locked-module count come from the mock context.

Decisions I made that you may want to confirm with the product owner
- Landing page copy and structure (the spec has none).
- Variance limit of ₱20.00, wholesale threshold of 12, low-stock threshold of 6 are placeholders for real settings.
- Back Office is a light theme and POS, landing and Super Admin are dark. If a single theme is wanted, the tokens support it, but the Back Office `signal.light.*` and `glass-light` styles would need dark equivalents.

## 8. Suggested next steps

1. `npm install`, run each app, and compare with `design-reference/` side by side. Fix visual drift.
2. Add Storybook for `packages/ui` and component tests for `Keypad`, `Button`, `Chip`, `Field`, `StateCard`.
3. Lift POS cart state, add the idempotency key and the API client, and replace mocks one screen at a time.
4. Build the missing POS screens first (Open Register, Receipts and refunds, Cash In/Out). They complete the register flow in spec section 10.1.
5. Test blur performance on the real POS tablets. If it is slow, set `.glass` and `.glass-strong` to solid fills inside `.app-pos` and keep the look through borders and glows.
