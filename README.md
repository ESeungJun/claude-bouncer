# claude-bouncer

Claude Code 세션이 응답을 끝내거나 사용자 입력을 기다릴 때 튀어오르며 알려주는 데스크탑 펫.

https://github.com/user-attachments/assets/ff363262-e4e2-40e7-8406-261baa0feb7f

## 요구사항

- macOS
- Node.js (npm 포함)
- `jq` — `brew install jq`
- Claude Code

## 사용법

```bash
git clone <this-repo>
cd claude-bouncer
./start.command
```

최초 실행 시 `npm install`과 Claude Code 훅 설치(`~/.claude/settings.json`)가 자동으로 진행됩니다.

## 훅 제거

```bash
npm run uninstall-hook
```
