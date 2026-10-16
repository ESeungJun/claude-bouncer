#!/bin/sh
# Claude Code hook → Claude Bouncer (macOS / Linux).
#   sh send-notify.sh <stop|notification|submit|end>
# Posts the hook's JSON payload (stdin) to the app on 127.0.0.1, with where
# it came from (terminal app, tab tty, tmux / Orca pane) in headers.
# Needs only /bin/sh, ps and curl. Prints nothing and always exits 0, so it
# can never disturb a Claude session.

KIND="${1:-stop}"
case "$KIND" in stop|notification|submit|end) ;; *) KIND=stop ;; esac

TOKEN=""
TOKEN_FILE="$HOME/.claude/claude-bouncer.token"
[ -r "$TOKEN_FILE" ] && TOKEN=$(head -c 128 "$TOKEN_FILE" | tr -cd 'A-Za-z0-9')

# The tab's tty identifies the exact terminal tab; walk up a few parents since
# the hook's own shell may be detached. Only cards need it (stop/notification).
TTY_=""
if [ "$KIND" = stop ] || [ "$KIND" = notification ]; then
  pid=$PPID
  i=0
  while [ "$i" -lt 5 ] && [ "${pid:-1}" -gt 1 ] 2>/dev/null; do
    line=$(ps -o tty= -o ppid= -p "$pid" 2>/dev/null)
    t=$(echo "$line" | awk '{print $1}')
    parent=$(echo "$line" | awk '{print $2}')
    case "$t" in ""|"?"|"??") ;; *) TTY_="/dev/${t#/dev/}"; break ;; esac
    pid=$parent
    i=$((i + 1))
  done
fi

# port: digits only (anything else could point the request somewhere else)
PORT="${CLAUDE_BOUNCER_PORT:-17891}"
case "$PORT" in ""|*[!0-9]*) PORT=17891 ;; esac

# header-safe: one line, printable ASCII, capped
h() { printf '%s' "$1" | tr -cd '[:print:]' | cut -c1-200; }

# --noproxy: never send this through an HTTP proxy from the environment
curl -s -m 2 --noproxy '*' -o /dev/null -X POST "http://127.0.0.1:$PORT/notify" \
  -H 'Content-Type: application/json' \
  -H "X-Claude-Bouncer-Token: $TOKEN" \
  -H "X-CB-Kind: $KIND" \
  -H "X-CB-Term-Program: $(h "$TERM_PROGRAM")" \
  -H "X-CB-Term-Session: $(h "${ITERM_SESSION_ID:-$TERM_SESSION_ID}")" \
  -H "X-CB-Bundle-Id: $(h "$__CFBundleIdentifier")" \
  -H "X-CB-Terminal-Emulator: $(h "$TERMINAL_EMULATOR")" \
  -H "X-CB-Tmux: $(h "$TMUX")" \
  -H "X-CB-Tmux-Pane: $(h "$TMUX_PANE")" \
  -H "X-CB-Orca-Pane: $(h "$ORCA_AGENT_PANE")" \
  -H "X-CB-Orca-Tab: $(h "$ORCA_TAB_ID")" \
  -H "X-CB-Tty: $(h "$TTY_")" \
  --data-binary @- >/dev/null 2>&1
exit 0
