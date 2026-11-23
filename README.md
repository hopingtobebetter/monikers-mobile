# Monikers Party — Local Wi-Fi MVP

A lightweight Monikers-style party game hosted on one Windows PC. Players join from phone browsers; no cloud hosting or accounts are required.

## Requirements

- Windows 10/11
- Node.js 18 or newer (LTS recommended)
- All phones and the host PC connected to the same Wi-Fi network

## Start the server

1. Install Node.js from https://nodejs.org/ (LTS).
2. Extract this folder somewhere convenient, e.g. `C:\Monikers`.
3. Double-click `start.bat`.
4. The first launch installs the small set of dependencies. This requires internet once.
5. Keep the black terminal window open while playing.

The host dashboard opens at:

- `http://localhost:3000`

On the host PC, open `http://localhost:3000/screen` on a TV or second monitor for the big-screen view.

## Let players join

The server prints your PC's local network address, for example `http://192.168.1.42:3000`.

Players should scan the QR code on the host dashboard / big screen, or visit:

`http://YOUR-PC-IP:3000/join`

All devices must be on the same Wi-Fi. If phones cannot connect, allow Node.js through Windows Defender Firewall on **Private networks**. Some guest Wi-Fi networks enable client isolation and prevent devices from talking to each other; use the main home Wi-Fi instead.

To control the game from a phone, keep the server running on the PC and close any open host dashboard tabs. Then open `http://YOUR-PC-IP:3000` on the phone. The big-screen view can stay open on the PC.

To try running the server on Android, install [Termux](https://github.com/termux/termux-app#installation). Copy the project to a folder inside Termux (you can leave out `node_modules`). In that folder run `pkg install nodejs-lts npm`, then `npm ci` and `npm start`. Keep Termux running during play. Open `http://PHONE-WIFI-IP:3000` for the dashboard, and have players on the same Wi-Fi use that address with `/join` added. If the server cannot list the Wi-Fi IP, look it up in the phone's Wi-Fi settings.

## MVP gameplay

- Everyone joins and submits phrases to one shared deck.
- Players can join after play begins and are assigned to the smaller team. Phrase submissions close when the game starts.
- Host can remove unwanted phrases and move players between teams.
- Each team's clue givers play in a shuffled order that repeats for the rest of the round. The selected player taps **Start turn** on their phone when ready. The host can change the assignment if needed.
- The selected clue giver sees the phrase on their phone and taps **Got it** or **Skip**.
- Got it awards one point and removes the phrase from the deck. Skip moves it to the back of the deck.
- The clue giver can undo their latest tap within four seconds or until the next action or turn change. The final guess gives the clue giver four seconds to undo before the game advances automatically.
- Team A starts each round. When the timer expires or the host ends the turn, the other team takes over the remaining deck in the same round.
- The round ends once every card has been guessed. The full deck is automatically reshuffled for the next round, and the newly selected clue giver starts its first timer when ready. Clearing the final round ends the game.
- Players see the current rule on their phones. Round 1 allows descriptions and gestures. Round 2 allows one word only. Round 3 allows acting and sound effects without words.
- After the final round, players can leave or open a fresh lobby with the same team names, number of rounds, and turn length. The player who opens it enters the lobby, and the rest of the group can join with the new PIN.
- **Rematch** keeps the deck and roster with their existing teams, clears scores, and starts with a new PIN. If a team has nobody connected, it opens the lobby until both teams are ready.
- The big screen has an **Enable sound** button for the last three seconds of a turn and the end-of-turn signal. Round recaps show points earned and the most-skipped phrase, and the final screen shows the winner or a tie.
- Host dashboard and big-screen view update in real time.

## Notes / current MVP limitations

- This is a first playable version, not a hardened public server.
- One room is active per server.
- The host dashboard is controlled by the first browser to claim host control.
- Players reconnect to the same spot when they reopen the same join address in the same browser profile. The host can see who is offline and remove players from the room. An active turn timer keeps running during a disconnect.
- Players are responsible for following the clue rules shown on screen.
- Game data is saved in `data/game.json`. A new room clears the active room state.
- For an internet-accessible game, use a secure hosted deployment or VPN/tunnel with authentication; do not expose this development server directly to the public internet.

## Project structure

- [CHANGELOG.md](CHANGELOG.md) — gameplay changes, fixes, and new features
- `server.js` — Express server, Socket.IO events, game rules, JSON persistence
- `public/index.html` — app shell
- `public/app.js` — host, player, and screen interfaces
- `public/styles.css` — responsive styling
- `data/game.json` — persisted game state (created automatically)


### URL routing fix

This build explicitly serves the app page at `/join` and `/screen` as well as `/`. The QR-code player link should therefore open the player interface instead of an Express `Cannot GET /join` response.
