# Avatar background images

Drop avatar background photos in this folder. They are bundled into the
deployment via `scripts/copy-static.cjs` and served from
`/voice/assets/<filename>` by `src/index.ts`.

The avatar UI in `src/voice/voice.html` keeps the default experience on the
white solid-color background so the browser can render the raw HD avatar video
without extra per-frame compositing. `visitor-center.jpg` remains available as
an optional backdrop from the Avatar and Camera settings.

When the white-bg keying compositor is active the avatar video is matted
onto the photo at runtime, so use a high-resolution landscape photo
(roughly 1920x1080 or larger) and keep the file under ~2 MB to keep the
page snappy.
