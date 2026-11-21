# Client Menu: frontend spec

**Sherpas advisor console · Search, wealth filter and sector filter**
CDTM Valencia Hacks 2026, Sherpas challenge ("First to know, first to tell") · written 21 Nov 2026

---

## 0. TL;DR

Build **one screen: Clients**. It is the advisor's book of families *after* the plan is delivered (job 3 in the challenge README: keep the family close).

| Piece | What it does |
|---|---|
| **Search bar** | Shows suggestions once 3 letters are typed. The suggestion panel has scope chips (All · People · Location · Holdings · Goals) so the advisor can narrow while typing. |
| **Wealth dropdown** | 5 net-worth bands: Under $200K · $200K–$600K · $600K–$1M · $1M–$2M · $2M and over. Multi-select. |
| **Sector dropdown** | 7 sector groups built from the 11 sectors in the data, plus an "exposure at least" level (default 10% of stock holdings). Multi-select. |
| **Filters stay** | Each ticked option becomes a chip and stays applied. They are saved in the URL and in localStorage, so they survive reloads, a trip to a client page and back, and the next day. OR inside one dropdown, AND between dropdowns and the search. |

All filter and search logic is in **`filters.ts` (Appendix A)**. It is framework-free and has been run against the four real families (Appendix E). The UI only renders it.

---

## 1. What the video shows, and what this menu improves

The video is *"Meet Sherpas – Your AI-powered team"* (Sherpas Wealth, 3:05, Feb 2026). I went through its transcript and frames:

| Time | What is on screen |
|---|---|
| 0:30 | Advisor home: **"Hi David, you have 16 opportunities valued at $17M"**. A Kanban board with columns *Identified → Collecting data → Analysis in progress → Ready to present*. Each card shows a name, a $ value, a coloured dot, the document stage and time in stage. The only controls are **Owner · Status · Ordered by: Priority**. Top nav: *Opportunities · Contacts · Portfolios · Data Extraction*. |
| 0:34–0:55 | Upload statements, then automatic extraction of accounts and holdings. |
| 0:55–1:40 | The plan: "Your Financial Health is: 72", tabs *Summary · Retirement & Goals · Assets & Investments · Debt management · Savings & Expenses · Protection*, allocation donuts, narrative bullets. |
| 1:42–1:55 | **"Ask Sherpas anything about this specific client"** (a chat, one client at a time). |
| 2:13 | "More capacity, more families served." |

The story ends at the proposal ("your digital team for prospect to proposal"). Once a prospect becomes a client there is no screen to work the whole book. That is the gap this menu fills.

| Today (video) | Problem | This menu |
|---|---|---|
| Pipeline of *opportunities* by stage | No view of the ~150 families already on a plan | A **Clients** view of the book |
| Filters: Owner, Status, Priority | Can't slice the book by wealth or by what families hold | **Wealth** and **Sector exposure** filters |
| To find a family, scroll the cards | Slow at 150 families | **Type 3 letters** to jump to a name, a child's name, a city, a ticker or a goal |
| "Ask Sherpas" works on one client | Can't ask "who is hit if tech falls 30%?" (README problem 2) | Sector filter **ranks the whole book by exposure** |
| Cards lead with a $ value | Smaller families "feel like a number" (README problem 3) | Default sort is **next milestone**, not wealth |

> I could see frames and the transcript, not Sherpas' design files. Colours and fonts in §8 are matched by eye from the video. Swap in Sherpas' real tokens if the mentor can share them.

---

## 2. Scope

**In:** the Clients page (header, search, two filter dropdowns, sort, chips bar, results list, empty/loading/error states); a build step that turns `cases/` into a static index; labelled simulated families; persistence of filters.

**Out:** the client detail page. Row click opens the Sherpas shared plan for the 4 real families; simulated families get a placeholder. Also out: messaging, auth, any backend, live MCP calls.

---

## 3. Decisions, and why

### D1. "Overall wealth" = net worth

The data has two candidates: **net worth** (`financial-health.json → key_metrics.netWorthStatement.netWorth.total`) and **investable assets** (`key_metrics.ratios.investableAssetLevel.investableAssets`, which leaves out cash and the home).

| Family | Net worth | Band (net worth) | Investable | Band (investable) |
|---|---|---|---|---|
| Michael Carter | $218,500 | $200K–$600K | $145,000 | Under $200K |
| Daniel & Emily Johnson | $511,000 | $200K–$600K | $330,000 | $200K–$600K |
| Timothy & Melanie Weah | $695,500 | $600K–$1M | $210,000 | $200K–$600K |
| Samantha Lewis | $1,395,000 | $1M–$2M | $335,000 | $200K–$600K |

**Why net worth:** "overall wealth" means everything a family owns minus what it owes, which is net worth. It also spreads the families across bands, while investable assets put 3 of 4 in the same band. The trade-off: Samantha lands in $1M–$2M mostly because of her $900K house. To make that visible, the band pill's tooltip shows both numbers ("Net worth $1,395,000 · Investable $335,000"). A net worth / investable toggle is an open question (§14), not in the MVP.

### D2. Band edges

The lower edge is inclusive and the upper edge exclusive: exactly $600,000 falls in **$600K – $1M**. A negative net worth falls in **Under $200K**. Labels are written out ("Under $200K", "$2M and over") instead of `<` / `>` signs, which are easy to misread.

### D3. Seven sector groups from the eleven in the data

Each family's `investment-analysis.json → key_metrics.concentrationAndDiversification.sectorConcentration` lists **11 Morningstar sectors** as a share of stock holdings. They map to the 7 groups like this:

| # | Group (menu label) | Data sectors | Why grouped |
|---|---|---|---|
| 1 | **Technology & Communications** | Technology + Communication Services | Since 2018 Alphabet, Meta and similar sit in "Communication Services". To an advisor and a client, that is tech. |
| 2 | **Financials & Real Estate** | Financial Services + Real Estate | Real Estate was part of Financials until 2016, and it is under 2% for every family. |
| 3 | **Healthcare** | Healthcare | — |
| 4 | **Consumer** | Consumer Cyclical + Consumer Defensive | Both are "companies that sell to households". |
| 5 | **Industrials** | Industrials | — |
| 6 | **Energy & Utilities** | Energy + Utilities | Both are power and fuel. |
| 7 | **Basic Materials** | Basic Materials | The "prime materials" option you asked for. |

**Important:** the plan reports the raw sector. Samantha's case files say "Technology is 30.6%" of her stock holdings, but our group shows 38.3% (30.6% Technology + 7.7% Communication Services). So the exposure cell's tooltip **must show the breakdown**. Otherwise the advisor sees two numbers that don't match. Keep the raw 11 sectors in the index and group only in the UI.

### D4. A sector "matches" only above a set level

Every family holds broad funds (VTI, SCHD, VWO…), so **every family has some money in all 11 sectors**. A plain "holds this sector" filter would return everyone. Here are the counts on the 150-family demo book:

| Exposure at least | Tech & Comms | Financials & RE | Healthcare | Consumer | Industrials | Energy & Util. | Basic Materials |
|---|---|---|---|---|---|---|---|
| 0% (any) | 150 | 150 | 150 | 150 | 150 | 150 | 150 |
| 5% | 150 | 150 | 150 | 150 | 150 | 147 | 14 |
| **10% (default)** | **150** | **148** | **71** | **148** | **45** | **19** | **13** |
| 20% | 150 | 11 | 12 | 1 | 3 | 14 | 0 |

