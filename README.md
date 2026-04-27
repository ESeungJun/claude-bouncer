# claude-bouncer

🐾 Claude Code 세션 알림 데스크탑 펫 (macOS / Windows)
🐾 Desktop notification pet for Claude Code sessions (macOS / Windows)

**[🇰🇷 한국어](#한국어) · [🇺🇸 English](#english)**

https://github.com/user-attachments/assets/ff363262-e4e2-40e7-8406-261baa0feb7f

---

## 한국어

### 이게 뭐야?

여러 터미널에서 Claude Code를 돌려두고 다른 일 하다가, "아 끝났나?" 하고 돌아가보는 일 많으시죠. claude-bouncer는 각 세션이 **응답을 끝냈을 때** 또는 **권한/입력을 기다릴 때** 화면 우하단 펫이 통통 튀면서 알려줍니다. 펫을 클릭하면 그 세션이 실행 중이던 **터미널로 바로 점프**해요 (iTerm2는 정확한 탭까지).

### 주요 기능

- 🐾 **통통 튀는 펫** — Stop / Notification 이벤트에 맞춰 화면 우하단에서 바운스
- 🖥️ **멀티 디스플레이 대응** — 커서가 있는 모니터로 펫이 따라옴
- 🪟 **전체화면 위에서도 표시** — macOS Space를 넘나들며 항상 최상위
- 🎯 **원클릭 복귀** — 펫 클릭 시 해당 세션의 터미널 활성화
  - macOS: iTerm2 / Terminal / VSCode / Cursor / Warp / Ghostty (iTerm2는 정확한 탭까지)
  - Windows: Windows Terminal / VSCode / Cursor / Hyper (앱 활성화)
- 📜 **히스토리 패널** — 최근 50개 알림 기록, 트레이 아이콘 클릭으로 열기
- 🔀 **세션 구분** — `TERM_SESSION_ID`, `tmux`, `ppid`까지 써서 같은 cwd의 여러 세션 식별
- 🧹 **자동 훅 관리** — 설치/삭제 스크립트가 `~/.claude/settings.json`을 안전하게 편집
- 🌍 **의존성 최소화** — Node.js만 있으면 OK (jq/curl 같은 외부 CLI 불필요)

### 요구사항

| | 설명 |
|---|---|
| OS | macOS 또는 Windows 10/11 |
| Node.js 18+ | Electron 실행 및 훅 디스패처 |
| Claude Code | 알림 대상 |

확인:
```bash
node -v        # v18.x 이상
npm -v
claude --version
```

### 설치 — macOS

**1. Node.js 설치**

[Homebrew](https://brew.sh)로:
```bash
# Homebrew가 없다면
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
```

또는 공식 설치파일: https://nodejs.org (LTS 권장)

**2. 프로젝트 받기 & 실행**

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
./start.command
```

Finder에서 `start.command`를 **더블클릭**해도 됩니다. 처음 실행 시 `npm install` + 훅 설치가 자동으로 진행돼요.

> **터미널 창 없이 쓰고 싶다면** 아래 [정식 앱으로 빌드](#정식-앱으로-빌드) 섹션을 참고하세요. `.app` 번들로 만들면 더블클릭만으로 트레이 아이콘만 뜨고 터미널은 안 떠요.

### 정식 앱으로 빌드

소스 모드(`./start.command`) 대신 `.app` / `.exe` 번들로 만들고 싶을 때:

```bash
# macOS — .app + DMG + zip 생성
npm run dist:mac

# Windows — NSIS 설치파일(.exe) 생성
npm run dist:win

# 빠른 테스트용 (압축/서명 생략, .app만)
npm run pack
```

결과물은 `dist/` 폴더에 생깁니다.
- macOS: `dist/Claude Bouncer-<version>.dmg` 또는 `dist/mac-arm64/Claude Bouncer.app`
- Windows: `dist/Claude Bouncer Setup <version>.exe`

`.app`을 `/Applications`로 옮기고 더블클릭하면 트레이 아이콘만 뜨고, 훅은 자동으로 `.app` 내부 경로로 갱신됩니다(앱을 다른 위치로 옮긴 뒤 다시 실행해도 자동 갱신). 첫 실행 시 macOS Gatekeeper 경고가 뜨면 우클릭 → 열기로 한 번만 허용하세요.

훅 관리는 트레이 메뉴에서:
- `Reinstall hook` — 훅 재등록 (앱을 옮긴 뒤에 유용)
- `Uninstall hook` — Claude Code 설정에서 제거

### 설치 — Windows

**1. Node.js 설치**

https://nodejs.org 에서 LTS 설치파일(.msi)을 받아서 실행. 설치 도중 "Add to PATH" 옵션이 체크되어 있는지 확인하세요.

설치 후 PowerShell이나 cmd에서 확인:
```
node -v
npm -v
```

**2. Git 설치 (없다면)**

https://git-scm.com/download/win

**3. 프로젝트 받기 & 실행**

PowerShell 또는 cmd:
```
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
start.bat
```

또는 탐색기에서 `start.bat`을 **더블클릭**. 처음 실행 시 의존성 설치 + 훅 등록이 자동 진행됩니다.

> **참고**: Windows Defender SmartScreen이 처음에 경고할 수 있어요. "추가 정보" → "실행"을 누르면 다음부턴 뜨지 않습니다.

### 테스트

앱이 시작되면 트레이(macOS: 메뉴바 상단, Windows: 작업 표시줄 우측) 아이콘이 생깁니다.

- 아이콘 **우클릭 → Test bounce** 를 눌러 펫이 튀는지 확인
- 아무 터미널에서 Claude Code를 실행하고 응답이 끝나는 순간을 관찰

### 사용법

- 🖱️ **펫 드래그**: 원하는 위치로 이동
- 🖱️ **펫 클릭**: 알림을 보낸 터미널로 점프
- 🎭 **트레이 아이콘 클릭**: 히스토리 패널 토글
- **우클릭 메뉴**:
  - `Show panel` — 히스토리 패널 열기
  - `Test bounce` — 동작 테스트
  - `Quit` — 앱 종료

### 동작 원리

1. 설치 스크립트가 Claude Code의 `Stop`과 `Notification` 훅에 `node send-notify.js` 명령을 등록
2. 세션이 종료되거나 입력을 기다릴 때, 훅이 JSON을 `http://127.0.0.1:17891/notify`로 POST
3. 앱은 이를 받아 히스토리에 저장하고, 커서가 있는 디스플레이 우하단에서 펫을 바운스
4. 펫 클릭 시 OS별 방법으로 해당 터미널 활성화
   - macOS: AppleScript (iTerm2는 `unique id`로 정확한 세션 선택)
   - Windows: PowerShell `AppActivate`로 윈도우 활성화

훅 자체는 외부 CLI(jq, curl) 없이 Node만 사용하므로 설치 부담이 적고 OS 간 동작이 일관됩니다.

### 제거

훅만 제거:
```bash
npm run uninstall-hook
```

완전 제거:
```bash
npm run uninstall-hook
# 이후 프로젝트 폴더 삭제
```

### 문제 해결

**펫이 안 뜨는데?**
- 트레이에 아이콘이 있는지 확인. 있으면 `Test bounce`로 테스트
- `~/.claude/settings.json`에 `send-notify.js`를 포함한 훅이 있는지 확인

**macOS: "확인되지 않은 개발자" 경고**
- `start.command` 우클릭 → 열기 한 번만 하면 다음부턴 안 뜸

**Windows: SmartScreen 경고**
- "추가 정보" → "실행"

**포트 17891이 이미 사용 중**
- macOS/Linux: `lsof -i :17891`
- Windows: `netstat -ano | findstr :17891`
- 충돌하는 프로세스 종료 후 재시작

**`node` 명령어를 찾을 수 없음**
- Node.js 설치 확인. Windows는 설치 시 "Add to PATH" 체크 필수

---

## English

### What is this?

If you run multiple Claude Code sessions and keep switching back to check if they're done, claude-bouncer watches every session and pops a pet on your screen the moment any of them **finishes** or **needs your input**. Click the pet to jump back to the exact terminal (iTerm2 even jumps to the right tab).

### Features

- 🐾 **Bouncing pet** — animates at the bottom-right on Stop / Notification events
- 🖥️ **Multi-display aware** — the pet follows the display your cursor is on
- 🪟 **Shows over full-screen apps** — tracks across macOS Spaces, stays on top
- 🎯 **One-click return** — clicking the pet activates the source terminal
  - macOS: iTerm2 / Terminal / VSCode / Cursor / Warp / Ghostty (iTerm2 targets the exact tab)
  - Windows: Windows Terminal / VSCode / Cursor / Hyper (app-level activation)
- 📜 **History panel** — last 50 notifications, open by clicking the tray icon
- 🔀 **Session disambiguation** — uses `TERM_SESSION_ID`, `tmux`, and `ppid` to tell apart multiple sessions in the same cwd
- 🧹 **Managed hook install** — installer/uninstaller edits `~/.claude/settings.json` safely
- 🌍 **Minimal dependencies** — only Node.js required (no jq/curl or other external CLIs)

### Requirements

| | Note |
|---|---|
| OS | macOS or Windows 10/11 |
| Node.js 18+ | Runs Electron and the hook dispatcher |
| Claude Code | The thing that fires the notifications |

Check:
```bash
node -v        # v18.x or newer
npm -v
claude --version
```

### Install — macOS

**1. Install Node.js**

Via [Homebrew](https://brew.sh):
```bash
# If you don't have Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
```

Or the official installer: https://nodejs.org (LTS recommended).

**2. Clone & run**

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
./start.command
```

You can also double-click `start.command` in Finder. First run installs dependencies and the hook automatically.

> **Want no Terminal window?** See [Build a standalone app](#build-a-standalone-app) below — the `.app` bundle launches straight to a tray icon, no Terminal involved.

### Build a standalone app

Prefer a real `.app` / `.exe` over the source-mode launchers:

```bash
# macOS — .app + DMG + zip
npm run dist:mac

# Windows — NSIS installer (.exe)
npm run dist:win

# Fast unsigned pack for local testing (.app only)
npm run pack
```

Output lands in `dist/`:
- macOS: `dist/Claude Bouncer-<version>.dmg` or `dist/mac-arm64/Claude Bouncer.app`
- Windows: `dist/Claude Bouncer Setup <version>.exe`

Drop the `.app` into `/Applications` and double-click — only the tray icon appears, and the hook is rewritten to point at the bundle's internal path. Move the `.app` later? Just relaunch and the hook updates automatically. macOS may show a Gatekeeper warning on first launch — right-click → Open once and you're set.

Manage the hook from the tray menu:
- `Reinstall hook` — re-register (useful after moving the app)
- `Uninstall hook` — remove from Claude Code settings

### Install — Windows

**1. Install Node.js**

Download the LTS `.msi` from https://nodejs.org and run it. Make sure "Add to PATH" is checked during installation.

Verify in PowerShell or cmd:
```
node -v
npm -v
```

**2. Install Git (if needed)**

https://git-scm.com/download/win

**3. Clone & run**

PowerShell or cmd:
```
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
start.bat
```

Or double-click `start.bat` in Explorer. Dependencies and the hook will be installed automatically on first run.

> **Note**: Windows Defender SmartScreen may warn on first run. Click "More info" → "Run anyway" — it won't ask again.

### Test it

Once the app is running, look for the tray icon (macOS: top menu bar, Windows: system tray).

- Right-click → **Test bounce** to verify the pet jumps
- Run Claude Code in any terminal and wait for a response to finish

### Usage

- 🖱️ **Drag the pet** to reposition it
- 🖱️ **Click the pet** to jump to the originating terminal
- 🎭 **Click the tray icon** to toggle the history panel
- **Right-click menu**:
  - `Show panel` — open the history panel
  - `Test bounce` — trigger a test animation
  - `Quit` — quit the app

### How it works

1. The installer registers a `node send-notify.js` command in Claude Code's `Stop` and `Notification` hooks
2. When a session stops or waits for input, the hook POSTs a JSON payload to `http://127.0.0.1:17891/notify`
3. The app stores the entry in history and bounces the pet on whichever display currently has the cursor
4. Clicking the pet activates the source terminal per-OS
   - macOS: AppleScript (iTerm2 targets the exact session by `unique id`)
   - Windows: PowerShell `AppActivate` raises the app window

The hook uses only Node — no external CLIs like jq/curl — so installation is light and behavior is consistent across OSes.

### Uninstall

Remove the hook only:
```bash
npm run uninstall-hook
```

Full removal:
```bash
npm run uninstall-hook
# then delete the project folder
```

### Troubleshooting

**Pet doesn't appear?**
- Check the tray for the icon, then try `Test bounce`
- Verify `~/.claude/settings.json` contains a hook referencing `send-notify.js`

**macOS: "Unidentified developer" warning**
- Right-click `start.command` → Open once. It won't warn again.

**Windows: SmartScreen warning**
- Click "More info" → "Run anyway".

**Port 17891 already in use**
- macOS/Linux: `lsof -i :17891`
- Windows: `netstat -ano | findstr :17891`
- Kill the conflicting process and restart the app.

**`node` command not found**
- Verify Node.js is installed and on PATH. On Windows, re-run the installer with "Add to PATH" checked.

---

## License

MIT — see [LICENSE](LICENSE)
