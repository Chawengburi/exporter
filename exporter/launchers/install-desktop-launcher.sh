#!/bin/bash
# Places the "Exporter - FoodStory Daily" file on the Desktop of the user who runs this command (ticket 02 of exporter-ubuntu-deploy)
#
#   bash exporter/launchers/install-desktop-launcher.sh      <- run in the account of the person who will use the machine, without sudo
#
# macOS  -> a symlink to foodstory-daily.command (double-click and Terminal opens by itself — do not copy the file, a copy cannot find the exporter folder)
# Ubuntu -> a .desktop file (Terminal=true) on the Desktop + in the app menu · made executable and given metadata::trusted (GNOME refuses to open an
#          untrusted launcher) · the path in Exec is this machine's real path, so it is created at install time and not committed to the repo
# Safe to re-run · does not overwrite a file with the same name that this script did not create · checks every destination before writing (no half installs)
set -euo pipefail

NAME="Exporter - FoodStory Daily"
MARKER="X-Chawengburi-Launcher=foodstory-daily"
TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/foodstory-daily.command"
[ -f "$TARGET" ] || { echo "✘ Not found: $TARGET" >&2; exit 1; }

refuse() {
  echo "✘ A file with this name already exists and is not from this script: $1" >&2
  echo "  Check it and delete it yourself (if it is no longer needed), then run this command again" >&2
  exit 1
}

# sudo on Ubuntu sets HOME to /root — the icon would land on root's Desktop and report success while the user sees nothing
if [ "$(id -u)" -eq 0 ]; then
  echo "✘ Do not run this command with sudo/root — run it in the account of the person who will double-click (the icon goes on the Desktop of the account that runs it)" >&2
  exit 1
fi

# the Desktop of a Thai-language Ubuntu may be named "เดสก์ท็อป" — ask xdg-user-dir first
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESKTOP" ] && [ "$DESKTOP" != "$HOME" ] || DESKTOP="$HOME/Desktop"
mkdir -p "$DESKTOP"

if [ "$(uname -s)" = "Darwin" ]; then
  LINK="$DESKTOP/$NAME.command"
  if [ -L "$LINK" ]; then
    CURRENT="$(readlink "$LINK")"
    if [ "$CURRENT" = "$TARGET" ]; then
      echo "✔ Already exists: $LINK"
      exit 0
    fi
    # our own symlink pointing at an old repo location (the folder was moved) -> repoint it · pointing anywhere else = not ours
    case "$CURRENT" in */launchers/foodstory-daily.command) rm "$LINK" ;; *) refuse "$LINK" ;; esac
  elif [ -e "$LINK" ]; then
    refuse "$LINK"
  fi
  ln -s "$TARGET" "$LINK"
  echo "✔ Placed on the Desktop: $LINK"
  exit 0
fi

# ── Linux (.desktop) ──
case "$TARGET" in
  *'"'* | *'`'* | *'$'* | *'\'*) echo "✘ The exporter path contains characters that cannot go in a .desktop file: $TARGET" >&2; exit 1 ;;
esac
EXEC_PATH="${TARGET//%/%%}" # Desktop Entry spec: a single % is a field code (%f %u ...) and must be written as %%
ENTRY="[Desktop Entry]
Type=Application
Version=1.0
Name=$NAME
Comment=Pull yesterday's FoodStory reports — solve the captcha once, then wait for the summary
Exec=bash \"$EXEC_PATH\"
Terminal=true
Icon=utilities-terminal
Categories=Office;
$MARKER"

DESKTOP_FILE="$DESKTOP/$NAME.desktop"
MENU_FILE="$HOME/.local/share/applications/foodstory-daily.desktop"

# check every destination before writing anything · a symlink = not ours (printf would write through it and create a file at the symlink's target)
for file in "$DESKTOP_FILE" "$MENU_FILE"; do
  if [ -L "$file" ]; then refuse "$file"; fi
  if [ -e "$file" ] && ! grep -qxF "$MARKER" "$file"; then refuse "$file"; fi
done
for file in "$DESKTOP_FILE" "$MENU_FILE"; do
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$ENTRY" >"$file"
  chmod +x "$file"
done
if command -v gio >/dev/null 2>&1 && gio set "$DESKTOP_FILE" metadata::trusted true 2>/dev/null; then
  :
else
  echo "⚠ Could not mark the icon as \"trusted\" automatically — the first time, right-click the icon on the Desktop and choose \"Allow Launching\""
fi
echo "✔ Placed on the Desktop: $DESKTOP_FILE (and in the app menu)"
