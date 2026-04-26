// Phase 7a: first-launch welcome modal for the guest webview.
//
// Approved copy (2026-04-24, Q13 in fancy-stirring-hollerith.md), trimmed for
// the web pivot:
//   - Inbox section dropped (Phase 4b — guest-added cards — deferred).
//   - Sharing section dropped (PD2 — Trading — deferred).
// Retain everything else verbatim. Re-accessible from the hamburger menu's
// Help link (Phase 7d).
//
// Also serves as the Help dialog when invoked from the menu — same content,
// same component. The "first launch" gating happens in GuestBootstrap via
// the `welcome_dismissed` guest_meta flag.

import Modal from "../components/primitives/Modal";

export default function WelcomeModal({ isOpen, onClose, ctaLabel = "Get started" }) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Welcome to CollectCore"
      size="md"
      footer={
        <button
          type="button"
          onClick={onClose}
          style={{ padding: "8px 16px", fontSize: 14, cursor: "pointer" }}
        >
          {ctaLabel} →
        </button>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.55 }}>
        <p style={{ marginTop: 0 }}>
          Your library comes pre-loaded with a starter catalog of photocards.
          Here's how it works:
        </p>

        <p>
          <strong>Library</strong> — On first run, you will see the entire
          catalog. Tap any card to see details and add to your list (Wanted,
          Owned, etc.). The next time you load the app, you will only see
          those tracked cards. If you want to see the Catalog again, add it
          in your filters. (It is filtered off by default.)
        </p>

        <p>
          <strong>Ownership statuses</strong> — Each card can be marked Wanted,
          Owned, For Trade, or other states. Open a card and pick a status to
          add it to your collection.
        </p>

        <p>
          <strong>Copies</strong> — You can own more than one of the same card.
          Each copy tracks its own status, so you can mark one as Owned and
          another as For Trade.
        </p>

        <p>
          <strong>Filtering</strong> — Tap the filter icon to narrow your
          library by group, member, ownership status, and more.
        </p>

        <p>
          <strong>Your data stays on your device.</strong> Any changes you
          make — ownership, copies, notes — are stored locally and never
          uploaded. Updates to the shared catalog (new cards, new images) will
          appear automatically when you launch the app.
        </p>

        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 0 }}>
          You can revisit this guide any time from the <strong>Help</strong>{" "}
          link in the menu.
        </p>
      </div>
    </Modal>
  );
}
