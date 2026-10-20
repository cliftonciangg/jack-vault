/**
 * Full screen on tap. Browsers only grant the Fullscreen API inside a user
 * gesture, so every tap or click asks again while the page isn't full screen:
 * the first tap enters it, and a tap after the player leaves (Esc, back
 * gesture, browser UI) enters it again.
 *
 * iPhone Safari has no element fullscreen (only iPad does), so there the page
 * relies on the web manifest and apple-mobile-web-app-capable: added to the
 * home screen, it opens standalone with no browser bars.
 */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as FsDoc;

function isFullscreen() {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Home-screen launch (iOS or an installed app): already full screen. */
function isStandalone() {
  return matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function request() {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* refused (iframe without allowfullscreen, policy): keep playing windowed */
  }
}

export function fullscreenOnTap() {
  if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled) || isStandalone()) return;
  const onTap = (e: Event) => {
    if (isFullscreen()) return;
    // A tap into a text field opens the keyboard; going full screen at the same
    // moment can resize the page under it. The next tap (LOG IN) does it instead.
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    request();
  };
  // Capture phase, so it runs even when a handler stops the event.
  document.addEventListener("pointerup", onTap, true);
  document.addEventListener("keydown", (e) => e.key === "Enter" && onTap(e), true);
}
