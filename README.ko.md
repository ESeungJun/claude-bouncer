<div align="center">

<img src="docs/icon.png" width="120" alt="Claude Bouncer" />

# Claude Bouncer

**바탕화면을 돌아다니는 작은 도트 클로드.<br/>같이 놀고, 어느 Claude Code 세션이 나를 부르는지 확실하게 알려줘요.**

[English](README.md) · 한국어

![macOS](https://img.shields.io/badge/macOS-supported-black?logo=apple)
![Windows](https://img.shields.io/badge/Windows-supported-0078D6?logo=windows)
![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<img src="docs/notify-cards.png" width="300" alt="알림 카드" />
<img src="docs/game-catch.png" width="330" alt="쿠키 받기 게임" />

</div>

---

## 목차

- [왜 만들었나](#왜-만들었나)
- [주요 기능](#주요-기능)
- [설치](#설치)
- [소스에서 실행](#소스에서-실행)
- [사용법](#사용법)
- [claude.ai 웹 연결](#claudeai-웹-연결)
- [나만의 캐릭터 만들기](#나만의-캐릭터-만들기)
- [동작 원리](#동작-원리)
- [개인정보와 보안](#개인정보와-보안)
- [문제 해결](#문제-해결)
- [개발](#개발)
- [만든 이야기와 참고](#만든-이야기와-참고)
- [라이선스](#라이선스)

## 왜 만들었나

여러 터미널에서 Claude Code를 돌려두고 다른 일을 하다 보면 *"끝났나?", "권한 요청 떠 있는 거 아냐?"* 하면서 계속 창을 오가게 돼요.
Claude Bouncer는 바탕화면에 작은 도트 펫을 띄워요. 평소엔 화면 여기저기를 돌아다니고 낮잠도 자고 놀아달라고 조르다가, 세션이 **끝나거나 나를 기다리면** 커서 앞으로 달려와서 **어느 프로젝트·브랜치에서, 무슨 요청이, 어느 터미널 탭에서** 왔는지 카드로 알려줘요. 카드를 누르면 바로 그 탭으로 이동해요.

## 주요 기능

### 🔔 놓칠 수 없는 알림

| | |
|---|---|
| **출처가 보이는 카드** | 종류(작업 완료 · 권한 요청 · 입력 대기), 프로젝트, git 브랜치, 내가 보낸 요청, 결과 요약, 걸린 시간, 터미널 앱과 탭(tty · tmux pane) |
| **원클릭 이동** | iTerm2 · macOS 터미널은 정확한 탭까지, tmux는 pane까지, VS Code · Cursor · Warp · Ghostty · JetBrains 등은 앱을 앞으로 |
| **처리할 때까지 유지** | 권한 · 입력 요청은 펫이 옆에서 기다리며 남아 있고, 그 세션에 다시 입력하면 자동으로 정리돼요 |
| **한눈에** | 펫 머리 위 배지, 메뉴바 카운트, 작업 중인 세션이 있으면 `•••` 말풍선 |
| **자리 비움 요약** | 돌아오면 "자리 비운 사이 알림 3개 왔어!" |
| **세션 패널** | 열려 있는 세션 전체 현황 (작업 중 · 응답 필요 · 끝남) |
| **claude.ai도** | 브라우저 확장을 설치하면 claude.ai 웹 채팅도 답변이 끝나면 알려줘요 |
| **방해 금지** | 소리 · 움직임 없이 배지로만. 원하면 시스템 알림도 같이 |

<p align="center">
  <img src="docs/panel-inbox.png" width="250" alt="알림함" />
  <img src="docs/panel-sessions.png" width="250" alt="세션" />
</p>

### 🐾 같이 노는 펫

- **부르기 단축키** — 어디서든 <kbd>⌥ Option</kbd>+<kbd>⇧ Shift</kbd>+<kbd>C</kbd> (Windows: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>), 커서 앞으로 뿅 나타나요
- **쓰다듬기 · 클릭 · 던지기** — 위에서 마우스를 좌우로 문지르면 하트, 클릭하면 폴짝, 드래그해서 던지면 날아가요 (세게 던지면 어지러워해요)
- **밥 주기** — 쿠키를 커서에 들고 원하는 곳에 클릭해서 떨어뜨리면 달려와서 냠냠
- **공놀이** — 공을 차면 펫이 쫓아가서 나한테 다시 차줘요
- **미니게임** — 🍪 *쿠키 받기* (쿠키 받고 🐛 버그 피하기, 30초) · 🏃 *술래잡기* (도망다니는 펫 잡기, 20초)
- **돌보기와 레벨** — 배고픔 · 재미 · 기운이 시간에 따라 줄어서, 심심하거나 배고프면 먼저 와서 조르고 졸리면 자요. 놀아줄수록 레벨 업

<p align="center"><img src="docs/sprite-sheet.png" width="560" alt="스프라이트 시트" /></p>

### ✨ 나만의 캐릭터

사진을 넣으면 [Higgsfield](https://higgsfield.ai)가 나를 닮은 도트 캐릭터로 만들어줘요 — [아래](#나만의-캐릭터-만들기) 참고.

## 설치

[Releases](https://github.com/ESeungJun/claude-bouncer/releases/latest)에서 내 컴퓨터에 맞는 **설치 파일 하나만** 받으면 돼요. git이나 Node.js는 필요 없어요.

| 운영체제 | 파일 |
| --- | --- |
| macOS (Apple 칩 M1~) | `Claude-Bouncer-x.y.z-mac-arm64.dmg` |
| macOS (Intel) | `Claude-Bouncer-x.y.z-mac-x64.dmg` |
| Windows 10/11 | `Claude-Bouncer-x.y.z-win-setup.exe` |

`.zip`은 dmg 대신 쓰는 같은 앱이고, `SHA256SUMS`는 받은 파일이 맞는지 확인하는 체크섬이에요 (`shasum -a 256 -c SHA256SUMS --ignore-missing`).

**macOS 첫 실행** — Apple 공증을 받지 않은 앱이라 "Apple은 'Claude Bouncer'에 … 악성 코드가 없음을 확인할 수 없습니다"가 떠요. dmg에서 앱을 응용 프로그램 폴더로 옮긴 뒤 한 번 열어보고, **시스템 설정 → 개인정보 보호 및 보안** 아래쪽의 **그래도 열기**를 누르세요. "손상되었기 때문에 열 수 없습니다"가 뜨거나 그래도 열기 버튼이 없으면 터미널에서 한 번 실행하세요.
```bash
xattr -dr com.apple.quarantine "/Applications/Claude Bouncer.app"
```

**Windows 첫 실행** — SmartScreen이 막으면 **추가 정보 → 실행**을 누르세요.

설치 후 처음 켜면 Claude Code 훅이 자동으로 등록돼요. 메뉴바(트레이) 아이콘 → **테스트 알림**으로 확인해 보세요. 소스로 실행하던 Claude Bouncer가 있다면 먼저 종료하세요 (둘이 같은 포트를 써요). claude.ai 웹 알림을 쓰려면 아래 [claude.ai 웹 연결](#claudeai-웹-연결)을 따라 확장 프로그램을 불러오세요.

## 소스에서 실행

**필요한 것:** macOS 또는 Windows 10/11 · [Node.js](https://nodejs.org) 18 이상 · [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

```bash
git clone https://github.com/ESeungJun/claude-bouncer.git
cd claude-bouncer
./start.command          # macOS — Finder에서 더블클릭해도 돼요
start.bat                # Windows — 탐색기에서 더블클릭해도 돼요
```

처음 실행하면 의존성 설치와 Claude Code 훅 등록이 자동으로 진행돼요. (훅은 sh · PowerShell 스크립트라서 알림을 받는 데 Node.js가 필요 없어요.) 잘 되는지 보려면 메뉴바(트레이) 아이콘 → **테스트 알림**을 눌러보세요.

<details>
<summary><b>Node.js가 없다면</b></summary>

- macOS: `brew install node` 또는 [nodejs.org](https://nodejs.org)에서 LTS 설치
- Windows: [nodejs.org](https://nodejs.org)에서 LTS 설치 ("Add to PATH" 체크), [Git](https://git-scm.com/download/win)도 필요해요

</details>

<details>
<summary><b>정식 앱으로 빌드</b></summary>

```bash
npm run dist:mac   # .app + DMG + zip
npm run dist:win   # NSIS 설치파일
npm run pack       # 빠른 테스트용 .app
```

결과물은 `dist/`에 생겨요. `.app`을 다른 곳으로 옮겨도 실행할 때마다 훅 경로가 자동으로 갱신돼요. 처음 실행할 때 macOS가 막으면 위 [설치](#설치)의 **macOS 첫 실행**을 따라 하고, Windows SmartScreen이 막으면 "추가 정보 → 실행"을 눌러주세요.

</details>

## 사용법

| 동작 | 결과 |
|---|---|
| 펫 클릭 | 폴짝 + 반응 (대기 중인 알림이 있으면 카드 열기) |
| 더블클릭 | 놀이 메뉴 |
| 우클릭 | 메뉴: 밥 · 공 · 게임 · 재우기 · 패널 · 방해 금지 |
| 좌우로 문지르기 | 쓰다듬기 ♥ |
| 드래그 후 놓기 | 들어서 던지기 |
| 카드 클릭 | 그 터미널 탭으로 이동 |
| <kbd>⌥</kbd><kbd>⇧</kbd><kbd>C</kbd> | 커서 앞으로 부르기 (한 번 더 누르면 카드 닫기) |
| 메뉴바 아이콘 | 패널 · 부르기 · 놀기 · 방해 금지 · 돌아다니기 · 테스트 알림 · 훅 관리 |

**패널 탭:** 🔔 알림 · 🖥 세션 · 🐾 펫 (상태 · 놀기 · 나만의 캐릭터) · ⚙ 설정 (크기 · 돌아다니기 · 효과음 · 시스템 알림 · 방해 금지 · 로그인 시 실행 · 부르기 단축키)

## claude.ai 웹 연결

claude.ai 웹 채팅은 Claude Code 훅이 없어서, 작은 브라우저 확장([`extension/`](extension))이 claude.ai 탭을 지켜보다가 Claude가 답변을 **시작하고 끝낼 때** 앱에 알려줘요. 카드엔 대화 제목 · 내 질문 · 답변 앞부분이 뜨고, 누르면 바로 그 탭으로 돌아가요. 이미 그 탭을 보고 있을 때 끝났으면 카드를 띄우지 않아요.

Chrome · Edge · Brave · Arc 등 크로미움 브라우저에서 동작해요.

1. ⚙ 설정 → **claude.ai 웹 연결** → **설치 방법** → **📁 확장 폴더 열기**. 앱이 접속 토큰을 넣은 확장 사본을 앱 데이터 폴더에 만들어 두니, 그 폴더를 불러오면 돼요.
2. 주소창에 `chrome://extensions` (Edge는 `edge://extensions`) → 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → `extension` 폴더 선택 → claude.ai 탭 새로고침

확장이 앱과 연결되면 설정 화면에 초록색으로 "연결됨"이 떠요. 확장은 claude.ai 페이지만 읽고, `127.0.0.1`(내 컴퓨터)하고만 통신해요.

## 나만의 캐릭터 만들기

<img src="docs/panel-custom-look.png" width="250" align="right" alt="나만의 캐릭터" />

1. 패널 → 🐾 **펫** → **🔗 Higgsfield 계정으로 연결** → 브라우저에서 로그인 · 허용.
   Claude Code의 Higgsfield 커넥터와 같은 MCP 연결이에요.
2. 사진을 끌어다 놓거나 골라서 **닮은 캐릭터 만들기** (30초~1분)
3. 두 가지 버전 중 마음에 드는 쪽 → **이걸로 할래**. 만든 모습은 저장돼서 언제든 바꿔 입을 수 있어요.

**힉스필드 계정이 없다면?** 기본 캐릭터 🐱 고양이 · 🐶 강아지 · 🍙 주먹밥 중에 고르거나, 사진을 고른 뒤 **✉️ 직접 요청하기**를 누르면 메일 쓰기 창이 떠요. 원하는 내용을 적어 보내면 개발자가 만들어서 메일로 보내드려요.

<p align="center"><img src="docs/presets.png" width="560" alt="Built-in looks" /></p>

**스타일 두 가지**

- **🎨 도트 캐릭터 (기본)** — 내 사진, 반려동물, 식물, 물건, 직접 그린 캐릭터 모두 돼요. 사람 모양이 아니어도 괜찮아요 — 고양이는 네 발 고양이 그대로, 선인장은 화분째로, 동작도 몸에 맞게(앞발 내딛기 · 깡총 · 흔들흔들 · 웅크려 자기) 그려요. 사실적으로 그리지 않고 귀여운 치비로 만들되, 색 · 실루엣 · 머리 모양(또는 귀 · 뿔 · 꼬리) · 눈 · 수염 · 액세서리 · 옷 무늬 같은 특징은 그대로 옮기고 없는 건 지어내지 않아요. Higgsfield가 같은 캐릭터의 6컷(가만히 · 깜빡 · 걷기 2컷 · 만세 점프 · 잠자기)을 그리면, 앱이 잘라서 원래 도트 크기를 찾아 애니메이션 프레임으로 써요.
- **🟧 클로디 몸에 입히기** — 클로디 몸통은 그대로 두고 머리 · 피부 · 옷 색만 입혀요. 모든 표정이 그대로 동작하고 안경 · 볼터치를 켤 수 있어요.

한 번 만들 때 이미지 2장(약 3크레딧)이 내 Higgsfield 계정에서 차감돼요. API 키가 편하면 **API 키로 연결하기**에서 [console.higgsfield.ai](https://console.higgsfield.ai)의 Key ID + Secret을 넣어도 돼요.

<p align="center">
  <img src="docs/custom-look-pixel.png" width="600" alt="사람 사진으로 만든 도트 캐릭터" /><br/>
  <img src="docs/custom-look-cat.png" width="600" alt="고양이 사진으로 만든 도트 캐릭터" /><br/>
  <img src="docs/custom-look-cactus.png" width="470" alt="선인장 사진으로 만든 도트 캐릭터" />
</p>

> 게임 · 애니메이션의 유명 캐릭터처럼 저작권이 있는 이미지는 Higgsfield 콘텐츠 정책으로 거절되는 경우가 많아요 (크레딧은 차감되지 않아요).

## 동작 원리

```
Claude Code ──훅──▶ send-notify.sh/.ps1 ──POST 127.0.0.1:17891──▶ Claude Bouncer ──▶ 펫 + 카드
  Stop / Notification /       터미널 앱 · 탭 tty ·               세션 추적, 대화 기록에서
  UserPromptSubmit / SessionEnd   tmux pane 추가                  요청 · 결과 요약 읽기
```

1. 앱이 실행될 때 `~/.claude/settings.json`에 `Stop` · `Notification` · `UserPromptSubmit` · `SessionEnd` 훅 4개를 등록해요. 다른 훅은 건드리지 않고 자기 것만 갱신해요.
2. 훅 스크립트(macOS·Linux는 `send-notify.sh`, Windows는 `send-notify.ps1` — Node.js 불필요)가 이벤트에 "어디서 왔는지"(터미널 앱, 탭의 tty, tmux · Orca 패널)를 붙여 사용자별 토큰과 함께 앱으로 보내요. 앱이 꺼져 있어도 Claude 세션엔 아무 영향이 없어요.
3. 앱이 세션별 상태를 추적하고, 대화 기록에서 마지막 요청과 결과 요약을 읽어 카드를 만들어요.
4. 펫은 화면 전체를 덮는 투명 창 위에서 움직이고, 펫 · 카드 · 메뉴 위에서만 마우스를 받아요. 나머지 클릭은 그대로 아래 앱으로 통과해요.

**감지 범위**

| Claude를 쓰는 곳 | 감지 |
|---|---|
| 터미널 · VS Code · Cursor · JetBrains의 Claude Code (이 컴퓨터) | ✅ 훅으로 |
| Chrome · Edge · Brave · Arc의 claude.ai | ✅ [브라우저 확장](#claudeai-웹-연결)으로 |
| Claude 데스크톱 앱 채팅 | ❌ 앱이 알려줄 방법이 아직 없어요 |
| 웹에서 실행하는 Claude Code (클라우드 세션) | ❌ 클라우드에서 돌아서 이 컴퓨터로 신호를 못 보내요 |

## 개인정보와 보안

- 로컬 서버는 `127.0.0.1`에서만 열리고 `Host` 헤더를 확인하며, JSON 요청만 받고 웹 페이지 요청은 거절해요. 훅 요청은 나만 읽을 수 있는 무작위 토큰(`~/.claude/claude-bouncer.token`)이 있어야 해서 다른 프로그램이 가짜 카드를 넣을 수 없어요. claude.ai 확장은 claude.ai 채팅만 알릴 수 있어요.
- 설치형 앱은 Electron 보안 퓨즈를 켜서(`ELECTRON_RUN_AS_NODE` · `NODE_OPTIONS` · 디버거 플래그 차단) 앱을 다른 용도로 악용할 수 없게 했고, 창 안에서의 페이지 이동 · 팝업도 막아요.
- 카드를 눌러 폴더를 열 때는 실제 폴더만 열고, 알림에 담긴 파일이나 앱은 절대 실행하지 않아요.
- 요청 · 결과 요약은 내 컴퓨터에만 저장돼요 (macOS: `~/Library/Application Support/claude-bouncer`).
- Higgsfield 로그인 토큰과 API 키는 OS 키체인으로 암호화해서 저장하고 평문으로는 절대 저장하지 않아요. API 키는 Higgsfield API 주소로만 보내요.
- 외부로 나가는 건 "나만의 캐릭터" 기능뿐이에요 — 캐릭터를 만들기 위해 사진이 Higgsfield로 전송되거나, "제작 요청"에서 동의하고 보내면 개발자 메일로 전달돼요 (FormSubmit 경유).

## 문제 해결

<details>
<summary><b>펫이 안 보여요</b></summary>

메뉴바 아이콘 → **펫 부르기** 또는 단축키를 눌러보세요. 방해 금지가 켜져 있는지도 확인해 주세요.
</details>

<details>
<summary><b>알림이 안 와요</b></summary>

`~/.claude/settings.json`에 `send-notify.sh`(Windows는 `send-notify.ps1`)를 가리키는 훅이 있는지 확인하고, 메뉴바 아이콘 → **테스트 알림**이 되는지 보세요. 메뉴바 아이콘 → **Claude Code 훅 → 다시 설치**로 다시 등록할 수 있어요.
</details>

<details>
<summary><b>단축키가 안 먹어요</b></summary>

다른 앱이 같은 조합을 쓰고 있을 수 있어요. ⚙ 설정 → **부르기 단축키**에서 다른 키로 바꾸면 충돌 여부를 바로 알려줘요.
</details>

<details>
<summary><b>포트 17891이 이미 사용 중이래요</b></summary>

macOS: `lsof -i :17891` · Windows: `netstat -ano | findstr :17891` — 충돌하는 프로세스를 종료한 뒤 다시 실행해 주세요.
</details>

<details>
<summary><b>macOS "확인되지 않은 개발자" 경고</b></summary>

`start.command`를 우클릭 → 열기로 한 번만 허용하면 다음부턴 안 떠요.
</details>

<details>
<summary><b>제거하기</b></summary>

`npm run uninstall-hook` (또는 메뉴바 아이콘 → **Claude Code 훅 → 제거**) 후 폴더나 앱을 지우면 돼요.
</details>

## 개발

```bash
npm start          # 소스로 실행
npm test           # 단위 테스트: 세션, 서버, 저장소, 스프라이트, 스킨, Higgsfield 클라이언트
npm run sprites    # docs/sprite-sheet.png 다시 만들기
npm run template   # assets/skin-template.png 다시 만들기 (Higgsfield에 보내는 템플릿)
```

### 릴리스

- `master`는 개발용이에요. 모든 변경은 PR로 들어가요.
- `release`는 배포용이에요. 릴리스하려면 master에서 `package.json`의 `version`을 올리고, **master → release** PR을 만들어 머지해요.
- 머지되면 [`.github/workflows/release.yml`](.github/workflows/release.yml)이 돌아요: 테스트 → `v<버전>` **임시 저장(draft) 릴리스** 생성 → macOS(Apple Silicon · Intel) · Windows 설치 파일 첨부. 확인한 뒤 *Publish release*를 누르면 공개돼요. 이미 공개된 버전은 절대 덮어쓰지 않아요.

```
main.js                 앱 생명주기, 오버레이 · 패널 창, 트레이, IPC, 단축키
lib/
  sessions.js           세션 추적, 대화 기록 요약, git 브랜치, 터미널 이름
  server.js             로컬 훅 수신 서버
  focus.js              알맞은 터미널 탭으로 이동
  higgsfield-mcp.js     MCP(OAuth)로 Higgsfield 연결 — 나만의 캐릭터
  higgsfield.js         Higgsfield API 키 클라이언트 + 프롬프트
  store.js              JSON 저장
extension/              claude.ai 브라우저 확장 (MV3)
renderer/
  overlay.*, js/        펫: 스프라이트, 행동, 카드, 게임, 효과음
  js/pixelize.js        생성된 그림 → 도트 프레임
  panel.*, maker.js     알림함, 세션, 펫, 설정, 나만의 캐릭터
scripts/                훅 스크립트(send-notify.sh / .ps1) + 설치 스크립트
tools/                  스프라이트 시트 · 스킨 미리보기 · PNG 도구
```

## 만든 이야기와 참고

- [Shimeji](https://en.wikipedia.org/wiki/Shimeji_(software)), [Desktop Goose](https://samperson.itch.io/desktop-goose), [VPet](https://store.steampowered.com/app/1920960/VPet/), 다마고치, 그리고 Claude Code 상태를 도트 펫으로 보여주는 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)에서 영감을 받았어요. Claude Bouncer는 **같이 놀기**와 **알림 출처를 확실하게 보여주기**에 집중했어요.
- 캐릭터 컨셉 시트와 앱 아이콘은 [Higgsfield](https://higgsfield.ai)로 만들었고(`docs/concept/`), 앱 속 스프라이트는 코드로 한 픽셀씩 찍었어요(`renderer/js/sprites.js`).
- 폰트: [Galmuri](https://github.com/quiple/galmuri) (SIL Open Font License 1.1)

## 라이선스

[MIT](LICENSE) © ESeungjun
