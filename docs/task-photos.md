# Task Photo Archive

Each task can link up to six photos. Camera capture requests the rear camera
on supporting phones; desktop browsers may show a file chooser instead.
Original files up to 20 MiB are converted to JPEG, max edge 1600 pixels,
with a maximum encoded length of 850000 characters. This is a compressed
visual archive, not original-file preservation or OCR.

New photos stay in the form until Save. Uploaded images are deduplicated by
owner and hash in `task_photos`; the task payload contains only identifiers.
Reading or attaching another user's photo is rejected. Photos do not enter
the model context or record snapshots as base64 data. A failed record save
can leave an owner-private upload, and retries reuse it. The per-account
archive limit is 100 MiB. Removing an attachment unlinks it on Save; stored
images are retained until account deletion, which cascades to the archive.

Browser tests cover multiple selection, viewing, Escape isolation, save,
reopen, removal, and 320/390 pixel layout. Physical camera capture needs
verification on the target phone.