So:
- A client matches a group when **group weight ≥ the chosen level** (0 / 5 / **10** / 20 / 30%, picked inside the sector dropdown).
- With several groups ticked, a client matches if **any** of them clears the level.
- Picking a sector also **ranks the list by exposure**, answering the real question behind the filter: "the market fell in X, who do I call first?" The ranking uses the **share of the family's own stock holdings**, and shows dollars next to it (group weight × `totals.equityExposure`). Dollars are a second sort option, not the default. Ranking by dollars puts the richest families on top: on the 150-family book, the top 5 by dollars are all $4M+ families. Ranking by share puts the most *exposed* families on top, whatever their size: the top 10 covers all five wealth bands, and #1 is a $175K family with 56.6% in tech. That is README problem 3 again: "it is our $150,000".

### D5. Multi-select that stays open and applies at once

This is how "each time you select an option, the filter is kept" is implemented:
- Each dropdown is a list of checkboxes. **Clicking an option does not close the dropdown**, so the advisor can tick several in a row.
- **No Apply button.** The list updates on every click (150 rows filter in under a millisecond), and the advisor sees the effect straight away.
- Every ticked option shows as a **chip** under the bar. Removing a chip unticks the option.
- **OR inside a dropdown** ($200K–$600K *or* $1M–$2M), **AND between** wealth, sector and search.
- Each option shows a **count** of how many clients it would give, taking the *other* active filters into account. With the four real families, the advisor sees "Basic Materials 0" before clicking instead of after.

### D6. Where filters are kept: URL first, localStorage second

- **The URL is the source of truth:** `/clients?wealth=1m-2m,gte2m&sector=technology&minExp=20&sort=exposure-desc`. Reload, browser Back from a client page, and sending a link to a colleague all work for free. (`URLSearchParams` writes the comma as `%2C`; both forms read back the same.)
- **localStorage mirrors the filters**, so the advisor finds the same view tomorrow.
- **The search text is kept in the URL only, not in localStorage.** A search is a one-off intent ("find Samantha"). Restoring "sam" the next morning would hide 149 families and confuse the advisor.
- Load order: filters in the URL win, then saved filters, then defaults. Unknown values in the URL are dropped silently and never crash the page.
- Code: `useFilterState.ts` (Appendix B).

### D7. Search runs in the browser on a static index

150 families × a few fields is tiny, so no search server is needed. The README ground rule is "keep keys on your backend, never in browser code". A build-time index made from the files in `cases/` needs **no key at all**. If you later fetch from the MCP, do it in a backend that returns the same `ClientSummary[]`, and the UI does not change.

### D8. What the search looks at

| Scope chip | Fields | Example (real data) |
|---|---|---|
| People | family name, every member's first name, **children included** | `oli` → Daniel & Emily Johnson ("Child · Oliver") |
| Location | city, state | `aus` → Michael Carter ("Austin, TX") |
| Holdings | ticker and fund name | `upr` → Timothy & Melanie Weah ("Holds UPRO"); `vti` → all 4 |
| Goals | dated goals from the plan | `col` → 3 families with a college goal |

Why children: advisors remember "Oliver's parents" more than "the Johnsons". Why tickers: most are 3–4 letters, so the 3-letter trigger lands on them exactly. Why goals: the challenge is about the next moment in each family's life. Dollar figures are not searchable; that is what the filters are for.

### D9. Search respects the active filters, but shows what they hide

If the advisor has $600K – $1M and $1M – $2M ticked and types "joh", Daniel & Emily ($511K) do not appear in the main results. The panel then shows them **greyed under "Hidden by your filters"**, with the reason ("not in $600K – $1M, $1M – $2M"), and they stay clickable. The advisor never wonders "where is my client?", and the filters stay as they were.

### D10. Default sort = next milestone, not wealth

