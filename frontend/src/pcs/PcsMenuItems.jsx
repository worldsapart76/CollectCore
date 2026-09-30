// Authenticated /pcs/ hamburger-menu items. Server-backed counterpart to the
// WASM tier's GuestMenuItems — the /pcs tier has no local backup/restore or
// catalog refresh (data lives on the server), so this is an account affordance
// (who you're signed in as + sign out) plus a one-time migration action:
// import a friend's old /guest/ "Download Backup" file into their /pcs account.

import { useEffect, useRef, useState } from "react";
import { exportPcsCardBook, getMe, importGuestBackup } from "./pcsData";

export default function PcsMenuItems({ itemClassName }) {
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { /* unauthenticated / offline — leave generic label */ });
    return () => { alive = false; };
  }, []);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    // Clear the input so re-selecting the same file fires onChange again.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    let snapshot;
    try {
      snapshot = JSON.parse(await file.text());
    } catch {
      window.alert("That file isn't a valid backup (couldn't read it as JSON).");
      return;
    }
    const count = snapshot?.tables?.guest_card_copies?.length ?? 0;
    if (!count) {
      window.alert("This backup has no saved cards to import.");
      return;
    }
    const ok = window.confirm(
      `Import ${count} card${count === 1 ? "" : "s"} from your guest backup?\n\n` +
      "This REPLACES everything currently in your account with the backup's " +
      "contents. You can re-import the same file safely.",
    );
    if (!ok) return;

    setBusy(true);
    try {
      const r = await importGuestBackup(snapshot);
      let msg = `Imported ${r.imported} card${r.imported === 1 ? "" : "s"}.`;
      if (r.skipped_unknown_card) msg += `\nSkipped ${r.skipped_unknown_card} not in the catalog.`;
      if (r.skipped_bad_status) msg += `\nSkipped ${r.skipped_bad_status} with an unrecognized status.`;
      window.alert(msg);
      window.location.reload(); // re-fetch the library with the imported copies
    } catch (err) {
      window.alert(`Import failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  // The card book is a PDF to save to a phone and use with no connection.
  // `mine` covers the cards you've marked; `all` is the whole catalog, which
  // is a ~90MB download and only worth it as a shopping reference.
  async function handleCardBook(cardFilter) {
    if (bookBusy) return;
    if (cardFilter === "all" && !window.confirm(
      "The full catalog is a large download (roughly 90 MB) and is best done " +
      "on wifi. Carry on?",
    )) return;

    setBookBusy(true);
    try {
      const info = await exportPcsCardBook({ cardFilter });
      const size = `${(info.bytes / 1e6).toFixed(1)} MB`;
      // The counts come from response headers, which are only readable when
      // the API exposes them cross-origin — fall back to the size alone
      // rather than claiming "0 cards".
      const counts = Number.isFinite(info.cards) && info.cards > 0
        ? `${info.cards} cards over ${info.pages} pages (${size})`
        : size;
      window.alert(
        `Saved your card book: ${counts}.\n\n` +
        "Keep it in your phone's Files app and it works with no signal.",
      );
    } catch (err) {
      window.alert(`Card book failed: ${err?.message || err}`);
    } finally {
      setBookBusy(false);
    }
  }

  return (
    <>
      <div
        className={itemClassName}
        style={{ cursor: "default", opacity: 0.75, fontSize: 12, lineHeight: 1.4 }}
      >
        {me?.email ? `Signed in as ${me.email}` : "Signed in"}
      </div>

      {/* Offline card book. Two scopes: your own cards (small), or the whole
          catalog as a shopping reference (large — best on wifi). */}
      <div
        className={itemClassName}
        role="button"
        tabIndex={0}
        onClick={() => handleCardBook("mine")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCardBook("mine"); }}
        style={{ cursor: bookBusy ? "default" : "pointer" }}
      >
        {bookBusy ? "Building card book…" : "Download my card book (PDF)"}
      </div>
      <div
        className={itemClassName}
        role="button"
        tabIndex={0}
        onClick={() => handleCardBook("all")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleCardBook("all"); }}
        style={{ cursor: bookBusy ? "default" : "pointer" }}
      >
        Download full catalog book (PDF)
      </div>

      {/* One-time migration off the old browser-local /guest/ tier. */}
      <div
        className={itemClassName}
        role="button"
        tabIndex={0}
        onClick={() => { if (!busy) fileRef.current?.click(); }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) fileRef.current?.click();
        }}
        style={{ cursor: busy ? "default" : "pointer" }}
      >
        {busy ? "Importing…" : "Import guest backup…"}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        style={{ display: "none" }}
      />

      {/* Cloudflare Access logout endpoint — clears the edge session. */}
      <a
        className={itemClassName}
        href="/cdn-cgi/access/logout"
        style={{ textDecoration: "none" }}
      >
        Sign out
      </a>
    </>
  );
}
