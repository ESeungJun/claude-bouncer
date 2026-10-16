<div align="center">

<img src="docs/icon.png" width="120" alt="Claude Bouncer" />

# Claude Bouncer

**A tiny pixel Claude that lives on your desktop.<br/>It plays with you, and tells you exactly which Claude Code session needs you.**

English · [한국어](README.ko.md)

![macOS](https://img.shields.io/badge/macOS-supported-black?logo=apple)
![Windows](https://img.shields.io/badge/Windows-supported-0078D6?logo=windows)
![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/notify-cards.png" width="300" alt="Notification cards" />
<img src="docs/game-catch.png" width="330" alt="Cookie catch mini game" />

</div>

---

## Contents

- [Why](#why)
- [Features](#features)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Make it look like you](#make-it-look-like-you)
- [How it works](#how-it-works)
- [Privacy & security](#privacy--security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Why

When several Claude Code sessions run in different terminals, you keep switching back to check: *is it done? is it waiting for a permission?*
Claude Bouncer puts a small pixel pet on your desktop. Most of the time it wanders around, naps and asks you to play. When a session **finishes** or **needs you**, it runs up to your cursor with a card that says **which project, which branch, which prompt and which terminal tab** — one click takes you there.

> The app's interface is in Korean.

## Features

### 🔔 Notifications you can't miss

| | |
|---|---|
| **Cards that show the source** | Kind (done · permission · waiting for input), project, git branch, the prompt you sent, a summary of the reply, how long it took, terminal app and tab (tty / tmux pane) |
| **Jump back in one click** | Exact tab in iTerm2 and Terminal.app, tmux pane selection, app activation for VS Code, Cursor, Warp, Ghostty, JetBrains and more |
| **Stays until handled** | Permission and input requests stay up while the pet waits next to you; they clear themselves once you answer in that session |
| **At a glance** | Unread badge on the pet, count in the menu bar, a `•••` bubble while sessions are working |
| **While you were away** | Come back to "3 notifications while you were away!" |
| **Sessions panel** | Every open session: working · needs you · done |
| **Do Not Disturb** | Badge only, no sound or movement. Optional system notifications |

<p align="center">
  <img src="docs/panel-inbox.png" width="250" alt="Inbox" />
  <img src="docs/panel-sessions.png" width="250" alt="Sessions" />
</p>

### 🐾 A pet to play with

- **Summon hotkey** — <kbd>⌥ Option</kbd>+<kbd>⇧ Shift</kbd>+<kbd>C</kbd> (Windows: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>) from anywhere; the pet pops up in front of your cursor
- **Pet it, poke it, throw it** — rub the mouse over it for hearts, click to make it hop, drag and toss it (it gets dizzy if you throw too hard)
- **Feed** — a cookie sticks to your cursor; click anywhere to drop it
- **Fetch** — kick the ball and the pet kicks it back to you
- **Mini games** — 🍪 *Cookie Catch* (catch cookies, dodge bugs, 30 s) and 🏃 *Tag* (click the runaway pet, 20 s)
- **Needs and levels** — hunger, fun and energy drift over time; it comes over when bored or hungry, sleeps when tired, and levels up as you play

<p align="center"><img src="docs/sprite-sheet.png" width="560" alt="Sprite sheet" /></p>

### ✨ Make it look like you

Turn a photo into your own pixel character with [Higgsfield](https://higgsfield.ai) — see [below](#make-it-look-like-you).

## Quick start

**Requirements:** macOS or Windows 10/11 · [Node.js](https://nodejs.org) 18+ · [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
./start.command          # macOS — or double-click it in Finder
start.bat                # Windows — or double-click it in Explorer
```

The first run installs dependencies and registers the Claude Code hooks. To check that everything works, open the menu-bar (tray) icon → **테스트 알림** (*Test notification*).

<details>
<summary><b>Build a standalone app</b></summary>

```bash
npm run dist:mac   # .app + DMG + zip
npm run dist:win   # NSIS installer
npm run pack       # quick unpacked .app for testing
```

Output goes to `dist/`. Moving the `.app` is fine — the hook path is refreshed on every launch. If Gatekeeper blocks the first launch, right-click → Open. On Windows, SmartScreen → More info → Run anyway.

</details>

## Usage

| Action | What happens |
|---|---|
| Click the pet | Hop and a little reaction (opens the cards if any are waiting) |
| Double-click | Play menu |
| Right-click | Context menu: feed, ball, games, sleep, panel, Do Not Disturb |
| Rub back and forth | Petting ♥ |
| Drag & release | Pick up and throw |
| Click a card | Jump to that terminal tab |
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>C</kbd> | Summon to your cursor (press again to close the cards) |
| Menu-bar icon | Panel, summon, play, Do Not Disturb, roaming, test notifications, hook management |

**Panel tabs:** 🔔 Inbox · 🖥 Sessions · 🐾 Pet (stats, actions, custom look) · ⚙ Settings (size, roaming, sound, system notifications, Do Not Disturb, launch at login, summon hotkey)

## Make it look like you

<img src="docs/panel-custom-look.png" width="250" align="right" alt="Custom look maker" />

1. Open the panel → 🐾 **Pet** → **🔗 Higgsfield 계정으로 연결** (*Connect Higgsfield*) and sign in in your browser.
   It's the same MCP connector Claude Code uses for Higgsfield.
2. Drop in a photo (or click to pick one) and press **닮은 캐릭터 만들기** (*Make my character*). It takes 30–60 seconds.
3. Pick one of the two versions → **이걸로 할래** (*Use this one*). Saved looks can be swapped back any time.

**Two styles**

- **🎨 Pixel character** (default) — a free-form chibi pixel character that looks like you. Higgsfield draws six poses (idle, blink, two walk frames, happy jump, asleep); the app cuts the sheet, detects the art's native pixel size and animates with those frames.
- **🟧 Claudy body** — keeps the classic body and paints your hair, skin tone and clothes on it, so every engine-drawn expression still works. Optional glasses and blush.

Each run makes two images (about 3 credits) from your Higgsfield account. Prefer an API key? Choose **API 키로 연결하기** and paste a Key ID + Secret from [console.higgsfield.ai](https://console.higgsfield.ai).

<p align="center"><img src="docs/custom-look-pixel.png" width="600" alt="Pixel character in several poses" /></p>

## How it works

```
Claude Code ──hook──▶ send-notify.js ──POST 127.0.0.1:17891──▶ Claude Bouncer ──▶ pet + cards
  Stop / Notification /         adds terminal app, tab tty,        tracks sessions, reads
  UserPromptSubmit / SessionEnd tmux pane                          the transcript summary
```

1. On launch the app registers four hooks in `~/.claude/settings.json` — `Stop`, `Notification`, `UserPromptSubmit`, `SessionEnd` — and only touches its own entries.
2. The hook script reads the event, adds where it came from (terminal bundle id, the tab's tty, tmux pane) and posts it to the app. It never blocks or fails a Claude turn.
3. The app tracks each session, reads the last prompt and reply from the transcript, and builds the card.
4. The pet lives on a transparent full-screen overlay that only catches the mouse over the pet, cards and menus; every other click goes straight through to your apps.

**What gets detected:** Claude Code in a terminal and in IDE extensions (VS Code, Cursor, JetBrains) on this machine. Chats on claude.ai and in the Claude desktop app don't run hooks, so they can't send notifications yet. A browser extension for claude.ai is in progress.

## Privacy & security

- The local server listens on `127.0.0.1` only, accepts JSON only, and rejects requests with an `Origin` header, so web pages can't post fake notifications.
- Clicking a card only ever opens real folders, never files or apps named in a notification.
- Prompts and transcript summaries stay on your machine (`~/Library/Application Support/claude-bouncer` on macOS).
- Higgsfield sign-in tokens and API keys are encrypted with the OS keychain (Electron `safeStorage`).
- Only the custom look feature sends anything out: your photo goes to Higgsfield to generate the character.

## Troubleshooting

<details>
<summary><b>I can't see the pet</b></summary>

Menu-bar icon → **펫 부르기** (*Summon*) or press the hotkey. Check that Do Not Disturb is off.
</details>

<details>
<summary><b>No notifications arrive</b></summary>

Check that `~/.claude/settings.json` has hooks that point to `send-notify.js`, then try menu-bar icon → **테스트 알림**. Menu-bar icon → **Claude Code 훅 → 다시 설치** re-registers the hooks.
</details>

<details>
<summary><b>The hotkey does nothing</b></summary>

Another app probably uses the same combination. Set a new one in ⚙ Settings → **부르기 단축키**; the panel tells you right away if it's taken.
</details>

<details>
<summary><b>Port 17891 is already in use</b></summary>

macOS: `lsof -i :17891` · Windows: `netstat -ano | findstr :17891` — stop the other process and restart.
</details>

<details>
<summary><b>Uninstall</b></summary>

`npm run uninstall-hook` (or menu-bar icon → **Claude Code 훅 → 제거**), then delete the folder or app.
</details>

## Development

```bash
npm start          # run from source
npm test           # unit tests: sessions, server, store, sprites, skins, Higgsfield clients
npm run sprites    # regenerate docs/sprite-sheet.png
npm run template   # regenerate assets/skin-template.png (reference sent to Higgsfield)
```

```
main.js                 app lifecycle, overlay + panel windows, tray, IPC, hotkey
lib/
  sessions.js           session tracking, transcript summary, git branch, terminal names
  server.js             localhost hook receiver
  focus.js              jump to the right terminal tab
  higgsfield-mcp.js     Higgsfield over MCP (OAuth) for custom looks
  higgsfield.js         Higgsfield API-key client + prompts
  store.js              JSON persistence
renderer/
  overlay.*, js/        the pet: sprites, behaviour, cards, games, sounds
  js/pixelize.js        generated image → pixel frames
  panel.*, maker.js     inbox, sessions, pet, settings, custom look
scripts/                hook dispatcher + installer
tools/                  sprite sheet / skin preview / PNG helpers
```

## Credits

- Inspired by [Shimeji](https://en.wikipedia.org/wiki/Shimeji_(software)), [Desktop Goose](https://samperson.itch.io/desktop-goose), [VPet](https://store.steampowered.com/app/1920960/VPet/) and Tamagotchi, and by [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk), which shows Claude Code state as a pixel pet. Claude Bouncer focuses on playing together and making the source of every notification obvious.
- Concept sheet and app icon made with [Higgsfield](https://higgsfield.ai) (`docs/concept/`); the in-app sprites are hand-placed pixels in code (`renderer/js/sprites.js`).
- Font: [Galmuri](https://github.com/quiple/galmuri) (SIL Open Font License 1.1).

## License

[MIT](LICENSE) © ESeungjun