The video's cards lead with a $ value. For a book of clients that tells smaller families they come second (README problem 3). The default sort is the **next one-off milestone** in the plan: home purchase, car, college, retirement. The yearly vacation is skipped because every family has one in January, and it would hide everything else. Real data: Michael (home, Jan 2027) → Weahs (vehicle, Jul 2028) → Samantha (Ava's college, Aug 2028) → Johnsons (Oliver's college, Aug 2033).

Picking the first sector switches the sort to **exposure (share of the family's stocks)**, and clearing the sectors switches it back. If the advisor chose a sort by hand, it is never overridden (`withSectors()` in Appendix A).

### D11. Simulated families to reach ~150, clearly labelled

The README supplies 4 families and allows simulated ones "to demonstrate scale; label them". `simulate.ts` (Appendix D) adds 146 families from a **fixed seed**, so the demo is the same every run. Every wealth band has members (24 / 49 / 38 / 30 / 9), and a few books are tilted to energy, healthcare, materials or financials so every sector option has something to show. Each simulated row shows a **SIM** badge. State this in the repo README too.

---

## 4. Layout

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ sherpas    Opportunities   Clients   Contacts   Portfolios   Data Extraction          (DV)│  ← existing nav + new "Clients"
├───────────────────────────────────────────────────────────────────────────────────────────┤
│  Good morning, David. 150 families in your book.                                          │
│                                                                                           │
│  ┌ 🔍  Search families, children, cities, tickers, goals…                         ⌘K ┐   │
│  └──────────────────────────────────────────────────────────────────────────────────┘   │
│  [ Wealth ▾ ]  [ Sector exposure ▾ ]                            Sort: Next milestone ▾    │
│                                                                                           │
│  12 of 150 families · [$1M – $2M ✕] [Tech & Comms ≥ 10% ✕]                 Clear all      │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│  FAMILY                        LOCATION      NET WORTH          SCORE      EXPOSURE        NEXT MILESTONE      │
│  Samantha Lewis                Miami, FL     $1.4M  [$1M–$2M]   ● 82       38.3% · $108.6K College Ava         │
│  Samantha 47 · Ethan 18 · Ava 16                                strong                     Aug 2028            │
│  ──────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│  Omar Okafor  [SIM]            Chicago, IL   …                                                                 │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

On the page, top to bottom: the greeting with the book size, the search bar (full width), the filter row (two dropdowns on the left, sort on the right), the chips bar with the result count, then the list.

---

## 5. Components

### 5.1 Search bar (`<ClientSearch>`)

**Behaviour by input**

| Input | What happens |
|---|---|
| Empty, focused | Panel shows **Recently opened** (last 5 clients, from localStorage). |
| 1–2 letters | Panel shows a hint: *"Type 3 letters to search."* No results and no flicker. Spaces don't count, so `"s a"` is 2 letters. |
| 3+ letters | Results after a **120 ms debounce**. Case and accents are ignored (`mélanie` = `melanie`). |
| Several words | **All words must match** the same family, in any field. `sam mia` → Samantha Lewis (name + Miami); `sam aus` → nothing. |
| No match | *"No families match 'xyz'. Try a first name, a child's name, a city, a ticker or a goal."* |

**Ranking:** a match at the start of a word beats a match inside a word (`ela` still finds Melanie, but lower). Field weight: People 100 > Holdings 70 > Location 60 > Goals 40. An exact whole-field match gets a bonus. Ties are broken by id.

**Results panel**

```
┌ 🔍 col                                                                      ✕ ┐
├────────────────────────────────────────────────────────────────────────────────┤
│ (All 2)  (People 0)  (Location 0)  (Holdings 0)  (Goals 2)                     │  ← scope chips, counts update while typing
├────────────────────────────────────────────────────────────────────────────────┤
│ ▸ Samantha Lewis           College Ava · Aug 2028             $1M – $2M        │
│   Timothy & Melanie Weah   College Liam · Aug 2038            $600K – $1M      │
├────────────────────────────────────────────────────────────────────────────────┤
│ Hidden by your filters (1)                                                     │
│   Daniel & Emily Johnson   College Oliver · Aug 2033                          │  ← greyed, still clickable
│                            not in $600K – $1M, $1M – $2M                      │
├────────────────────────────────────────────────────────────────────────────────┤
│ ↵  Show all 2 in the list                                                      │
└────────────────────────────────────────────────────────────────────────────────┘
(example: wealth filter = $600K – $1M and $1M – $2M; real data)
```

- **Scope chips** are the dropdown filter while searching. *All* is the default; one chip at a time; each shows its count of *visible* matches (after the wealth and sector filters). The chosen scope is passed as `searchClients(clients, q, scope)`. It resets to *All* when the panel closes.
- Each row shows the family name, **why it matched** (matched part in bold), the wealth band and a SIM badge if simulated. Up to 8 rows, then "Show all N".
- **Clicking a row** opens that client (real family: its Sherpas plan link in a new tab; simulated: a placeholder).
- **Enter with no row highlighted**, or "Show all N in the list", applies the text to the list below as a chip `Search: col ✕`. The panel closes.

**Keyboard**

| Key | Action |
|---|---|
| `/` or `⌘K` / `Ctrl+K` | Focus the search |
| `↓` `↑` | Move through rows (wraps) |
| `Enter` | Open the highlighted row, or apply the text to the list |
| `Esc` | Close the panel; a second `Esc` clears the text |
| `Tab` | Move into the scope chips |

### 5.2 Wealth dropdown (`<WealthFilter>`)

```
[ Wealth · 2 ▾ ]
┌────────────────────────────────┐
│ Net worth                       │
│ ☐ Under $200K              24   │
│ ☑ $200K – $600K            49   │
│ ☐ $600K – $1M              38   │
│ ☑ $1M – $2M                30   │
│ ☐ $2M and over              9   │
│ ─────────────────────────────── │
│ Clear                           │
└────────────────────────────────┘
(counts: 150-family demo book, no other filter)
```

- The button label is "Wealth" with nothing ticked, the option itself with one ticked ("Wealth: $1M – $2M"), and "Wealth · 2" with several. The button is highlighted while active.
- The dropdown stays open on click, closes on `Esc` or a click outside, and keeps focus on the list while open.
- Counts come from `facetCounts()`. They ignore this dropdown's own ticks, so ticking one band never turns the others to 0.
- An option with count 0 stays clickable (it may be part of a saved view) but is shown in a muted colour.

### 5.3 Sector dropdown (`<SectorFilter>`)

```
[ Sector exposure: Tech & Comms ▾ ]
┌───────────────────────────────────────────┐
│ Share of stock holdings                    │
│ ☑ Technology & Communications       150    │
│ ☐ Financials & Real Estate          148    │
│ ☐ Healthcare                         71    │
│ ☐ Consumer                          148    │
│ ☐ Industrials                        45    │
│ ☐ Energy & Utilities                 19    │
│ ☐ Basic Materials                    13    │
│ ───────────────────────────────────────── │
│ Exposure at least   0%  5% [10%] 20% 30%   │  ← segmented control
│ Clear                                       │
└───────────────────────────────────────────┘
```

- Same open/close and label rules as the wealth dropdown.
- Changing the level updates the counts and the list at once. The level shows in the chip: `Tech & Comms ≥ 10% ✕`.
- A tooltip on each option lists the data sectors behind it ("Technology + Communication Services").
- Picking the first sector switches the sort to **Exposure %** and shows a small inline note: *"Most exposed first: share of stocks in Technology & Communications"* (D4, D10).
- When nothing matches, the empty state names the highest family: *"No family has 10% or more in Basic Materials. Highest: Timothy & Melanie Weah at 3.9%. [Show any exposure]"*.

### 5.4 Chips bar

- Text on the left: **"12 of 150 families"**, announced to screen readers through `aria-live="polite"`.
- Chips in this order: search, wealth options, sector options. Each has its own ✕.
- **Clear all** clears the filters *and* the search text and keeps the sort.
- The bar is hidden when nothing is active (the count moves next to the sort instead).

### 5.5 Results list

| Column | Content | Notes |
|---|---|---|
| Family | `displayName` + SIM badge; second line: members with ages ("Samantha 47 · Ethan 18 · Ava 16") | Link colour; the whole row is clickable |
| Location | "Miami, FL" | Hidden under 1024 px |
| Net worth | "$1.4M" + band pill | Tooltip: net worth and investable, exact dollars |
| Score | Coloured dot + value + band ("● 82 strong") | Colour comes from the data (`score.colour`), never recomputed for real families |
| Exposure | No sector picked: top group ("Tech & Comms 38.3%"). Sectors picked: sum of picked groups, "% · $" ("38.3% · $108.6K") | Tooltip: raw sector breakdown (D3) |
| Next milestone | "College Ava" / "Aug 2028" | From `nextMilestone()`; "—" if none |

- Numbers use `font-variant-numeric: tabular-nums` and are right-aligned. Money is formatted with `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 })` → "$1.4M", "$108.6K", "$210K".
- Sort options: **Next milestone** (default) · Name A–Z · Net worth high → low · Score low → high ("needs attention") · Exposure % high → low · Exposure $ high → low. The two exposure sorts are enabled only when a sector is picked.
- 150 rows need no virtualisation. Add it only past ~1,000 rows.
- Under 768 px each row becomes a card, and the two dropdowns move into a "Filters" bottom sheet.

### 5.6 States

| State | Shows |
|---|---|
| Loading | 6 skeleton rows; search and filters disabled |
| Load error | "Couldn't load your clients." + **Retry** |
| No results (filters) | "No families match these filters." + the chip that removes the most rows as a one-click button ("Remove $2M and over") |
| No results (search) | See 5.1 |
| Book empty | "No clients yet. Families appear here once their plan is delivered." |

---

## 6. State model

```ts
interface FilterState {
  q: string;                  // search text (URL only)
  wealth: WealthBandId[];     // "lt200k" | "200k-600k" | "600k-1m" | "1m-2m" | "gte2m"
  sectors: SectorGroupId[];   // "technology" | "financials" | "healthcare" | "consumer" | "industrials" | "energy" | "materials"
  minExposure: number;        // 0 | 0.05 | 0.10 | 0.20 | 0.30, default 0.10
  sort: SortId;               // "next-milestone" | "name" | "net-worth-desc" | "score-asc" | "exposure-desc" | "exposure-usd-desc"
}
```

| URL param | Example | Default (omitted from URL) |
|---|---|---|
| `q` | `q=sam` | empty |
| `wealth` | `wealth=600k-1m,1m-2m` | none |
| `sector` | `sector=technology,energy` | none |
| `minExp` | `minExp=20` (percent) | 10 |
| `sort` | `sort=exposure-desc` | next-milestone |

- localStorage key: `sherpas.clientMenu.filters.v1`. It holds the same query string without `q`. Wrap every read and write in `try/catch`, because storage can be blocked.
- Filter changes use `history.replaceState`, so twenty checkbox clicks don't fill the Back button. Opening a client is a normal navigation, so Back returns to the filtered list.
- With React Router or Next.js, put the same `toSearchParams` / `fromSearchParams` behind the router's search-params API instead of `window.history`.

---

## 7. Data

### 7.1 Field map (where each value comes from)

| `ClientSummary` field | Source |
|---|---|
| `id` | case folder name (`samantha-lewis`) |
| `displayName`, `familyName` | adults' `first_name` from `financial-health.json → case.household` + the last part of the folder name, capitalised ("Timothy & Melanie Weah") |
| `members` | `case.household[]` → `first_name`, `role` (client / co-client / child), `age` |
| `city`, `state` | `case.city`, `case.state` |
| `netWorth` | `key_metrics.netWorthStatement.netWorth.total` |
| `investableAssets` | `key_metrics.ratios.investableAssetLevel.investableAssets` |
| `score` | `score.published_score`, `score.band`, `score.colour` |
| `equityExposure` | `investment-analysis.json → key_metrics.concentrationAndDiversification.totals.equityExposure` |
| `sectorWeights` | same object → `sectorConcentration` (skip the header row; `[sector, weight, …]`) |
| `holdings` | `positions[]` → unique `ticker` + `name` (skip the cash line with an empty ticker) |
| `goals` | `financial-health.json → goals.chartGoals[]` where `name` is set; drop `BANKRUPTCY` / `BANKRUPTCY_ZEROCASH` (these mark when projected savings run out, not life events) |
| `planUrl` | the "Open the plan" links in the repo README |

### 7.2 Pipeline

```bash
# once, and again if cases/ changes
node --experimental-strip-types scripts/build-index.ts ../VLChacks_t4-main/cases > public/clients.index.json
node --experimental-strip-types scripts/simulate.ts public/clients.index.json 146 > public/clients.all.json
```

The app fetches `public/clients.all.json` (or `clients.index.json` with `?data=real`, for the four real families only). Node 22+ runs `.ts` files directly with `--experimental-strip-types`.

---

## 8. Visual design

Matched by eye to the video so the menu feels like the same product.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F7F8FC` | page |
| `--surface` | `#FFFFFF` | cards, table, dropdowns |
| `--header-gradient` | `#EEF0FF → #FFFFFF` (top to bottom) | page header band, like the plan header |
| `--text` | `#0F1535` | primary text (dark navy of the logo) |
| `--text-muted` | `#5B6178` | second lines, counts |
| `--accent` | `#3B5BDB` | links, active dropdown button, focus ring, ticked boxes |
| `--accent-soft` | `#E8ECFF` | chips, active scope chip, row hover |
| `--green` / `--yellow` / `--red` | `#1F9D55` / `#D9A400` / `#D64545` | score dots (from `score.colour`) |
| `--border` | `#E4E7F0` | 1 px dividers |
| Radius | 12 px cards & panels · 8 px inputs & buttons · 999 px chips | |
| Shadow | `0 8px 24px rgba(15,21,53,.08)` | dropdowns and search panel only |

**Type:** Poppins 600 for the page title and section titles (the video's headings are in this geometric style). Inter 400/500 for the UI and table, with tabular figures for numbers. Base size 14 px, row height 56 px (two lines).

**Motion:** dropdowns fade and slide 4 px in 120 ms. No animation on list updates: the advisor needs the list to stay still while ticking boxes.

---

## 9. Accessibility

- **Search** follows the WAI-ARIA *combobox* pattern: the input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; the result rows are `role="option"` in a `role="listbox"`; the scope chips are toggle buttons (`aria-pressed`).
- **Dropdowns** are a button with `aria-expanded` that opens a popover holding a `<fieldset>` of real checkboxes with a `<legend>` ("Net worth"). This is simpler and more robust than a custom multi-select listbox.
- The level selector is a radio group.
- The result count is a live region; it announces "12 families" after each change, debounced 300 ms.
- Focus is always visible (2 px `--accent` ring). Every control works by keyboard, and contrast is AA or better (check the muted text on `--accent-soft`).

---

## 10. Stack and structure

React 18 + TypeScript + Vite. No state library: `useFilterState` (Appendix B) and `useMemo` are enough. Tailwind or CSS modules, as the team prefers. If the team is already on Next.js, nothing changes: `filters.ts` is plain TypeScript.

```
src/
  lib/filters.ts            ← Appendix A (copy as is)
  lib/useFilterState.ts     ← Appendix B
  components/
    ClientSearch.tsx        ← 5.1
    WealthFilter.tsx        ← 5.2
    SectorFilter.tsx        ← 5.3
    FilterChips.tsx         ← 5.4
    ClientTable.tsx         ← 5.5
    EmptyState.tsx          ← 5.6
  pages/ClientsPage.tsx     ← composes it: useFilterState → applyFilters → sortClients → table
scripts/
  build-index.ts            ← Appendix C
  simulate.ts               ← Appendix D
public/clients.all.json     ← generated
```

The core of `ClientsPage`:

```tsx
const { state, update, clearFilters } = useFilterState();
const visible = useMemo(() => sortClients(applyFilters(clients, state), state, new Date()), [clients, state]);
const counts  = useMemo(() => facetCounts(clients, state), [clients, state]);
// sector dropdown: onChange={(next) => update(s => withSectors(s, next))}
```

---

## 11. Acceptance tests

Run on the **4 real families** (`?data=real`). The same results hold in the 150-family book, plus simulated rows.

| # | Do | Expect |
|---|---|---|
| 1 | Type `sa` | Hint "Type 3 letters"; no results |
| 2 | Type `sam` | Samantha Lewis |
| 3 | Type `oli` | Daniel & Emily Johnson, labelled "Child · Oliver" |
| 4 | Type `upr` | Timothy & Melanie Weah, "Holds UPRO" |
| 5 | Type `vti` | All 4 families |
| 6 | Type `col`, pick the **Goals** chip | Johnson (Aug 2033), Lewis (Aug 2028), Weah (Aug 2038) |
| 7 | Type `sam mia` / `sam aus` | Samantha / nothing |
| 8 | Type `MÉLANIE` | Weah family ("Co-client · Melanie") |
| 9 | Wealth: $200K – $600K | Michael Carter, Daniel & Emily Johnson |
| 10 | Also tick $1M – $2M | + Samantha Lewis (OR inside the dropdown) |
| 11 | Wealth: $600K – $1M only | Timothy & Melanie Weah |
| 12 | Wealth: Under $200K or $2M and over | Empty state (no real family is there) |
| 13 | Sector: Healthcare (10%) | Michael Carter (10.5%), Samantha Lewis (12.2%) |
| 14 | Sector: Basic Materials (10%) | Empty state naming the Weahs at 3.9%; "Show any exposure" shows all 4 |
| 15 | Sector: Tech & Comms | Sort switches to Exposure %: Johnson 44.5%, Carter 40.8%, Lewis 38.3%, Weah 37.2%. Switch to Exposure $: Lewis $108.6K, Johnson $83.2K, Weah $60.5K, Carter $41.2K. Clear the sector → sort goes back to Next milestone |
| 16 | Wealth $200K – $600K **and** Sector Healthcare | Michael Carter only (AND across) |
| 17 | Wealth $600K – $1M + $1M – $2M, then type `col` | Panel: Lewis and Weah; Johnson under "Hidden by your filters" |
| 18 | Set filters, open a client, press Back | Same filters and list |
| 19 | Set filters, reload, close the tab, reopen `/clients` | Filters restored; search text **not** restored |
| 20 | Open `/clients?wealth=foo,1m-2m&sector=crypto&minExp=13` | Page loads with only $1M – $2M applied; no error |
| 21 | Default sort | Carter (home, Jan 2027) → Weah (vehicle, Jul 2028) → Lewis (college, Aug 2028) → Johnson (college, Aug 2033) |
| 22 | Hover Samantha's exposure | "Technology 30.6% + Communication Services 7.7%" |

Rows 1–17 and 20–21 are already checked in code (Appendix E).

---

## 12. Build order for today

The hand-in is at **16:45**. With one person on this it is about 4 hours; split across 2–3 people it is about 2.5 hours.

| Step | Time | Done when |
|---|---|---|
| 1. Scaffold, copy Appendices A–D, generate JSON, plain table | 30 min | 150 rows render |
| 2. Wealth + sector dropdowns, chips, counts, `useFilterState` | 60 min | Tests 9–16, 18–20 pass |
| 3. Search combobox + scope chips + "hidden by filters" | 60 min | Tests 1–8, 17 pass |
| 4. Sort, exposure column, tooltips, empty states | 40 min | Tests 14, 15, 21, 22 pass |
| 5. Styling pass (§8), keyboard and focus check | 30 min | Looks like the video's product |
| 6. Record the demo (§13) | 20 min | Video file |

If time runs short, cut in this order: recently opened → mobile layout → level selector (hard-code 10%) → "hidden by filters". **Don't cut** the counts or the chips. They are what make the filters feel kept.

---

## 13. Demo script (about 60 seconds)

1. "David has 150 families. Before, his home was a pipeline of prospects. This is his book."
2. Type **`oli`** → "He remembers the kid, not the surname." → Daniel & Emily Johnson.
3. "Tech falls 30%. Who do I call first?" Pick **Technology & Communications** → the list re-sorts by exposure. At the top is Kevin Reyes (SIM): $175.5K net worth, 56.6% of his stocks in tech. "The most exposed family is not the richest one."
4. Tick **$1M – $2M** → the chips show both filters and the counts update. Open a client, press Back → "Filters are still here."
5. "Every family sees their own number, and nobody is sorted by wealth by default."

---

## 14. Open questions for the team

1. **Wealth basis:** net worth (chosen, D1), or a toggle with investable assets?
2. **Sector groups:** is folding Communication Services into Technology OK (D3)? The alternative keeps Technology pure so it matches the plan's numbers exactly, and puts Communication Services with Consumer.
3. **Default level:** 10% of stock holdings (D4)?
4. **Stack:** React + Vite assumed. Say if you are on Next.js, Vue or Streamlit.
5. **Row click:** open the Sherpas plan (real families), or do you have your own client page?

---

## Appendix A — `filters.ts` (all the logic)

```ts
// filters.ts — pure logic, no UI. Same code goes in the spec.

export type WealthBandId = "lt200k" | "200k-600k" | "600k-1m" | "1m-2m" | "gte2m";
export type SectorGroupId =
  | "technology" | "financials" | "healthcare" | "consumer"
  | "industrials" | "energy" | "materials";

export interface ClientSummary {
  id: string;                     // case slug, e.g. "samantha-lewis"
  displayName: string;            // "Samantha Lewis", "Timothy & Melanie Weah"
  familyName: string;             // "Lewis"
  members: { firstName: string; role: "client" | "co-client" | "child"; age: number }[];
  city: string; state: string;
  netWorth: number;               // USD, drives the wealth filter
  investableAssets: number;       // USD, shown, not filtered
  equityExposure: number;         // USD in stocks, base for $ sector exposure
  score: { value: number; band: string; colour: "green" | "yellow" | "red" };
  sectorWeights: Record<string, number>; // raw Morningstar sector -> share of equity (0..1)
  holdings: { ticker: string; name: string }[];
  goals: { name: string; type: string; date: string }[]; // ISO dates, future-dated plan moments
  planUrl?: string;
  simulated: boolean;
}

export const WEALTH_BANDS: { id: WealthBandId; label: string; min: number; max: number }[] = [
  { id: "lt200k",    label: "Under $200K",     min: -Infinity,  max: 200_000 },
  { id: "200k-600k", label: "$200K – $600K",   min: 200_000,    max: 600_000 },
  { id: "600k-1m",   label: "$600K – $1M",     min: 600_000,    max: 1_000_000 },
  { id: "1m-2m",     label: "$1M – $2M",       min: 1_000_000,  max: 2_000_000 },
  { id: "gte2m",     label: "$2M and over",    min: 2_000_000,  max: Infinity },
];
// min inclusive, max exclusive: exactly $600,000 is "$600K – $1M".
export const bandOf = (netWorth: number): WealthBandId =>
  WEALTH_BANDS.find(b => netWorth >= b.min && netWorth < b.max)!.id;

export const SECTOR_GROUPS: { id: SectorGroupId; label: string; sources: string[] }[] = [
  { id: "technology",  label: "Technology & Communications", sources: ["Technology", "Communication Services"] },
  { id: "financials",  label: "Financials & Real Estate",    sources: ["Financial Services", "Real Estate"] },
  { id: "healthcare",  label: "Healthcare",                  sources: ["Healthcare"] },
  { id: "consumer",    label: "Consumer",                    sources: ["Consumer Cyclical", "Consumer Defensive"] },
  { id: "industrials", label: "Industrials",                 sources: ["Industrials"] },
  { id: "energy",      label: "Energy & Utilities",          sources: ["Energy", "Utilities"] },
  { id: "materials",   label: "Basic Materials",             sources: ["Basic Materials"] },
];

export const groupWeight = (c: ClientSummary, g: SectorGroupId): number =>
  SECTOR_GROUPS.find(x => x.id === g)!.sources.reduce((s, src) => s + (c.sectorWeights[src] ?? 0), 0);

export const groupDollars = (c: ClientSummary, g: SectorGroupId): number =>
  groupWeight(c, g) * c.equityExposure;

export interface FilterState {
  q: string;                  // search text (kept in URL only)
  wealth: WealthBandId[];     // OR inside
  sectors: SectorGroupId[];   // OR inside
  minExposure: number;        // 0..1, default 0.10
  sort: SortId;
}
export type SortId = "next-milestone" | "name" | "net-worth-desc" | "score-asc" | "exposure-desc" | "exposure-usd-desc";

export const DEFAULT_FILTERS: FilterState = { q: "", wealth: [], sectors: [], minExposure: 0.10, sort: "next-milestone" };

// ---------- search ----------
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const MIN_QUERY_CHARS = 3;
export const queryIsActive = (q: string) => normalize(q).replace(/ /g, "").length >= MIN_QUERY_CHARS;

export type HitCategory = "people" | "location" | "holdings" | "goals";
export interface SearchHit { clientId: string; category: HitCategory; label: string; score: number }

const FIELD_WEIGHT: Record<HitCategory, number> = { people: 100, holdings: 70, location: 60, goals: 40 };

function fieldsOf(c: ClientSummary): { category: HitCategory; label: string; text: string }[] {
  return [
    { category: "people", label: c.displayName, text: c.displayName },
    ...c.members.map(m => ({ category: "people" as const, label: `${roleLabel(m.role)} · ${m.firstName}`, text: m.firstName })),
    { category: "location", label: `${c.city}, ${c.state}`, text: `${c.city} ${c.state}` },
    ...c.holdings.filter(h => h.ticker).map(h => ({ category: "holdings" as const, label: `Holds ${h.ticker}`, text: `${h.ticker} ${h.name}` })),
    ...c.goals.map(g => ({ category: "goals" as const, label: `${g.name} · ${monthYear(g.date)}`, text: g.name })),
  ];
}
const roleLabel = (r: string) => (r === "co-client" ? "Co-client" : r === "child" ? "Child" : "Client");
const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Every query token must match some field of the client (AND across tokens).
// A token matches a field at a word start (strong) or anywhere (weak).
// `scope` = the chip picked in the results panel ("Holdings" only looks at holdings, etc.).
export function searchClients(clients: ClientSummary[], q: string, scope?: HitCategory): SearchHit[] {
  if (!queryIsActive(q)) return [];
  const tokens = normalize(q).split(" ").filter(Boolean);
  const hits: SearchHit[] = [];
  for (const c of clients) {
    const fields = fieldsOf(c)
      .filter(f => !scope || f.category === scope)
      .map(f => ({ ...f, norm: normalize(f.text) }));
    let best: SearchHit | null = null;
    let allTokensFound = true;
    for (const t of tokens) {
      let tokenBest: SearchHit | null = null;
      for (const f of fields) {
        const words = f.norm.split(/[^a-z0-9]+/);
        const prefix = words.some(w => w.startsWith(t));
        const inside = !prefix && f.norm.includes(t);
        if (!prefix && !inside) continue;
        const s = FIELD_WEIGHT[f.category] * (prefix ? 1 : 0.5) + (f.norm === t ? 20 : 0);
        if (!tokenBest || s > tokenBest.score) tokenBest = { clientId: c.id, category: f.category, label: f.label, score: s };
      }
      if (!tokenBest) { allTokensFound = false; break; }
      if (!best || tokenBest.score > best.score) best = tokenBest;
    }
    if (allTokensFound && best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score || a.clientId.localeCompare(b.clientId));
}

// ---------- filters ----------
export const matchesWealth = (c: ClientSummary, f: FilterState) =>
  f.wealth.length === 0 || f.wealth.includes(bandOf(c.netWorth));

export const matchesSectors = (c: ClientSummary, f: FilterState) =>
  f.sectors.length === 0 || f.sectors.some(g => groupWeight(c, g) >= f.minExposure - 1e-9);

export function applyFilters(clients: ClientSummary[], f: FilterState): ClientSummary[] {
  const hitIds = queryIsActive(f.q) ? new Set(searchClients(clients, f.q).map(h => h.clientId)) : null;
  return clients.filter(c => (!hitIds || hitIds.has(c.id)) && matchesWealth(c, f) && matchesSectors(c, f));
}

// Reason shown next to a search match that the active filters hide (D9).
export function whyHidden(c: ClientSummary, f: FilterState): string[] {
  const out: string[] = [];
  if (!matchesWealth(c, f))
    out.push(`not in ${f.wealth.map(id => WEALTH_BANDS.find(b => b.id === id)!.label).join(", ")}`);
  if (!matchesSectors(c, f))
    out.push(`under ${Math.round(f.minExposure * 100)}% in ${f.sectors.map(id => SECTOR_GROUPS.find(g => g.id === id)!.label).join(", ")}`);
  return out;
}

// Counts shown next to each option. Each facet ignores its own selection
// (so ticking one band never turns the other bands into 0).
export function facetCounts(clients: ClientSummary[], f: FilterState) {
  const wealthBase = applyFilters(clients, { ...f, wealth: [] });
  const sectorBase = applyFilters(clients, { ...f, sectors: [] });
  return {
    wealth: Object.fromEntries(WEALTH_BANDS.map(b => [b.id, wealthBase.filter(c => bandOf(c.netWorth) === b.id).length])),
    sectors: Object.fromEntries(SECTOR_GROUPS.map(g => [g.id, sectorBase.filter(c => groupWeight(c, g.id) >= f.minExposure - 1e-9).length])),
  } as { wealth: Record<WealthBandId, number>; sectors: Record<SectorGroupId, number> };
}

// Next one-off milestone in the plan. The yearly vacation is skipped: every family
// has one in January, so it would hide the moments that matter (home, college, car).
export function nextMilestone(c: ClientSummary, today: Date) {
  return c.goals
    .filter(g => g.type !== "VACATION" && new Date(g.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function sortClients(list: ClientSummary[], f: FilterState, today: Date): ClientSummary[] {
  const byName = (a: ClientSummary, b: ClientSummary) => a.familyName.localeCompare(b.familyName);
  const share = (c: ClientSummary) => f.sectors.reduce((s, g) => s + groupWeight(c, g), 0);
  const dollars = (c: ClientSummary) => f.sectors.reduce((s, g) => s + groupDollars(c, g), 0);
  const cmp: Record<SortId, (a: ClientSummary, b: ClientSummary) => number> = {
    "next-milestone": (a, b) =>
      (nextMilestone(a, today)?.date ?? "9999").localeCompare(nextMilestone(b, today)?.date ?? "9999") || byName(a, b),
    "name": byName,
    "net-worth-desc": (a, b) => b.netWorth - a.netWorth || byName(a, b),
    "score-asc": (a, b) => a.score.value - b.score.value || byName(a, b),
    // Share of the family's own stock holdings: a $150K family with 45% in tech ranks above
    // a $3M family with 30%. Dollars only break ties (D10).
    "exposure-desc": (a, b) => share(b) - share(a) || dollars(b) - dollars(a) || byName(a, b),
    "exposure-usd-desc": (a, b) => dollars(b) - dollars(a) || byName(a, b),
  };
  return [...list].sort(cmp[f.sort]);
}

// Picking the first sector switches the sort to exposure (the advisor's question is
// "who is most exposed?"). Clearing the sectors switches it back. A sort the advisor
// chose by hand is never overridden.
const isExposureSort = (s: SortId) => s === "exposure-desc" || s === "exposure-usd-desc";
export function withSectors(f: FilterState, sectors: SectorGroupId[]): FilterState {
  let sort = f.sort;
  if (f.sectors.length === 0 && sectors.length > 0 && f.sort === DEFAULT_FILTERS.sort) sort = "exposure-desc";
  if (sectors.length === 0 && isExposureSort(f.sort)) sort = DEFAULT_FILTERS.sort;
  return { ...f, sectors, sort };
}

// ---------- URL <-> state ----------
const WEALTH_IDS = new Set(WEALTH_BANDS.map(b => b.id));
const SECTOR_IDS = new Set(SECTOR_GROUPS.map(g => g.id));
const SORT_IDS = new Set<SortId>(["next-milestone", "name", "net-worth-desc", "score-asc", "exposure-desc", "exposure-usd-desc"]);
const EXPOSURE_STEPS = [0, 0.05, 0.10, 0.20, 0.30];

export function toSearchParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.wealth.length) p.set("wealth", f.wealth.join(","));
  if (f.sectors.length) p.set("sector", f.sectors.join(","));
  if (f.minExposure !== DEFAULT_FILTERS.minExposure) p.set("minExp", String(Math.round(f.minExposure * 100)));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  return p;
}

// Unknown or broken values are dropped, never thrown.
export function fromSearchParams(p: URLSearchParams): FilterState {
  const list = (k: string) => (p.get(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const minExp = Number(p.get("minExp")) / 100;
  const sectors = [...new Set(list("sector"))].filter((x): x is SectorGroupId => SECTOR_IDS.has(x as SectorGroupId));
  let sort = SORT_IDS.has(p.get("sort") as SortId) ? (p.get("sort") as SortId) : DEFAULT_FILTERS.sort;
  if (isExposureSort(sort) && sectors.length === 0) sort = DEFAULT_FILTERS.sort;  // nothing to rank by
  return {
    q: p.get("q") ?? "",
    wealth: [...new Set(list("wealth"))].filter((x): x is WealthBandId => WEALTH_IDS.has(x as WealthBandId)),
    sectors,
    minExposure: p.has("minExp") && EXPOSURE_STEPS.includes(minExp) ? minExp : DEFAULT_FILTERS.minExposure,
    sort,
  };
}
```

## Appendix B — `useFilterState.ts` (URL + localStorage)

```ts
// useFilterState.ts — keeps the menu's filters in the URL (source of truth) and in localStorage.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, fromSearchParams, toSearchParams, type FilterState } from "./filters.ts";

const STORAGE_KEY = "sherpas.clientMenu.filters.v1";
const FILTER_KEYS = ["wealth", "sector", "minExp", "sort"];

function initialState(): FilterState {
  const url = new URLSearchParams(window.location.search);
  const q = url.get("q") ?? "";
  if (FILTER_KEYS.some(k => url.has(k))) return fromSearchParams(url);       // 1. a link wins
  try {
    const saved = localStorage.getItem(STORAGE_KEY);                          // 2. last session
    if (saved) return { ...fromSearchParams(new URLSearchParams(saved)), q };
  } catch { /* storage blocked (private mode, iframe): use defaults */ }
  return { ...DEFAULT_FILTERS, q };                                           // 3. defaults
}

export function useFilterState() {
  const [state, setState] = useState<FilterState>(initialState);

  // Every change: rewrite the URL without adding history entries, and save the filters
  // (not the search text) for next time.
  useEffect(() => {
    const params = toSearchParams(state);
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    params.delete("q");
    try { localStorage.setItem(STORAGE_KEY, params.toString()); } catch { /* ignore */ }
  }, [state]);

  // Browser back/forward into this page restores what that URL says.
  useEffect(() => {
    const onPop = () => setState(fromSearchParams(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const update = useCallback(
    (next: Partial<FilterState> | ((s: FilterState) => FilterState)) =>
      setState(s => (typeof next === "function" ? next(s) : { ...s, ...next })),
    [],
  );
  const clearFilters = useCallback(() => setState(s => ({ ...DEFAULT_FILTERS, q: s.q })), []);
  return { state, update, clearFilters };
}
```

## Appendix C — `scripts/build-index.ts`

```ts
// build-index.ts — run once: node --experimental-strip-types build-index.ts <repo>/cases > public/clients.index.json
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientSummary } from "./filters.ts";

const PLAN_URLS: Record<string, string> = {
  "timothy-melanie-weah": "https://app.sherpaswealth.com/plan/shared/RcCtgoNkGmD6dvGtYVKWLGefdCTFdc4JP_jH9Jbz2jo",
  "michael-carter":       "https://app.sherpaswealth.com/plan/shared/ZshH0AUJjZnvwKIYtP5wYKyvI6Nc1nsGwQlDncXLfek",
  "daniel-emily-johnson": "https://app.sherpaswealth.com/plan/shared/FjVPq_UEwSMxaye8aOWj3osJWWSE3cDnYWcxm1X7I78",
  "samantha-lewis":       "https://app.sherpaswealth.com/plan/shared/vyV2h64-qSet-sJuwkAHxw-iUaYV88Lkwsg29L2Y5y8",
};
const SKIP_GOAL_TYPES = new Set(["BANKRUPTCY", "BANKRUPTCY_ZEROCASH"]); // projection markers, not life moments
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const casesDir = process.argv[2];
const out: ClientSummary[] = [];
for (const slug of readdirSync(casesDir).sort()) {
  const fh = JSON.parse(readFileSync(join(casesDir, slug, "financial-health.json"), "utf8"));
  const ia = JSON.parse(readFileSync(join(casesDir, slug, "investment-analysis.json"), "utf8"));
  const hh = fh.case.household as any[];
  const adults = hh.filter(m => m.role !== "child").map(m => m.first_name);
  const familyName = cap(slug.split("-").at(-1)!);
  const cd = ia.key_metrics.concentrationAndDiversification;
  const tickers = new Map<string, string>();
  for (const p of ia.positions) if (p.ticker) tickers.set(p.ticker, p.name);
  out.push({
    id: slug,
    displayName: `${adults.join(" & ")} ${familyName}`,
    familyName,
    members: hh.map(m => ({ firstName: m.first_name, role: m.role, age: m.age })),
    city: fh.case.city, state: fh.case.state,
    netWorth: fh.key_metrics.netWorthStatement.netWorth.total,
    investableAssets: fh.key_metrics.ratios.investableAssetLevel.investableAssets,
    equityExposure: cd.totals.equityExposure,
    score: { value: fh.score.published_score, band: fh.score.band, colour: fh.score.colour },
    sectorWeights: Object.fromEntries((cd.sectorConcentration as any[]).slice(1).map(r => [r[0], r[1]])),
    holdings: [...tickers].map(([ticker, name]) => ({ ticker, name })),
    goals: (fh.goals.chartGoals as any[])
      .filter(g => g.name && !SKIP_GOAL_TYPES.has(g.goalType))
      .map(g => ({ name: g.name, type: g.goalType, date: g.date })),
    planUrl: PLAN_URLS[slug],
    simulated: false,
  });
}
process.stdout.write(JSON.stringify(out, null, 2));
```

## Appendix D — `scripts/simulate.ts`

```ts
// simulate.ts — adds labelled synthetic families so the menu has ~150 rows.
// node --experimental-strip-types simulate.ts public/clients.index.json 146 > public/clients.all.json
import { readFileSync } from "node:fs";
import type { ClientSummary } from "./filters.ts";
import { WEALTH_BANDS } from "./filters.ts";

let seed = 20261121;                                   // fixed seed: same data on every run
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (lo: number, hi: number) => lo + rnd() * (hi - lo);

const FIRST = ["James","Maria","Robert","Linda","David","Sofia","Kevin","Grace","Brian","Nina","Omar","Hannah","Lucas","Priya","Ethan","Chloe","Marcus","Elena","Tyler","Aisha"];
const LAST  = ["Nguyen","Garcia","Patel","Brooks","Kim","Rivera","Cohen","Murphy","Okafor","Schultz","Reyes","Hughes","Silva","Turner","Park","Bennett","Foster","Ramos","Price","Ward"];
const CITIES: [string, string][] = [["Seattle","WA"],["Chicago","IL"],["Boston","MA"],["Phoenix","AZ"],["Atlanta","GA"],["Raleigh","NC"],["Houston","TX"],["Portland","OR"],["Nashville","TN"],["San Diego","CA"]];
// Share of families per band (adds to 1). Gives every option in the menu something to show.
const BAND_MIX: [number, number][] = [[0, .17], [1, .30], [2, .23], [3, .20], [4, .10]];
// A few tilted books so sector filters are worth testing (energy-heavy, healthcare-heavy...).
const TILTS: Record<string, number>[] = [{}, {}, {}, { Energy: .14, Utilities: .05 }, { Healthcare: .12 }, { "Basic Materials": .09 }, { Technology: .20 }, { "Financial Services": .10, "Real Estate": .06 }, { Industrials: .08 }];

// Band cut-offs are a guess for fake rows only; real rows keep the plan's own band and colour.
const simScore = (value: number): ClientSummary["score"] =>
  value >= 75 ? { value, band: "strong", colour: "green" } : value >= 60 ? { value, band: "stable", colour: "yellow" }
  : value >= 40 ? { value, band: "vulnerable", colour: "red" } : { value, band: "critical", colour: "red" };

export function simulate(real: ClientSummary[], n: number): ClientSummary[] {
  const out: ClientSummary[] = [];
  for (let i = 0; i < n; i++) {
    const t = real[i % real.length];                                    // template family
    let r = rnd(), b = 0; for (const [idx, p] of BAND_MIX) { if (r < p) { b = idx; break; } r -= p; }
    const band = WEALTH_BANDS[b];
    const netWorth = Math.round(between(Math.max(band.min, 40_000), Math.min(band.max, 6_000_000)) / 500) * 500;
    const k = netWorth / t.netWorth;                                     // scale money with wealth
    const w: Record<string, number> = {};
    for (const [s, v] of Object.entries(t.sectorWeights)) w[s] = Math.max(0, v * between(.8, 1.2));
    for (const [s, add] of Object.entries(pick(TILTS))) w[s] = (w[s] ?? 0) + add;
    const total = Object.values(w).reduce((a, x) => a + x, 0);
    for (const s in w) w[s] /= total;                                    // weights add back to 1
    const last = pick(LAST), first = pick(FIRST), [city, state] = pick(CITIES), age = Math.round(between(30, 70));
    out.push({
      ...t,
      id: `sim-${String(i + 1).padStart(3, "0")}`,
      displayName: `${first} ${last}`, familyName: last,
      members: [{ firstName: first, role: "client", age }],
      city, state, netWorth,
      investableAssets: Math.round(t.investableAssets * k), equityExposure: Math.round(t.equityExposure * k),
      score: simScore(Math.round(between(20, 95))),
      goals: t.goals.map(g => g.type !== "RETIREMENT" ? { ...g, name: g.type === "COLLEGE" ? "College" : g.name }
        : { ...g, name: `${first}'s Retirement`, date: `${2026 + Math.max(1, 65 - age)}-06-01T00:00:00.000Z` }),
      sectorWeights: w, planUrl: undefined, simulated: true,
    });
  }
  return out;
}

