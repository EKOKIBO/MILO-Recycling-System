# MILO Recovery & Install Kit

Everything needed to bring a MILO machine back from a reboot, a corrupted SD
card, or a blank Raspberry Pi — and to keep it updated without ever plugging in
a keyboard again.

---

## First: point the kit at your own GitHub and website

Edit **one file** — `deploy/kit.conf` — then rebuild the frontend:

```bash
MILO_REPO="your-github-user/your-repo"     # OTA updates pull from here
MILO_SITE="https://your-app-domain"        # where the web app is published
MILO_MODEL_BASE="${MILO_SITE}/models"      # where the .hef files live
```

```bash
cd frontend && npm run build   # republishes /recovery/* with your addresses
```

The installer, updater, repair UI, technician commands and the web app's
download card all read from there — nothing else needs editing.

### Private repositories

If your repo is private, create a fine-grained GitHub token with read-only
**Contents** access and put it on the machine:

```bash
sudo nano /opt/milo/data/config.env      # MILO_GITHUB_TOKEN=github_pat_...
sudo systemctl restart milo-core
```

The token stays on the machine (`chmod 640`), is never sent to browsers, and is
used for both update checks and downloads. Note that the public `install.sh`
one-liner cannot fetch a private repo — bootstrap those machines with
`--source local` (USB bundle) or host the bundle on your website.

---

## The one command

```bash
curl -fsSL https://<your-site>/recovery/install.sh | sudo bash
```

Safe to run on a working machine (it repairs and re-verifies), safe to run
twice, and it never destroys data.

**First install of a new school machine:**

```bash
curl -fsSL https://milo-robotics.org/recovery/install.sh | sudo bash -s -- \
     --machine-id school-1 --machine-name "MILO School" --machine-env school
```

---

## What survives what

| | Reboot | `--repair` | OTA update | Full reinstall | SD card death |
|---|---|---|---|---|---|
| Points, users, history | ✅ | ✅ | ✅ | ✅ | restore from backup |
| Machine identity & config | ✅ | ✅ | ✅ | ✅ | re-enter (or restore) |
| AI model (.hef) | ✅ | ✅ | ✅ | re-downloaded | re-downloaded |
| Application code | ✅ | replaced | replaced | replaced | replaced |

The reason this works: **mutable state lives outside the code.**

```
/opt/milo/
├── current -> releases/2026-07-23.1   ← swapped atomically on update
├── releases/                          ← last 3 kept, for instant rollback
├── venv/                              ← python environment
├── models/milo.hef                    ← AI model
├── data/                              ← ⚠ PRECIOUS: database + config.env
├── backups/                           ← ⚠ PRECIOUS: daily snapshots
└── logs/
```

---

## After a reboot: nothing to do

Four systemd units are enabled at install time, so the machine comes back on
its own:

| Unit | Job |
|---|---|
| `milo-core` (or `milo-edge`) | the application; `Restart=always`, restarts in 5 s if it ever exits |
| `milo-config-ui` | the repair web page on port 8088 |
| `milo-health.timer` | every 5 min: checks health, restarts anything that died |
| `milo-update.timer` | every 12 h: checks for and installs updates |
| `milo-backup.timer` | daily database snapshot, 14 kept |

`Restart=always` handles crashes. `milo-health.timer` handles the nastier case —
a process that is technically alive but wedged — and logs what it healed to the
journal (`journalctl -t milo-doctor`).

---

## The repair UI (no SSH needed)

Every machine serves a page styled like the MILO app:

```
http://<pi-ip>:8088       PIN shown at the end of the install
```

Forgot the PIN? On the machine: `sudo milo ui`

From it a technician can: see every health check, restart the app or broker,
view logs, check/install/roll back updates, back up or restore the database,
change machine identity/theme/broker, and reboot.

It is standard-library Python only, so **it still loads when the app, the venv
or the broker are broken** — which is exactly when it is needed.

---

## Technician commands

```bash
milo status          # is it running?
milo doctor          # full health check  (--heal to auto-fix)
milo logs            # live logs
milo restart
milo update          # check + install    (milo rollback to undo)
milo backup          # snapshot now       (milo backup --list)
milo restore FILE    # restore a snapshot
milo config          # edit configuration
milo version
```

