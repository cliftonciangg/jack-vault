# Jack Vault — Back Office design canvas files

Source files for the Claude Design canvas "Jack Vault — Back Office", built from `backoffice-design-prompts.md` (Prompts 0–15). Kept as a separate canvas from the game so the neon style does not leak in.

- `project/canvas.json` — the canvas index: every artboard's position, size and title, plus the row titles.
- `project/*.dc.html` — one file per artboard. Each is a self-contained Design Component (HTML, inline styles, a small logic block). Open the canvas on claude.ai to view and edit visually; these files are the exact source behind it. Sidebar items and most buttons are real links, so the canvas clicks through as a prototype in Play.

## Artboards by prompt

| Prompt | Files |
|---|---|
| 0 Style guide | `Main` (logo, color, type, buttons, forms), `Tables` (tables, dialogs, icons, spacing), `Tokens` |
| 0 Shell | `Shell` (agent, 1440×900), `ShellMenus` (three sidebars), `ShellPhone` (drawer open) |
| 1 Login | `Login`, `LoginStates` (wrong, locked, disabled, 2FA, loading), `LoginPhone` |
| 2 Agent dashboard | `AgentDash`, `AgentDashPhone` |
| 3 User management | `Users` (with selected player), `UsersDialogs` (create, load, redeem, reset, disable), `UsersPhone` (action sheet) |
| 4 Transaction records | `Transactions` (with receipt dialog), `TransactionsPhone` |
| 5 Game records | `GameRecords` (with round drawer) |
| 6 Settings | `Settings` |
| 7 Distributor dashboard | `DistDash` |
| 8 Agent management | `Agents` (with Create Agent dialog), `AgentsPlayers` (read-only players) |
| 9 Coin management | `Coins` |
| 10 Win ratio | `WinRatio` (with confirm dialog) |
| 11 Agent records | `AgentRecords` |
| 12 Operator distributors | `OpDistributors` (with Issue + confirm) |
| 13 Ledger & audit | `OpLedger`, `OpAudit` (one failing check expanded) |
| 14 Win ratio & games | `OpWinRatio` |
| 15 Dialogs & states | `DialogsEmpty` |

## Decisions that differ from the prompt text

- **Blue and green darkened for contrast.** The brief's #1E88C8 and #16A34A fail WCAG AA with white text (3.9:1 and 3.3:1). Fills, table headers and panel titles use **#1A78B4** (4.8:1) and money-in / Load uses **#15803D** (5.0:1). #1E88C8 stays for focus rings and borders. Full table on the `Tokens` artboard.
- **Muted text** is #6B7280 where it must be read; #9CA3AF is kept for placeholders and decorative icons only.
- Everything marked **(needs backend)** in the prompts is labelled the same way on the artboards, in amber, so developers see it on the screen itself.

## Handoff

Copy the `Tokens` table into CSS variables in `office/index.html`. Column order and labels on each table match the API fields named in the prompts (`ISSUE`, `REVOKE`, `LOAD`, `REDEEM`; Load / Redeem for agent and distributor transfers; Issue / Take back for the operator).
