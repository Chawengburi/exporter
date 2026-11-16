# exporter

Pulls reports from websites that have no API, using Playwright, and stores them on disk — **HotelTime** (hotel PMS, runs automatically every day through Windmill) and
**FoodStory** (restaurant POS, staff double-click an icon and solve the captcha themselves once a day).

> This repo is the source of the project (developed and committed here directly) · the Ubuntu machine's administrator updates it with `git pull` as described in the guide.

## Layout

| Folder | What it is |
|---|---|
| `exporter/` | The program (Node.js ≥ 22.18 + Playwright) — start at [`exporter/README.md`](exporter/README.md) |
| `exporter/launchers/` | Double-click files for staff (FoodStory daily) |
| `windmill/` | The scheduler that runs the daily jobs (Docker) — [`windmill/INSTALL.md`](windmill/INSTALL.md) |
| `docs/` | Ubuntu administrator guide, FoodStory staff guide, user guides, CLI tutorial (mostly Thai) |

## Installing on Ubuntu Desktop

The administrator first installs **Node.js 22.18+** and **Docker (with docker compose)** and adds the machine's **deploy key** (this repo is private —
the steps are in [`docs/UBUNTU-ADMIN-GUIDE.md`](docs/UBUNTU-ADMIN-GUIDE.md), "before installing"). Then, in the account of the person who will use the machine (do not use sudo):

```bash
git clone git@github.com:Chawengburi/exporter.git ~/chawengburi-exporter
cd ~/chawengburi-exporter
bash deploy/ubuntu/install.sh
```

The installer installs the packages and Chromium, asks for the HotelTime/FoodStory passwords and writes `exporter/.env`, sets the go-live date to the install date, asks for the
Discord webhook URL (optional), generates the Windmill database password, places the "Exporter - FoodStory Daily" icon on the Desktop, starts and configures Windmill, and tries a
HotelTime login · it can always be re-run (it never touches values already in `.env` — it only fills in what is missing).

**Administrator guide (install, routine work, checking status, troubleshooting, updating): [`docs/UBUNTU-ADMIN-GUIDE.md`](docs/UBUNTU-ADMIN-GUIDE.md)**

| Folder | What it is |
|---|---|
| `deploy/ubuntu/` | The install script (`install.sh`) and its Docker test harness |

## What is deliberately not in this repo

- `exporter/.env`, `windmill/.env` — passwords and settings, created from `.env.example` on the installed machine. **Never commit.**
- `exporter/data/` — pulled files, containing customer and sales data. **Never commit or pass on.**
- `exporter/.auth/` — browser sessions
- Web recon notes that contain private paths — kept separately in the internal documentation store, not in this repo (decision records, ADRs, are in `docs/adr/`)