---

## Over-the-air updates

Push to GitHub → machines update themselves within 12 hours. No manual upload.

- **stable** channel (default): installs the newest GitHub **release tag**
- **beta** channel: installs the newest commit on the branch

Every update: backs up the database → syntax-checks the new code → installs it
beside the old one → swaps the `current` symlink → restarts → **must pass a
health check within 60 seconds, or it is rolled back automatically.**

```bash
milo update --check     # what's available, change nothing
milo update             # install now
milo rollback           # back to the previous release
```

Disable on a critical machine: set `MILO_UPDATE_ENABLED=0` in
`/opt/milo/data/config.env` (or toggle it in the repair UI).

---

## Recovery scenarios

### The Pi rebooted
Nothing to do. Confirm with `milo status`.

### The app is misbehaving
```bash
sudo milo doctor --heal      # or press "Run diagnostics & fix" in the UI
```

### An update broke something
```bash
sudo milo rollback
```

### The SD card is corrupted / the Pi is replaced
1. Flash Raspberry Pi OS (64-bit, Bookworm or newer).
2. Enable SSH and connect it to the network.
3. Run the one-liner at the top of this document.
4. Restore the data:
   ```bash
   sudo milo-backup --restore /path/to/backup.db
   ```
   Backups live in `/opt/milo/backups`. Keep an off-machine copy — see below.

### No internet at the site
Build a bundle beforehand on any working machine:
```bash
sudo milo-bundle --with-wheels --out /media/usb
```
Then on the dead machine:
```bash
sudo bash install.sh --source local --file /media/usb/milo-kit-*.tar.gz
```

### Installing from your website or Google Drive
```bash
sudo bash install.sh --source url --url https://milo-robotics.org/recovery/milo-kit.tar.gz
sudo bash install.sh --source url --url "https://drive.google.com/file/d/<FILE_ID>/view"
```
The installer handles Google Drive's large-file confirmation page.

---

## Off-machine backups (do this once)

Daily snapshots on the same SD card do not survive that SD card. Add a copy
somewhere else, e.g. hourly to a USB stick:

```bash
sudo crontab -e
# 0 * * * * /usr/local/bin/milo-backup --export /media/usb/milo-latest.db
```

or push to any host you control with `rsync`/`rclone` from the same hook.

---

## Raspberry Pi AI HAT+ notes

The installer handles all of this, but for diagnosis:

| Symptom | Cause | Fix |
|---|---|---|
| `/dev/hailo0` missing | PCIe off, or reboot pending | installer adds `dtparam=pciex1` to `config.txt` → **reboot** |
| `import hailo` fails | HailoRT not installed | `sudo apt install hailo-all && sudo reboot` |
| `import hailo_apps` fails | hailo-apps-infra missing | install it into `/opt/milo/venv` (needs `--system-site-packages`, which the installer uses) |
| Detections never fire | wrong `.hef` for the chip | Hailo-8 and Hailo-8L need **different** models; `milo-doctor` prints which chip is fitted |
| Random freezes | undervoltage | use the official 27 W PSU; `milo doctor` flags the throttling bit |

Check the accelerator directly:
```bash
hailortcli fw-control identify
```

---

## Security notes

- Broker passwords are generated per machine at install and written to both
  `config.env` and the mosquitto password file in the same step, so they cannot
  drift apart.
- The repair UI is PIN-protected, rate-limited (5 tries / 5 min), and exposes a
  **fixed set of named actions** — nothing typed in the browser is ever executed
  as a shell command.
- `config.env` is `chmod 640`; secrets are never sent to the browser.
- The UI listens on the LAN. If a machine sits on an untrusted network, restrict
  it:
  ```bash
  sudo ufw allow from 192.168.0.0/16 to any port 8088
  ```

---

## Sanity check after any recovery

```bash
milo doctor
```
Green across the board means: services up, broker authenticating, AI
accelerator and model present, serial link alive, database intact, backups
recent, disk and temperature healthy.
