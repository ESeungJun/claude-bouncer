# claude-bouncer

Claude Code 세션이 응답을 끝내거나 입력을 기다릴 때, 귀여운 펫이 화면 위로 튀어올라 알려주는 macOS 데스크탑 알림 앱.
A cute desktop pet for macOS that bounces to notify you when any Claude Code session finishes responding or is waiting for your input.

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
- 🎯 **원클릭 복귀** — 펫 클릭 시 해당 세션의 터미널(iTerm2 / Terminal / VSCode / Cursor / Warp / Ghostty) 활성화
- 📜 **히스토리 패널** — 최근 50개 알림 기록, 트레이 아이콘 클릭으로 열기
- 🔀 **세션 구분** — `TERM_SESSION_ID`, `tmux`, `ppid`까지 써서 같은 cwd의 여러 세션 식별
- 🧹 **자동 훅 관리** — 설치/삭제 스크립트가 `~/.claude/settings.json`을 안전하게 편집

---

## 요구사항 / Requirements

| | 설명 / Note | 확인 / Check |
|---|---|---|
| macOS | Darwin 전용 (Windows/Linux 미지원) | `uname` |
| Node.js 18+ | Electron 실행용 | `node -v` |
| npm | Node.js에 포함 | `npm -v` |
| jq | 훅에서 JSON 가공에 사용 | `jq --version` |
| Claude Code | 알림 대상 | `claude --version` |

---

## 처음 쓰시나요? 설치 가이드 / First-time setup

### 1. Node.js 설치 / Install Node.js

제일 쉬운 방법 — [Homebrew](https://brew.sh)로 설치:
The easiest way — install via [Homebrew](https://brew.sh):

```bash
# Homebrew가 없다면 먼저 설치 / Install Homebrew if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 설치 / Install Node.js
brew install node
```

또는 공식 설치파일: https://nodejs.org (LTS 버전 권장)
Or the official installer: https://nodejs.org (LTS recommended)

### 2. jq 설치 / Install jq

```bash
brew install jq
```

### 3. 이 프로젝트 받기 / Get this project

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
```

### 4. 실행 / Run

Finder에서 `start.command` 파일을 **더블클릭**하거나, 터미널에서:
Double-click `start.command` in Finder, or in terminal:

```bash
./start.command
```

처음 실행하면 자동으로:
- `npm install`로 Electron 등 의존성 설치
- Claude Code 훅을 `~/.claude/settings.json`에 등록
- 앱 실행 → 메뉴바에 🎭 아이콘 등장

On first run it will automatically:
- Run `npm install` to fetch Electron and dependencies
- Install the Claude Code hook into `~/.claude/settings.json`
- Launch the app — look for the 🎭 icon in the menu bar

### 5. 테스트 / Test it

메뉴바 아이콘 **우클릭 → Test bounce** 를 눌러보세요. 펫이 튀면 정상. 그 다음 아무 터미널에서 Claude Code를 쓰고 응답이 끝나는 순간을 기다려보세요.

Right-click the menu bar icon → **Test bounce**. If the pet jumps, you're set. Then run Claude Code in any terminal and wait for it to finish responding.

---

## 사용법 / Usage

- 🖱️ **펫 드래그**: 원하는 위치로 옮길 수 있음
- 🖱️ **펫 클릭**: 알림을 보낸 터미널로 복귀
- 🎭 **트레이 아이콘 클릭**: 히스토리 패널 토글
- **우클릭 메뉴**:
  - `Show panel` — 히스토리 패널 열기
  - `Test bounce` — 동작 테스트
  - `Quit` — 앱 종료

### 동작 원리 / How it works

1. 설치 스크립트가 Claude Code의 `Stop`과 `Notification` 훅에 명령어를 등록
2. Claude Code 세션 종료/대기 시, 훅이 JSON 페이로드를 `http://127.0.0.1:17891/notify`로 POST
3. 앱은 이를 받아 히스토리에 저장하고, 펫을 커서가 있는 디스플레이 우하단에서 바운스
4. 펫 클릭 시 페이로드의 `TERM_PROGRAM` / `TERM_SESSION_ID` 기반으로 AppleScript가 터미널을 활성화

1. The installer registers a command in Claude Code's `Stop` and `Notification` hooks
2. When a session stops or waits for input, the hook POSTs a JSON payload to `http://127.0.0.1:17891/notify`
3. The app stores it in history and bounces the pet on the display with the cursor
4. Clicking the pet runs an AppleScript that activates the source terminal based on `TERM_PROGRAM` / `TERM_SESSION_ID`

---

## 제거 / Uninstall

훅만 제거 / Remove only the hook:
```bash
npm run uninstall-hook
```

완전 제거 / Full removal:
```bash
npm run uninstall-hook
cd ..
rm -rf claude-bouncer
```

---

## 문제 해결 / Troubleshooting

**펫이 안 뜨는데? / Pet doesn't appear?**
- 메뉴바에 아이콘이 있는지 확인 — 있으면 `Test bounce`로 테스트
- `~/.claude/settings.json`에 `127.0.0.1:17891/notify`를 포함한 훅이 있는지 확인
- Check menu bar for icon, then try `Test bounce`. Verify your `~/.claude/settings.json` has a hook containing `127.0.0.1:17891/notify`.

**`jq: command not found`**
- `brew install jq` 실행 — 없으면 훅이 조용히 실패해요 (Claude 세션엔 영향 없음)
- Run `brew install jq`. Without it the hook silently fails (doesn't affect Claude itself).

**"확인되지 않은 개발자" 경고 / "Unidentified developer" warning**
- `start.command` 우클릭 → 열기 한 번만 하면 그 뒤론 경고 안 뜸
- Right-click `start.command` → Open once. The warning won't appear again.

**포트 17891이 이미 사용 중 / Port 17891 already in use**
- 다른 프로세스가 쓰고 있음. `lsof -i :17891`로 확인
- Another process is using it. Run `lsof -i :17891` to find it.

---

## 라이선스 / License

MIT
