# paseo-ship-check

A ship-readiness card in the Paseo agent timeline, with the ship itself on it.

When a turn ends, the daemon checks the tree the way the [ship extension](https://github.com/frailbongat/dotfiles/tree/main/pi/agent/extensions/ship) would and appends a card to that agent's timeline: the headline, the branch line, every blocker and warning, and a **Ship** button when the branch is ready. The button appears only for a ready branch and only while the agent is idle.

Pressing it sends the command and puts the button down: no spinner, no second press, and no label that changes. The turn it starts is an ordinary turn, and Paseo's stream footer already reports a running turn, so the card would only be saying the same thing twice. The button comes back when that turn ends, or after five seconds if the command never started one. A failed send reports the reason on the card instead of sending anything.

The **Ship check** panel draws the same card, so the button is in both places and behaves the same way. The panel adds **Re-check**, which is the only thing that pays for a fresh run.

This started as a third pill in [`paseo-composer-pills`](https://github.com/frailbongat/paseo-composer-pills) and left it because a verdict is a list of blockers rather than a number: it never fitted in a pill, and its action belongs next to the reasons it is offered. That plugin still owns the Claude limit and context pills, and the two plugins share nothing at runtime.

## Install

Requires Paseo 0.8 or later with `pluginsEnabled: true` (Settings → Plugins → Enable plugins).

```bash
git clone https://github.com/frailbongat/paseo-ship-check
cd paseo-ship-check
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin ls   # expect: running
```

### The ship button needs the ship extension

Computing the verdict needs nothing but `git` plus whatever quality tools the repo already declares. **Acting** on it does: the button sends the literal text `/ship`, so the agent must be a pi session with the ship extension installed at `~/.pi/agent/extensions/ship`.

```bash
ls ~/.pi/agent/extensions/ship   # if this is empty, one-tap ship does nothing
```

Without it the card still reads correctly and the panel still reports. Only the one-tap ship goes nowhere: the agent just receives `/ship` as an ordinary message, and since the plugin hides that message (below), it answers a question that is not on screen.

### The `/ship` message is hidden

Paseo submits a provider slash command as ordinary message text, so the card's **Ship** button and a hand-typed `/ship` both leave a user row reading `/ship`. pi never treats it as conversation: the ship extension registers `ship` as a command, runs it, and the turn carries the ship's own output. A timeline transformer in `client/ship-echo.ts` drops that row, so the timeline shows what ship did instead of the keystroke that started it.

It matches on the first word, so `/ship main` and `/ship verbose` go too, and it follows the **Ship command** setting. A message with a line break is prose and stays. Only the echo is removed: ship's notices and the verdict card still show.

### The result stays pi's notice

`/ship` ends on a report: `Shipped 1a2b3c4 to origin/main.`, the commit subject, and which checks ran or why they were skipped. The extension prints it through `ctx.ui.notify`, Paseo renders it as a notification row, and this plugin leaves it alone. One ship, one line, written by the thing that did the work.

There was a card for it here, drawn from that report, and it is gone. A notification row is not a row a timeline transformer may select: the app takes `user_message`, `assistant_message`, `reasoning`, `tool_call`, `todo`, `error`, and `compaction`, and rejects the registration with `invalid item type` for anything else. Publishing the card from the daemon instead worked, but nothing removes or rewrites a row the provider wrote, so the report was on the timeline twice. The way round that was to stop the extension printing it and hand the text to the plugin through a file, which put the report's fate in a second program's hands for a line pi already prints correctly.

So the verdict card is the only card. It offers the ship; pi reports what the ship did.

## How the verdict is computed

The verdict mirrors the ship extension step for step, because a card that disagrees with `/ship` is worse than no card. The daemon recomputes it when a turn ends, through an `agent.turn_ended` lifecycle hook, and parks it per agent. That runs with no app connected, so the card and the panel read a finished verdict the moment they are on screen instead of starting a check and spinning. **Re-check ship readiness** in the Command Center (⌘K) and the panel's **Re-check** button force a fresh run.

`/ship-check` in the composer runs the same forced re-check without opening anything, so it can be typed mid-message. The card and the panel move with it.

Blockers, in the order `/ship` hits them:

1. A git operation in progress
2. Unmerged index entries
3. An unresolvable destination
4. An `origin` with no push URL
5. A sensitive path in the change set
6. A failing quality check (`prettier --check`, `eslint`, locally installed only, never `npx`)

Shown but not blocking, because `/ship` handles them: a base branch that moved (it rebases), and existing commits riding along to the trunk (it asks first). Formatter style findings are not reported at all, since `/ship` rewrites and restages those files. A formatter that cannot parse a file does block.

Undecidable checks, such as a linter running past 30s, count as blockers, never passes. One-tap ship is never offered for a branch `/ship` would refuse.

**Cost.** A cold eslint run on a large repo is over ten seconds, so results are cached per working directory, HEAD, and exact dirty state (size and mtime) of the checked files. Quality is skipped entirely while a cheaper blocker is unresolved. Only the manual re-check forces past the cache.

## Where the card lands

Each turn with something to ship gets its own card, so the card is always in the turn you are reading. That is a deliberate cost. Paseo replaces a re-appended row where it already sits rather than moving it down, so reusing one id per agent parks the card at the turn it first appeared in and updates it there, out of sight.

Every turn end retires the cards before it: each one is re-appended as stale, keeping its verdict and its button as that turn's history while going grey, with the button disabled and the footer reading `no longer current`. At most one card can ship, which is the point, because the tree the older ones described has moved on. The cards to retire are read out of the turn-end event's own timeline snapshot, not out of anything the plugin remembers, so a card left by an earlier load of the plugin is retired too instead of keeping a live button forever.

A turn that ends with a clean tree retires the same way and publishes nothing, so a quiet turn stays quiet. A re-check is different: `/ship-check`, the Command Center item, and the panel's **Re-check** all reuse the current turn's id, so they correct the card on screen, blockers cleared and all, instead of stacking another. The first card waits until there is something to ship.

### Reloading a chat takes the card, so it is published again

A plugin row lives in the daemon's timeline store and nowhere else, so it survives scroll, refetch, and reconnect. It does not survive a rebuild. Reloading an agent, and opening one the daemon has since unloaded, both throw that store away and re-stream the provider's own history in its place: messages, tool calls, notices, and nothing this plugin ever wrote. A reloaded chat used to come back with no card at all, and the next turn end was the earliest anything would draw one.

Nothing announces the rebuild. `agent.timeline.replacement` is minted by rewind alone, and a resume or a reload says nothing, so `server/timeline-restore.ts` hangs off `agent.session_open` instead and republishes from there. That hook runs *before* the wipe, so it waits: two consecutive timeline fetches that agree on epoch and last sequence mean the rebuild has stopped moving. The verdict is then computed fresh rather than read from the cache, because the tree can have moved while the daemon was not watching and the restored card carries a live ship button. The append is checked four seconds later and repeated once if a late wipe took it.

What the ship itself did is not this plugin's to restore: the report is pi's own notice, and a rebuild re-streams it with the rest of the provider's history.

The card lays out for the window it is in. A wide one puts the ship button on the headline row; a compact one stacks it full width under the headline. Blockers and warnings sit below a full-bleed rule, the passed count and the check time below a second one.

## Settings

**Settings → Plugins → Ship check**, or `Ship check settings` in the Command Center (⌘K). The value is host-scoped: every client of that daemon shares it, and it survives reload and restart.

| Setting | Default | What it changes |
| --- | --- | --- |
| Ship command | `/ship` | The text the card's **Ship** button sends, in the timeline and in the panel. Also what the echo transformer hides. |
| Font | System | The card's typeface: the client's own text, a serif, or a monospace. Each resolves on every platform Paseo runs on. |
| Custom font family | empty | A font family of your own, which wins over **Font** while it is set. A name the client cannot resolve falls back to its own text. |
| Text size | Default | Small, default, or large. |

Text size is a scale over the whole card, not a font size for one line. The card's measurements are tuned against each other, so text, leading, padding, gaps, icons, and the ship button are all multiplied by the same number and a large card is the same card seen closer. `client/card-type.ts` holds the font stacks and the scales; the screen carries a blocked sample card under the controls, which is a real `ShipCard` reading the same store the timeline reads.

The selects save as you pick. The two text fields save on their own **Save**, so a half-typed font family never reaches the card.

The timeline transformer answers synchronously and runs outside React, where no hook can be called, so `client/settings-sync.ts` reads the document over the settings RPC into `client/settings-store.ts` and re-reads it every 60s. Saving in the screen writes the same store, so a change lands on the card already on screen.

## Read by other plugins

[`paseo-turn-summary`](https://github.com/frailbongat/paseo-turn-summary) reads the row this plugin publishes rather than running its own git and lint pass, so its ship light and this card can never disagree. The coupling is the plugin id, the row kind `ship-blockers`, and four fields on the row. When this plugin is missing or has not published for an agent, that light goes grey and its ship button stays hidden.

## Files

| File | Runtime | Role |
| --- | --- | --- |
| `index.client.tsx` | client | Registers the settings screen, the panel, the Command Center items, the `/ship-check` slash command, the timeline transformer and renderer |
| `index.server.ts` | server | Registers the settings document, the RPC handlers, the turn-end hook that publishes the verdict card, and the session-open hook that restores it |
| `client/ship-card.tsx` | client | The verdict card and its ship button, shared by the timeline row and the panel |
| `client/action-button.tsx` / `client/spinner.tsx` | client | Button chrome shared by the card and the panel, and the spinner a busy button draws |
| `client/card-type.ts` | client | Turns the type settings into the font family and scale every length in the card is drawn at |
| `client/ship-panel.tsx` / `client/ship-store.ts` | client | The **Ship check** tab, its re-check, and the per-agent verdict store |
| `client/ship-actions.ts` | client | The forced re-check shared by the Command Center item and `/ship-check` |
| `client/ship-row.tsx` | client | Timeline renderer that hands the daemon's row to the card |
| `client/ship-echo.ts` | client | Timeline transformer that hides the `/ship` message the send leaves behind |
| `client/settings-screen.tsx` / `client/settings-store.ts` / `client/settings-sync.ts` | client | Settings screen, client-side value cache, and the read that keeps it warm |
| `shared/ship.ts` / `shared/timeline.ts` / `shared/settings.ts` | shared | Zod RPC contracts, versioned verdict schema and helpers, the timeline row contract, the persisted document |
| `server/ship.ts` | server | Git plumbing, quality checks, quality cache |
| `server/ship-cache.ts` | server | Per-agent verdict cache filled at turn end, read by the panel |
| `server/timeline.ts` | server | Mints a card id per turn, retires the previous card, appends the verdict |
| `server/timeline-restore.ts` | server | Waits out the timeline rebuild a reload causes, then publishes the verdict card again |

`client/action-button.tsx` carries a `busy` state and only **Re-check** uses it. A spinner is for work nothing else on screen reports; the ship's work is a turn, and Paseo spins for that already.

## Develop

```bash
npm run typecheck
paseo plugin reload paseo-ship-check
paseo plugin logs paseo-ship-check
```
