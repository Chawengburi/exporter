#!/bin/bash
# วางไฟล์ "Exporter - FoodStory Daily" ไว้บน Desktop ของผู้ใช้ที่รันคำสั่งนี้ (ticket 02 ของ exporter-ubuntu-deploy)
#
#   bash exporter/launchers/install-desktop-launcher.sh      ← รันในบัญชีของคนที่จะใช้เครื่อง ห้ามใส่ sudo
#
# macOS  → symlink ไป foodstory-daily.command (ดับเบิลคลิกแล้ว Terminal เปิดเอง — ห้ามก๊อปไฟล์ ก๊อปแล้วหาโฟลเดอร์ exporter ไม่เจอ)
# Ubuntu → ไฟล์ .desktop (Terminal=true) บน Desktop + เมนูแอป · ตั้ง executable และ metadata::trusted (GNOME ไม่ยอมเปิด
#          launcher ที่ไม่ trusted) · path ใน Exec เป็น path จริงของเครื่องนี้ จึงสร้างตอนติดตั้ง ไม่ commit ไว้ใน repo
# รันซ้ำได้ · ไม่เขียนทับไฟล์ชื่อเดียวกันที่ไม่ได้สร้างจากสคริปต์นี้ · ตรวจทุกปลายทางก่อนเขียน (ไม่ติดตั้งครึ่งเดียว)
set -euo pipefail

NAME="Exporter - FoodStory Daily"
MARKER="X-Chawengburi-Launcher=foodstory-daily"
TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/foodstory-daily.command"
[ -f "$TARGET" ] || { echo "✘ ไม่พบ $TARGET" >&2; exit 1; }

refuse() {
  echo "✘ มีไฟล์ชื่อนี้อยู่แล้วและไม่ใช่ของสคริปต์นี้: $1" >&2
  echo "  ตรวจดูแล้วลบเอง (ถ้าไม่ใช้แล้ว) แล้วรันคำสั่งนี้ใหม่" >&2
  exit 1
}

# sudo บน Ubuntu ตั้ง HOME เป็น /root — ไอคอนจะไปอยู่บน Desktop ของ root แล้วบอกว่าสำเร็จ ทั้งที่ผู้ใช้ไม่เห็นอะไรเลย
if [ "$(id -u)" -eq 0 ]; then
  echo "✘ อย่ารันคำสั่งนี้ด้วย sudo/root — รันในบัญชีของคนที่จะดับเบิลคลิก (ไอคอนจะไปอยู่บน Desktop ของบัญชีที่รัน)" >&2
  exit 1
fi

# Desktop ของ Ubuntu ภาษาไทยอาจชื่อ "เดสก์ท็อป" — ถามจาก xdg-user-dir ก่อน
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
[ -n "$DESKTOP" ] && [ "$DESKTOP" != "$HOME" ] || DESKTOP="$HOME/Desktop"
mkdir -p "$DESKTOP"

if [ "$(uname -s)" = "Darwin" ]; then
  LINK="$DESKTOP/$NAME.command"
  if [ -L "$LINK" ]; then
    CURRENT="$(readlink "$LINK")"
    if [ "$CURRENT" = "$TARGET" ]; then
      echo "✔ มีอยู่แล้ว: $LINK"
      exit 0
    fi
    # symlink ของเราเองที่ชี้ไปตำแหน่ง repo เก่า (ย้ายโฟลเดอร์) → ชี้ใหม่ · ชี้ไปอย่างอื่น = ไม่ใช่ของเรา
    case "$CURRENT" in */launchers/foodstory-daily.command) rm "$LINK" ;; *) refuse "$LINK" ;; esac
  elif [ -e "$LINK" ]; then
    refuse "$LINK"
  fi
  ln -s "$TARGET" "$LINK"
  echo "✔ วางไว้บน Desktop แล้ว: $LINK"
  exit 0
fi

# ── Linux (.desktop) ──
case "$TARGET" in
  *'"'* | *'`'* | *'$'* | *'\'*) echo "✘ path ของ exporter มีอักขระที่ใส่ในไฟล์ .desktop ไม่ได้: $TARGET" >&2; exit 1 ;;
esac
EXEC_PATH="${TARGET//%/%%}" # Desktop Entry spec: % ตัวเดียวคือ field code (%f %u ...) ต้องเขียนเป็น %%
ENTRY="[Desktop Entry]
Type=Application
Version=1.0
Name=$NAME
Comment=ดึงรายงาน FoodStory ของเมื่อวาน — กด captcha ครั้งเดียว แล้วรอสรุป
Exec=bash \"$EXEC_PATH\"
Terminal=true
Icon=utilities-terminal
Categories=Office;
$MARKER"

DESKTOP_FILE="$DESKTOP/$NAME.desktop"
MENU_FILE="$HOME/.local/share/applications/foodstory-daily.desktop"

# ตรวจทุกปลายทางก่อนเขียนอะไรเลย · symlink = ไม่ใช่ของเรา (printf จะเขียนทะลุไปสร้างไฟล์ที่ปลายทางของ symlink)
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
  echo "⚠ ตั้งค่า \"ไว้ใจ\" ให้ไอคอนเองไม่ได้ — ครั้งแรกให้คลิกขวาที่ไอคอนบน Desktop แล้วเลือก \"Allow Launching\""
fi
echo "✔ วางไว้บน Desktop แล้ว: $DESKTOP_FILE (และในเมนูแอป)"
