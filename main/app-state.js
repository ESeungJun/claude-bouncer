// Main-process state shared by main.js and the files in main/.
//
// Only values that more than one file reads or writes live here; a value used
// by a single file stays a local `let` there. Always read and write through
// this object (`state.overlay`, `state.store.data…`) and never keep a copy in
// a local variable or pass one in: the overlay window is made again after a
// crash and the panel is let go a while after it closes, so a copy goes stale.
module.exports = {
  // JSON stores and the session tracker, set once in app.whenReady
  store: null, // state.json: settings, pet, update bookkeeping
  skinsStore: null, // skins.json: custom looks + the active one
  tracker: null, // lib/sessions SessionTracker

  // windows (null while they don't exist)
  overlay: null,
  panel: null,

  // the summon shortcut registered fine
  hotkeyOk: false,

  // The overlay window covers the whole work area only while it has to
  // (cards, menu, games); otherwise it is a small window that follows the pet.
  workArea: null, // work area of the display the pet is on
  viewEpoch: 0, // bumped whenever main resets the window to the whole work area
  viewSize: null, // { width, height } while the window is small

  // cursor feed: the pet is following the cursor right now / read it at once
  cursorTracking: false,
  pokeCursor: () => {},

  // Higgsfield account credits last seen (null = unknown)
  hfCredits: null,
}
