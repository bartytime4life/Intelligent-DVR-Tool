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

If storage is full, unavailable, corrupted or changed in another tab, the UI reports it and keeps new work in memory. Export a backup before closing. Quota failures offer **Retry saving**. Corrupt stored JSON can be downloaded with **Download stored data** and is not silently overwritten. Concurrent editing is not transactional: use one editing tab per browser collection; detected external changes pause saving.

## Verification

Focused tests cover blank initialization, one-time migration, independent mutations, backup round-trips, exact dimensions, collection bounds, corrupt data preservation, quota failures and conflicting saves. Browser regressions cover named facilities, additive imports, reload, pending drafts and delayed-file-read guards. The current local environment blocks preview listeners; browser screenshots and regression results are produced by the repository's CI workflow rather than claimed as locally observed.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/saved-facilities.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
