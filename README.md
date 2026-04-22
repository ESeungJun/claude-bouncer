# claude-bouncer

Claude Code 세션이 응답을 끝내거나 입력을 기다릴 때, 귀여운 펫이 화면 위로 튀어올라 알려주는 데스크탑 알림 앱 (macOS / Windows).
A cute desktop pet for macOS and Windows that bounces to notify you when any Claude Code session finishes responding or is waiting for your input.

https://github.com/user-attachments/assets/ff363262-e4e2-40e7-8406-261baa0feb7f

---

## 이게 뭐야? / What is this?

여러 터미널에서 Claude Code를 돌려두고 다른 일 하다가, "아 끝났나?" 하고 돌아가보는 일 많으시죠. claude-bouncer는 각 세션이 **응답을 끝냈을 때** 또는 **권한/입력을 기다릴 때** 화면 우하단 펫이 통통 튀면서 알려줍니다. 펫을 클릭하면 그 세션이 실행 중이던 **터미널로 바로 점프**해요 (iTerm2는 정확한 탭까지).

If you run multiple Claude Code sessions and keep switching back to check if they're done, claude-bouncer watches every session and pops a pet on your screen the moment any of them **finishes** or **needs your input**. Click the pet to jump back to the exact terminal (iTerm2 even jumps to the right tab).

---

## 주요 기능 / Features

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

---

## 요구사항 / Requirements

| | 설명 / Note |
|---|---|
| OS | macOS 또는 Windows 10/11 |
| Node.js 18+ | Electron 실행 및 훅 디스패처 |
| Claude Code | 알림 대상 |

확인 / Check:
```bash
node -v        # v18.x 이상
npm -v
claude --version
```

---

## 설치 가이드 / Installation

### macOS

#### 1. Node.js 설치 / Install Node.js

[Homebrew](https://brew.sh)로:
```bash
# Homebrew가 없다면 / If you don't have Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
```

또는 공식 설치파일: https://nodejs.org (LTS 권장)

#### 2. 프로젝트 받기 & 실행 / Clone & run

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
./start.command
```

Finder에서 `start.command`를 **더블클릭**해도 됩니다. 처음 실행 시 `npm install` + 훅 설치가 자동으로 진행돼요.
You can also double-click `start.command` in Finder. First run will install dependencies and the hook automatically.

### Windows

#### 1. Node.js 설치 / Install Node.js

https://nodejs.org 에서 LTS 설치파일(.msi)을 받아서 실행. 설치 도중 "Add to PATH" 옵션이 체크되어 있는지 확인하세요.
Download the LTS installer from https://nodejs.org and run it. Make sure "Add to PATH" is checked during installation.

설치 후 PowerShell이나 cmd에서 확인:
```
node -v
npm -v
```

#### 2. Git 설치 (없다면) / Install Git if needed

https://git-scm.com/download/win

#### 3. 프로젝트 받기 & 실행 / Clone & run

PowerShell 또는 cmd:
```
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
start.bat
```

또는 탐색기에서 `start.bat`을 **더블클릭**. 처음 실행 시 의존성 설치 + 훅 등록이 자동 진행됩니다.
Or double-click `start.bat` in Explorer. Dependencies and the hook will be installed automatically on first run.

> **참고**: Windows Defender SmartScreen이 처음에 경고할 수 있어요. "추가 정보" → "실행"을 누르면 다음부턴 뜨지 않습니다.
> **Note**: Windows Defender SmartScreen may warn on first run. Click "More info" → "Run anyway" and it won't ask again.

---

## 테스트 / Test it

앱이 시작되면 트레이(macOS: 메뉴바 상단, Windows: 작업 표시줄 우측) 아이콘이 생깁니다.

- 아이콘 **우클릭 → Test bounce** 를 눌러 펫이 튀는지 확인
- 아무 터미널에서 Claude Code를 실행하고 응답이 끝나는 순간을 관찰

Once the app is running, look for the tray icon (macOS: top menu bar, Windows: bottom-right tray).

- Right-click → **Test bounce** to verify the pet jumps
- Run Claude Code in any terminal and wait for a response to finish

---

## 사용법 / Usage

- 🖱️ **펫 드래그**: 원하는 위치로 이동
- 🖱️ **펫 클릭**: 알림을 보낸 터미널로 점프
- 🎭 **트레이 아이콘 클릭**: 히스토리 패널 토글
- **우클릭 메뉴**:
  - `Show panel` — 히스토리 패널 열기
  - `Test bounce` — 동작 테스트
  - `Quit` — 앱 종료

### 동작 원리 / How it works

1. 설치 스크립트가 Claude Code의 `Stop`과 `Notification` 훅에 `node send-notify.js` 명령을 등록
2. 세션이 종료되거나 입력을 기다릴 때, 훅이 JSON을 `http://127.0.0.1:17891/notify`로 POST
3. 앱은 이를 받아 히스토리에 저장하고, 커서가 있는 디스플레이 우하단에서 펫을 바운스
4. 펫 클릭 시 OS별 방법으로 해당 터미널 활성화
   - macOS: AppleScript (iTerm2는 `unique id`로 정확한 세션 선택)
   - Windows: PowerShell `AppActivate`로 윈도우 활성화

1. Installer registers a `node send-notify.js` command in Claude Code's `Stop` and `Notification` hooks
2. When a session stops or waits for input, the hook POSTs JSON to `http://127.0.0.1:17891/notify`
3. The app stores it in history and bounces the pet on the display that currently has the cursor
4. Clicking the pet activates the source terminal per-OS
   - macOS: AppleScript (iTerm2 targets the exact session by `unique id`)
   - Windows: PowerShell `AppActivate` raises the app window

훅 자체는 외부 CLI(jq, curl) 없이 Node만 사용하므로 설치 부담이 적고 OS 간 동작이 일관됩니다.
The hook uses only Node — no external CLIs like jq/curl — so installation is light and behavior is consistent across OSes.

---

## 제거 / Uninstall

훅만 제거 / Remove only the hook:
```bash
npm run uninstall-hook
```

완전 제거 / Full removal:
```bash
npm run uninstall-hook
# 이후 프로젝트 폴더 삭제 / then delete the project folder
```

---

## 문제 해결 / Troubleshooting

**펫이 안 뜨는데? / Pet doesn't appear?**
- 트레이에 아이콘이 있는지 확인. 있으면 `Test bounce`로 테스트
- `~/.claude/settings.json`에 `send-notify.js`를 포함한 훅이 있는지 확인
- Check the tray for the icon and try `Test bounce`. Verify `~/.claude/settings.json` has a hook referencing `send-notify.js`.

**macOS: "확인되지 않은 개발자" 경고 / Unidentified developer warning**
- `start.command` 우클릭 → 열기 한 번만 하면 다음부턴 안 뜸
- Right-click `start.command` → Open once.

**Windows: SmartScreen 경고 / SmartScreen warning**
- "추가 정보" → "실행"
- "More info" → "Run anyway".

**포트 17891이 이미 사용 중 / Port 17891 already in use**
- macOS/Linux: `lsof -i :17891`
- Windows: `netstat -ano | findstr :17891`
- 충돌하는 프로세스 종료 후 재시작

**`node` 명령어를 찾을 수 없음 / `node` command not found**
- Node.js 설치 확인. Windows는 설치 시 "Add to PATH" 체크 필수
- Verify Node.js is installed and on PATH. On Windows, re-run the installer with "Add to PATH" checked.

---

## 라이선스 / License

MIT
