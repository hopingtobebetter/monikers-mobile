# Changelog

## Unreleased

### Added

- Players can join during a round or between rounds. New arrivals are assigned to the smaller team, and the host can move them.
- Players can reconnect to the same spot using the same browser. The host can see who is offline.
- The submission screen shows three random hints from a built-in list of 300 phrases with short descriptions. **Refresh hints** draws three different suggestions.
- Tapping a hint fills the phrase and description fields, ready to edit or submit.
- The final score screen lets players leave or start a fresh room with the same team names, round count, and turn length.
- The clue giver gets a **You're up!** prompt. The big-screen view can play an audible final countdown.
- The clue giver can undo their last **Got it** or **Skip** tap within four seconds, including the point that clears a round.
- Round recaps show points earned and the most-skipped phrase. The final screen announces the winner or a tie.
- **Rematch** keeps the deck, teams, and settings, and resets scores for another game.

### Changed

- Each round uses one shared deck. Teams alternate turns with the remaining cards until the deck is empty. The full deck is reshuffled for the next round.
- Each team gets a shuffled clue-giver order per round. The next clue giver is assigned automatically at the handoff and starts the timer from their phone.
- The host dashboard and big-screen view show the active round and team.
- Clearing the deck advances automatically to the next round or finishes the game after the final round. Players see a short rule for each round on their phones.
- The clue giver's **Got it · +1 point** button is full-width and green. **Skip phrase** is smaller, outlined, and spaced farther away.

### Fixed

- **Start Game** shows why the game cannot start. On the host PC, clicking it from the localhost dashboard can recover host control from an older tab.
- Another player's submission updates the live count while preserving the draft, focus, text selection, and hints on your screen.

### Removed

- Removed the **Leave game** button during submissions and play.
