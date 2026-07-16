# FIT fixtures

Real vívoactive 5 spa-session exports (Garmin Connect `*_ACTIVITY.fit`
downloads), used by `src/lib/fit/parse-fit.test.ts`.

- **Device serial scrubbed.** `file_id.serial_number` was binary-patched to a
  fixed fake (`1234567890`) and the file CRC recomputed. Only those bytes differ
  from the original — every other byte, and so every parsing quirk, is preserved.
  Timestamps and HR are real.
- **Two builds represented.** The 8 + 10 July files were recorded by an older
  watch build that never wrote the `developer_data_id` + `activity`
  `field_description`, so their station labels only survive via the raw,
  number-based read (see spec §4.2). The rest carry the full scaffolding. Keeping
  both is deliberate — the old files are the regression test for that path.
