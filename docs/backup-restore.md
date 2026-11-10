# Full offline backup and restore (#128)

Back up data saves **one file** with everything Body Anvil keeps on the phone. Restore data puts it back after a reinstall or on a new phone. There's no account, server, cloud or API key: the file goes wherever you choose through the system share/save sheet (Files, Drive, email, nearby share…).

This is different from **Export all data** (#5, contract 06). That is a readable JSON history for other tools. It has no photos and no restore button.

## What's in a backup

| Included | Where it lives on the phone |
|---|---|
| Plan, every earlier plan version (configuration history with the exact previous plan), profile, goals, schedule, custom exercises, Muscle Growth set-up | SQLite `plan`, `config_change` |
| Completions and skips, exercise ticks, completion history, day snapshots, day-type overrides, quick logs | `activity_log`, `completion_event`, `day_snapshot`, `day_override`, `quick_log` |
| Exercise logs (sets, reps, load, RIR, Muscle Growth done/skipped), sore/injured reports | `exercise_log`, `muscle_report` |
| Measurements (weight, waist, …), manual and imported values with provenance, screenshot import sessions | `observation`, `import_session` |
| Meals actually eaten and their **original photo files** | `meal_log`, `meal-photos/` |
| Retained import screenshots | `imports/` |
| Gamification (on/off, celebrated achievements), theme, energy display, Progress chart layout, trend alerts, reminders on/off, chosen Health Connect types | keystore (`BACKUP_PREFERENCE_KEYS.included`) |

**Not included** (set up again after restoring):
- API keys;
- Health Connect permissions and sync state;
- notification permission;
- an unfinished setup;
- device identifiers.

XP, levels, quests and achievements are recalculated from the restored records, so they come back exactly as they were.

**Coverage guards:** tests fail if a new SQLite table isn't covered by the restore (`STORE_TABLES`), or if a new `pft.*` device-storage key isn't classified as included or excluded (`BACKUP_PREFERENCE_KEYS`). New storage can't silently go missing from backups.

## File format (backupVersion 1)

A ZIP file named `body-anvil-backup-YYYY-MM-DD.zip`:

```
manifest.json            format "body-anvil-backup", backupVersion, createdAt, app version, date range,
                         counts, and every file with its size and SHA-256
data/store.json          the whole store, in the full-history export format (contract 06, exportVersion 1)
data/preferences.json    included device preferences
attachments/meal-photos/<photoId>.<ext>              original bytes, stored uncompressed
attachments/imports/<importId>/<assetId>.<ext>
```

- Photo and screenshot references in `store.json` are written as `attachment:<path>`. On restore they're mapped to new files on the phone.
- An attachment that was already missing when the backup was made is listed in `missingAttachments`, and the preview says so.
- The file is **not encrypted**. It holds health data and photos, so keep it somewhere private. Encryption would be a separate decision.

## Restore: what is checked, and what happens

Nothing is changed until everything below passes and you tap **Replace my data**.

1. **Is it a backup?** It must be a ZIP with a Body Anvil manifest.
2. **Is it safe?** Only known, plain paths are accepted: no `..`, no absolute paths, no hidden or unexpected files, no duplicate names. Size and file-count limits block "zip bombs". Sizes are checked before anything is unpacked.
3. **Is it intact?** Every file in the manifest must be present with the right size and SHA-256, and there must be no unlisted files. The store must pass the export schema, and every photo a record points to must be in the archive.
4. **Can this app version read it?** A newer `backupVersion` is refused with "Update the app".
5. **Is there space?** There must be enough free storage, with headroom. If not, the restore is refused and nothing changes.

The preview shows the backup's date, app version, date range, record counts, meals and photos, and size. It says that **all data on this phone will be replaced**: nothing is merged, so there are no duplicates. **Back up this phone first** is offered on the same screen.

The restore itself is atomic:
1. the current data and preferences are kept in memory;
2. the photos are written to **new** folders (`meal-photos/restore-<id>/`, `imports/restore-<id>/`), so nothing existing is overwritten;
3. the store is replaced in **one transaction** (SQLite) or one document write (web);
4. the preferences are replaced;
5. only then are the old photo files deleted.

Any failure in steps 2–4 (for example a full disk, or a crash part-way) puts the previous data and preferences back and removes the new files. The app then says the previous data was kept unchanged.

Afterwards the whole app restarts on the restored data: screens, theme, gamification and reminders. A notice says which backup was restored.

**After restoring:** a Health Connect sync replaces each day's integration values instead of adding to them, so restored history is never duplicated. On a new phone, connect Health Connect again; the first sync re-reads recent days.

## Compatibility policy

- A backup made by any app version is readable by any later version: `backupVersion` ≤ the app's. Older formats are upgraded in `migrateManifest`.
- The store inside follows the export format's rule: new fields are optional when reading, so older exports still load.
- A breaking change bumps `backupVersion` and adds a migration step. A backup from a newer app is refused, never half-read.

## Limitations

- The whole backup is held in memory while it is made and restored. That is fine for years of records and hundreds of photos. A library of thousands of large photos could reach a phone's memory limit, in which case the backup fails safely and nothing is lost.
- On iOS the picker and share sheet are the system ones. The flow is shared with Android, but it has only been tested on Android and the web.
- Restoring on web (the dev and test surface) is limited by the browser's localStorage size. A full storage fails the restore and rolls it back.

## Manual check after deploying to Google Play internal testing

1. On a phone with real-looking test data (several days, a custom exercise, Muscle Growth done and skipped, a weight, two meals with photos, gamification on): menu → **Back up data** → **Create backup** → save to Files or Drive. Check the counts on "Backup ready".
2. Uninstall Body Anvil and install it again from internal testing.
3. On first-run setup tap **Used Body Anvil before? Restore from a backup** and choose the file. Check that the preview's counts match step 1, then tap **Replace my data**.
4. Check:
   - Today and earlier days show the same ticks and skips;
   - Muscle Growth history is the same;
   - the meals show their photos;
   - Progress charts match;
   - the achievements gallery is unchanged;
   - the theme and energy display are as before.
5. Re-enter the API key if used, and connect Health Connect again. After a sync, weight and steps aren't duplicated.
6. Restore over existing data: add a weight, then menu → **Restore data** → the same file → **Cancel**. The weight is still there. Repeat and confirm: the extra weight is gone.
7. Choose a non-backup file (any photo or PDF). You get a clear error and nothing changes.
