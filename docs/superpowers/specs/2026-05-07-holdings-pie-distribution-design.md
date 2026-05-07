# Holdings Pie Distribution Design

## Summary

Add a portfolio distribution donut chart to `frontend/src/pages/HoldingsWatch.tsx`. The chart follows the currently selected profile, shows the selected fund or person avatar in the center, places company brand marks near the chart and in the detail ranking, and highlights a slice on hover with a separated "cake slice" effect plus allocation details.

## Goals

- Replace the current text-first position distribution area with a chart-and-detail layout.
- Keep the existing profile switcher behavior: Berkshire, ARK, Duan H&H, Paul Pelosi, Druckenmiller, and Ackman all use the same chart component.
- Show a center avatar for the active profile.
- Show company brand graphics for holdings when available, with a ticker fallback when a logo cannot load.
- On hover or focus, emphasize the target holding by moving its pie slice outward, slightly enlarging it, showing a tooltip, and highlighting the matching detail row.
- Preserve the current top-20 distribution limit and the existing page tone: compact, dark, data-dense, and readable.

## Non-Goals

- No backend API changes.
- No new persistent data model for logos or avatars.
- No broad redesign of the Holdings page outside the position distribution section.
- No dependency on every company logo resolving correctly.

## UI Design

Use the selected option B: a left donut chart and a right linked ranking list.

The chart occupies the visual focus of the `Position distribution` card. The right side keeps a compact top holdings list with rank, logo/ticker mark, company name, weight bar, percentage, and market value. The chart and list share a single active holding state.

The center of the donut contains the profile avatar and a short label such as `Berkshire 13F` or `ARK Daily`. The avatar changes when the user changes the top profile tab.

Small holdings that are outside the top 20 remain excluded, matching the existing card label. If the chart implementation needs a balancing remainder, it should be labeled `Other` and must not pretend to represent a specific company.

## Interaction

Hovering or keyboard-focusing a slice sets it as active. The active slice moves away from the center like a piece of cake being pulled out, gets a subtle scale or shadow treatment, and opens a compact tooltip with:

- Ticker
- Company name
- Weight percentage
- Market value label

Hovering or focusing a row in the linked ranking list sets the same active holding and applies the same chart emphasis. Moving the pointer away clears active state, returning the chart to its default layout.

## Data Flow

The feature uses the existing `overview.holdings.items` data already loaded in `HoldingsWatch`.

Required holding fields:

- `rank`
- `ticker`
- `company_name`
- `weight`
- `market_value_label`

The chart data is derived in frontend code:

- Drop holdings with missing, non-finite, or non-positive `weight`.
- Use the first 20 valid holdings.
- Keep stable colors by index and ticker.
- Compute brand and avatar rendering metadata locally from profile id and ticker.

## Brand And Avatar Strategy

Profile avatars are local metadata in the frontend. Use compact text/image-like marks that work without network access. They can be styled initials or simple emblem blocks:

- `BRK` for Berkshire 13F
- `ARK` for ARK Daily
- `H&H` for Duan H&H
- `P` for Paul Pelosi
- `SD` for Druckenmiller
- `PSH` for Ackman

Company brand marks should try to render a logo image from a deterministic ticker-to-logo URL only when practical, and fall back to a styled ticker badge through `onError`. The fallback is required so the chart remains complete even when an external image is blocked or the ticker has no matching logo.

## Implementation Notes

Prefer a focused component under `frontend/src/components/charts/` instead of growing `HoldingsWatch.tsx` further. `echarts` and `echarts-for-react` are already dependencies, so use ECharts custom pie/donut behavior rather than adding a new chart library.

The chart component should expose a simple API:

- `holdings: ArkHolding[]`
- `profileId: Profile`
- `profileLabel: string`
- `distributionDate?: string | null`

The parent page remains responsible for fetching and choosing the current profile. The chart component owns active hover state, derived chart rows, logo fallback state, and ECharts options.

## Accessibility

The ranking list rows should be keyboard focusable. Focus should trigger the same active state as hover. Images should use ticker/company alt text. The chart card should have a clear heading and preserve visible text details in the list so the information is available without relying only on canvas/SVG visuals.

## Error And Empty States

If there are no valid positive weights, show a compact empty state inside the card: `No distribution data available`.

If a company logo fails, show the ticker badge. A failed logo must not break layout, chart rendering, or hover behavior.

## Testing And Verification

- Run `npm run build` in `frontend`.
- Start the frontend dev server and verify the Holdings page visually.
- Switch between at least Berkshire and ARK and confirm the center avatar and chart data update.
- Hover a large slice and a small slice and confirm the slice separates outward, tooltip appears, and the matching row highlights.
- Hover/focus a row and confirm the matching chart slice highlights.
- Confirm failed or missing logos fall back to ticker badges.
