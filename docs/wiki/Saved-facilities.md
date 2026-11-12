# Saved facilities and portable backups

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)

![Workflow diagram for saved facilities.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/preserve.svg)

**Quick path:** Save each site separately → Export plan for one site → Export all facilities for a collection backup → verify imports before replacing work.

Fresh browser installs open **My facility** as a blank local grid. No example buildings, cameras, routes or fictional site boundary are added. If saved work already exists, the last active facility opens instead.

## Everyday use

- **New facility** creates a separate named, blank plan.
- **Saved facility** switches between plans. Each has independent geometry, camera placements, floors, openings, stairs, pathways and zones.
- **Duplicate facility** makes an independent planning copy.
- Rename the current facility with **Facility name → Save site**.
- **Export plan** saves a portable file named for the facility, such as `dvr-campus-north.json`.
- **Backup & examples → Export all facilities** saves the entire collection as `dvr-facilities-backup.json`.
- **Import plan**, **Paste JSON** and **Import facility file** add separate facilities. They preserve existing authored facilities. Importing the same file twice creates two independent entries. A full 30-facility backup can use the untouched blank starter slot on a fresh install, so the complete backup fits.
- **Open example facility** is optional and adds a separate example. It does not replace saved work.

Applied edits save automatically in this browser. Unsaved editor drafts must be applied or discarded before switching facilities or importing. Switching facilities clears the editor's selection/Undo history and disconnects its camera preview. No camera starts automatically in the destination.

## Storage and recovery

Browser saves belong to this browser profile and site address. They are not cloud sync or a permanent filesystem backup. Export JSON before changing devices, clearing browser data or uninstalling a browser. The collection supports up to 30 facilities and 4 MB total, with a 2 MB limit per facility; the browser may have a smaller remaining storage quota.

Existing single-facility saves migrate into the collection once. The legacy saved data remains untouched for recovery. Ordinary supported facility v1–v6 JSON files remain importable; collection backups use `intelligent-dvr.facilities.v1`.

Applied changes show **Saving in this browser…** until the shared save lock commits them. If storage is full or unavailable, the UI keeps work in memory and offers **Retry saving**. Export a backup before closing. Browsers without shared save locking keep edits in memory and explain that saving is unavailable.

When another tab changes the collection, **Facilities save conflict** offers downloads of both versions. Save or discard any open preview first, then choose **Keep this tab’s version** or **Use other tab’s version**. The version being replaced is copied into a free browser backup slot before the choice takes effect. Choosing the other version resets the editor selection and Undo history. An unreadable saved collection offers **Download stored data** and an explicit choice to keep your new work; the original bytes are backed up first. Legacy single-facility bytes stay untouched.

There are ten conflict-copy slots; none are replaced automatically. If they fill up, open **Saved conflict copies**, download a copy, verify the file, then explicitly remove its browser copy. A valid facility-copy download imports with the ordinary facility importer and adds separate plans. An unreadable copy remains downloadable for recovery. If a version or preview changes while a choice waits, the choice is refused so you can review it again.

Route/pathway coordinate lists, map extracts and draft outlines must be applied or explicitly discarded before changing tasks, floors, units or facilities. Collapsing their panels retains the drafts. Pasted facility JSON warns before accidental close or navigation, while its own import and explicit discard remain available.

## Verification

Focused tests cover blank initialization, one-time migration, independent mutations, backup round-trips, exact dimensions, collection bounds, corrupt data preservation, quota failures, locked concurrent saves and bounded conflict recovery. Generated browser regressions cover named facilities, additive imports, reload, pending drafts, delayed requests and two-tab recovery. These checks do not establish survey accuracy, live map-provider availability, camera compatibility or physical-site acceptance.

When correcting a saved site, review **Keep buildings at their map positions**
before **Save site**. The checked choice re-centres local coordinates; the unchecked
choice relocates the plan geographically. A rejected correction retains the prior
plan, and a successful change supports Undo. [Site and coordinate details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/saved-facilities.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