const real: ClientSummary[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
process.stdout.write(JSON.stringify([...real, ...simulate(real, Number(process.argv[3] ?? 146))], null, 2));
```

## Appendix E — logic checks

The file `test.ts` below was run against the real `cases/` data: `node --experimental-strip-types test.ts` → `ALL ASSERTS PASSED`. All four `.ts` files above also pass `tsc --strict`.

```ts
// test.ts — node --experimental-strip-types test.ts  (needs clients.index.json from build-index.ts)
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as F from "./filters.ts";

const clients: F.ClientSummary[] = JSON.parse(readFileSync("clients.index.json", "utf8"));
const S = (over: Partial<F.FilterState>) => ({ ...F.DEFAULT_FILTERS, ...over });
const ids = (l: { id: string }[]) => l.map(c => c.id).sort();
const hits = (q: string, scope?: F.HitCategory) => F.searchClients(clients, q, scope);
const hitIds = (q: string, scope?: F.HitCategory) => hits(q, scope).map(h => h.clientId).sort();
const list = (f: Partial<F.FilterState>) => ids(F.applyFilters(clients, S(f)));
const today = new Date("2026-11-21T00:00:00Z");
const [JOHNSON, CARTER, LEWIS, WEAH] = ["daniel-emily-johnson", "michael-carter", "samantha-lewis", "timothy-melanie-weah"];

// 1. under 3 letters: nothing (spaces don't count)
assert.deepEqual(hits("sa"), []);
assert.deepEqual(hits(" s a "), []);
// 2-5. people, children, tickers
assert.deepEqual(hitIds("sam"), [LEWIS]);
assert.deepEqual(hits("oli").map(h => h.label), ["Child · Oliver"]);
assert.deepEqual(hits("upr").map(h => [h.clientId, h.label]), [[WEAH, "Holds UPRO"]]);
assert.deepEqual(hitIds("vti"), [JOHNSON, CARTER, LEWIS, WEAH]);
// 6. goals scope
assert.deepEqual(hits("col", "goals").map(h => h.label),
  ["College Oliver · Aug 2033", "College Ava · Aug 2028", "College Liam · Aug 2038"]);
assert.deepEqual(hits("col", "people"), []);
// 7. every word must match
assert.deepEqual(hitIds("sam mia"), [LEWIS]);
assert.deepEqual(hitIds("sam aus"), []);
// 8. case and accents
assert.deepEqual(hits("MÉLANIE").map(h => h.label), ["Co-client · Melanie"]);
// 9-12. wealth (OR inside)
assert.deepEqual(list({ wealth: ["200k-600k"] }), [JOHNSON, CARTER]);
assert.deepEqual(list({ wealth: ["200k-600k", "1m-2m"] }), [JOHNSON, CARTER, LEWIS]);
assert.deepEqual(list({ wealth: ["600k-1m"] }), [WEAH]);
assert.deepEqual(list({ wealth: ["lt200k", "gte2m"] }), []);
assert.equal(F.bandOf(600_000), "600k-1m");
assert.equal(F.bandOf(199_999), "lt200k");
assert.equal(F.bandOf(-50_000), "lt200k");
assert.equal(F.bandOf(2_000_000), "gte2m");
// 13-14. sectors at the default 10% level
assert.deepEqual(list({ sectors: ["healthcare"] }), [CARTER, LEWIS]);
assert.deepEqual(list({ sectors: ["materials"] }), []);
assert.deepEqual(list({ sectors: ["materials"], minExposure: 0 }), [JOHNSON, CARTER, LEWIS, WEAH]);
const topMaterials = [...clients].sort((a, b) => F.groupWeight(b, "materials") - F.groupWeight(a, "materials"))[0];
assert.equal(topMaterials.id, WEAH);
assert.equal((F.groupWeight(topMaterials, "materials") * 100).toFixed(1), "3.9");
// 15. picking a sector switches the sort to exposure: share of own stocks first, $ as option
const tech = F.withSectors(F.DEFAULT_FILTERS, ["technology"]);
assert.equal(tech.sort, "exposure-desc");
assert.deepEqual(F.sortClients(F.applyFilters(clients, tech), tech, today)
  .map(c => [c.id, +(F.groupWeight(c, "technology") * 100).toFixed(1)]),
  [[JOHNSON, 44.5], [CARTER, 40.8], [LEWIS, 38.3], [WEAH, 37.2]]);
const techUsd = { ...tech, sort: "exposure-usd-desc" as const };
assert.deepEqual(F.sortClients(F.applyFilters(clients, techUsd), techUsd, today)
  .map(c => [c.id, Math.round(F.groupDollars(c, "technology") / 100) / 10]),
  [[LEWIS, 108.6], [JOHNSON, 83.2], [WEAH, 60.5], [CARTER, 41.2]]);
assert.equal(F.withSectors(tech, []).sort, "next-milestone");
assert.equal(F.withSectors(techUsd, []).sort, "next-milestone");
assert.equal(F.withSectors(S({ sort: "name" }), ["energy"]).sort, "name");
// 16. AND across filters
assert.deepEqual(list({ wealth: ["200k-600k"], sectors: ["healthcare"] }), [CARTER]);
// 17. search + filters: shown vs hidden, with the reason
const f17 = S({ q: "col", wealth: ["600k-1m", "1m-2m"] });
assert.deepEqual(ids(F.applyFilters(clients, f17)), [LEWIS, WEAH]);
const hidden = clients.filter(c => hitIds("col").includes(c.id) && !ids(F.applyFilters(clients, f17)).includes(c.id));
assert.deepEqual(hidden.map(c => [c.id, F.whyHidden(c, f17)]), [[JOHNSON, ["not in $600K – $1M, $1M – $2M"]]]);
// counts ignore their own dropdown
assert.deepEqual(F.facetCounts(clients, S({ wealth: ["200k-600k"] })).wealth,
  { lt200k: 0, "200k-600k": 2, "600k-1m": 1, "1m-2m": 1, gte2m: 0 });
// 20. URL round trip; junk is dropped, never thrown
const st = S({ q: "sam", wealth: ["1m-2m", "600k-1m"], sectors: ["technology"], minExposure: 0.2, sort: "exposure-desc" });
assert.deepEqual(F.fromSearchParams(F.toSearchParams(st)), st);
assert.deepEqual(F.fromSearchParams(new URLSearchParams("wealth=foo,1m-2m,1m-2m&sector=crypto&minExp=13&sort=bad")), S({ wealth: ["1m-2m"] }));
assert.deepEqual(F.fromSearchParams(new URLSearchParams("minExp=0")), S({ minExposure: 0 }));
assert.equal(F.fromSearchParams(new URLSearchParams("sort=exposure-desc")).sort, "next-milestone"); // no sector, no exposure sort
// 21. default sort: next one-off milestone (yearly vacation skipped)
assert.deepEqual(F.sortClients(clients, F.DEFAULT_FILTERS, today).map(c => [c.id, F.nextMilestone(c, today)?.name]),
  [[CARTER, "Purchase a home"], [WEAH, "Purchase a vehicle"], [LEWIS, "College Ava"], [JOHNSON, "College Oliver"]]);
// 22. exposure tooltip numbers reconcile with the plan
const lewis = clients.find(c => c.id === LEWIS)!;
assert.equal((lewis.sectorWeights["Technology"] * 100).toFixed(1), "30.6");
assert.equal((lewis.sectorWeights["Communication Services"] * 100).toFixed(1), "7.7");
assert.equal((F.groupWeight(lewis, "technology") * 100).toFixed(1), "38.3");

console.log("ALL ASSERTS PASSED");
```
