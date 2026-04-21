# CollectCore — Release Guide

How to build and distribute the Windows installer to the household user.

---

## One-Time Setup (Do This Once)

These steps only need to be done the first time, or after a fresh checkout.

### 1. Install Inno Setup

Double-click `C:\Dev\CollectCore-Build\innosetup-6.7.1.exe` and install it.
Accept all defaults. You only ever need to do this once per machine.

### 2. Verify the build directory exists

Make sure `C:\Dev\CollectCore-Build\` exists and contains:

```
C:\Dev\CollectCore-Build\
  app\
    backend\          ← Python source files
    frontend\dist\    ← Built React app
    python\           ← Python embeddable runtime (no install needed on target)
    launcher.ps1      ← App launcher (PowerShell)
    stop.ps1          ← Stop script (PowerShell)
    collectcore.ico
  collectcore.iss     ← Inno Setup script
  build-release.bat   ← The release build script
  output\             ← Created automatically; installer goes here
```

If `app\` is missing or empty (e.g. after a machine rebuild), re-run the
assembly steps from the distribution plan before continuing.

---

## Building a New Release

Run `build-release.bat` from a terminal — do not double-click it, because
the window will close before you can read any error output:

```
cd C:\Dev\CollectCore-Build
.\build-release.bat
```

Enter the version number when prompted (e.g. `1.1.0`).
Use the format `MAJOR.MINOR.PATCH`:
- Bump the last number for small fixes (1.0.1, 1.0.2 …)
- Bump the middle number for new features/modules (1.1.0, 1.2.0 …)

The script will automatically:
- Build the React frontend (`npm run build`)
- Copy all updated source files to `C:\Dev\CollectCore-Build\app\`
- Update the version number in the installer script
- Compile the installer with Inno Setup (~30 seconds)
- Open the output folder when done

The finished installer is at:
`C:\Dev\CollectCore-Build\output\CollectCore-Setup-X.X.X.exe`

---

## Distributing to the Household User

### Option A — Shared Dropbox / OneDrive folder (recommended)

1. Copy the `.exe` to the shared folder.
2. Tell them: "There's a new version of CollectCore in the shared folder.
   Double-click it to update."

### Option B — USB drive

Copy the `.exe` to a USB drive and hand it to them.

### Option C — Network share

Copy the `.exe` to a shared network folder they can access.

---

## What the Household User Does to Install / Update

1. Double-click `CollectCore-Setup-X.X.X.exe`
2. Windows may show a SmartScreen warning — click **More info**, then **Run anyway**
   (This appears because the installer is unsigned — it's normal for household software)
3. Click through the installer wizard (all defaults are fine)
4. Check the "Launch CollectCore now" box at the end and click Finish

**Their collection data is never affected by updates.** The database and images
live in `C:\Users\<name>\AppData\Roaming\CollectCore\` and the installer never
touches that folder.

**Upgrading:** Inno Setup detects the existing install by AppId and upgrades
in place — no manual uninstall needed on the target machine.

---

## Key Installer Decisions

- `PrivilegesRequired=lowest` — installs per-user to `AppData\Local`, no UAC prompt
- Desktop shortcut uses `{userdesktop}` (user's own Desktop, no admin rights needed)
- App data (database, images) flagged `uninsneveruninstall` — survives upgrades

---

## Testing Before You Ship

Before handing the installer to the household user, do a quick smoke test:

1. Run the installer on your own machine (or a second Windows account)
2. Confirm the desktop shortcut appears
3. Double-click the shortcut — app should open in ~5 seconds
4. Verify the collection module you changed actually works
5. Test "Stop CollectCore" from the Start Menu shortcut

---

## If a New Module Adds Database Tables

New tables use `CREATE TABLE IF NOT EXISTS` — they are created automatically
on first launch of the new version. No action needed.

If a new version adds **columns to existing tables**, the schema change needs
to be handled before releasing:

1. Open `backend/sql/schema.sql`
2. Add the new column using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
   as a separate statement after the `CREATE TABLE` block
3. Test on your machine first (start the backend fresh — it runs schema on startup)
4. Then build the release as normal

---

## Troubleshooting

**The installer fails to run on the other PC**
→ Make sure they clicked "More info → Run anyway" on the SmartScreen warning.

**The app doesn't open after install / nothing happens when clicking the shortcut**
→ Check the backend logs (see below).

**The app shows "CollectCore failed to start"**
→ Open the log files shown in the error dialog. `backend-err.log` is usually
the one with the useful error. Common causes:

| Symptom in log | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError` | Bundled Python env missing packages | Rebuild installer after fixing Python env |
| `sqlite3.IntegrityError: FOREIGN KEY constraint failed` | Schema seed data issue | Check `schema.sql` for hardcoded collection_type IDs — should use subquery lookups by code |
| No log files created at all | Python executable not found | Verify `%LOCALAPPDATA%\CollectCore\python\python.exe` exists |
| Port already in use | Stale process from a previous session | Restart machine or kill process on port 8001 manually |

**Log file locations:**
- `%APPDATA%\CollectCore\backend-err.log` — stderr (crashes, import errors)
- `%APPDATA%\CollectCore\backend-out.log` — stdout (startup messages)

**"Inno Setup not found" error when running build-release.bat**
→ Install Inno Setup from `C:\Dev\CollectCore-Build\innosetup-6.7.1.exe`

**build-release.bat fails at the frontend build step**
→ Run `npm install` in `C:\Dev\CollectCore\frontend\` first,
then retry. This can happen after a fresh checkout.
