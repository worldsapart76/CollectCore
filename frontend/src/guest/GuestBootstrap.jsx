// Phase 7a: guest webview boot sequence.
//
// Wraps the entire app for !isAdmin builds. Two distinct first-launch
// paths depending on whether OPFS already has a catalog:
//
// First visit ever (no OPFS catalog):
//   1. Init the SQLite worker (SAHPool VFS or memory fallback).
//   2. Show the Welcome modal IMMEDIATELY in mandatory mode (no X / ESC /
//      backdrop dismiss — only the explicit CTA closes it). The seed is
//      NOT downloaded yet — the user reads what they're about to get into
//      and consents by clicking "Get started."
//   3. On CTA click: download the seed, import to OPFS, mark welcome
//      dismissed, run a background syncCatalog, render children.
//
// Subsequent visits (OPFS catalog present):
//   1. Init worker.
//   2. Skip welcome (already dismissed). Run silent background syncCatalog
//      to pull lookup/item updates.
//   3. Render children.
//
// Help link in the hamburger menu re-shows the welcome modal in
// dismissable mode (X/ESC/backdrop work; CTA labelled "Got it" rather
// than "Get started"). Doesn't trigger a download.
//
// Tree-shaking: this whole module + sqliteService + the worker are imported
// behind `!isAdmin ? lazy(() => import(...)) : null` in App.jsx. Rollup
// constant-folds isAdmin from .env.guest, so admin builds eliminate the
// dynamic import entirely (no sqlite-wasm chunk in the admin bundle).

import { useEffect, useRef, useState } from "react";
import {
  initSqlite,
  loadSeedFromUrl,
  hasPersistedCatalog,
  syncCatalog,
  getGuestMeta,
  setGuestMeta,
} from "./sqliteService";
import WelcomeModal from "./WelcomeModal";

const WELCOME_KEY = "welcome_dismissed";
// Seed URL is owned by sqliteService — it knows to route through the
// API host (api.collectcoreapp.com) where the CF Access bypass lives.
// Don't pass an override here; the bootstrap should not second-guess it.

// Boot phases — drive both the splash UI and the gating of children.
const PHASE_INITIALIZING = "initializing";        // worker spinning up
const PHASE_AWAITING_CONSENT = "awaiting-consent"; // first visit, welcome shown, no seed yet
const PHASE_LOADING_SEED = "loading-seed";        // user clicked CTA, fetching seed
const PHASE_READY = "ready";
const PHASE_ERROR = "error";

export default function GuestBootstrap({ children }) {
  const [phase, setPhase] = useState(PHASE_INITIALIZING);
  const [error, setError] = useState("");
  const [storageMode, setStorageMode] = useState(null);
  // Dev guard: React StrictMode mounts effects twice in development. The
  // worker's SAHPool install is single-tenant and gets unhappy with
  // concurrent attempts; rely on the service's internal `_initPromise`
  // cache for idempotency, but also make this effect itself idempotent.
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const initRes = await initSqlite();
        if (cancelled) return;
        setStorageMode(initRes.storageMode || null);

        if (hasPersistedCatalog()) {
          // Returning visitor — catalog already in OPFS. Skip welcome,
          // run silent sync to pick up lookup/item updates.
          syncCatalog().catch((err) => {
            console.warn("[guest] background syncCatalog failed", err);
          });
          setPhase(PHASE_READY);
          return;
        }

        // First visit. Per user preference: do NOT auto-fetch the seed.
        // Show the welcome modal first; download triggers from the CTA.
        // Edge case: if welcome was already dismissed (e.g. user cleared
        // OPFS but the flag somehow persisted — shouldn't happen since
        // both live in OPFS, but be defensive), skip straight to download.
        const dismissed = await getGuestMeta(WELCOME_KEY);
        if (cancelled) return;
        if (dismissed) {
          await runSeedDownload(cancelled);
          return;
        }
        setPhase(PHASE_AWAITING_CONSENT);
      } catch (err) {
        if (cancelled) return;
        console.error("[guest] bootstrap failed", err);
        setError(err?.message || String(err));
        setPhase(PHASE_ERROR);
      }
    })();

    async function runSeedDownload(isCancelled) {
      setPhase(PHASE_LOADING_SEED);
      await loadSeedFromUrl();
      if (isCancelled) return;
      // Background delta sync — bring lookup state current. Failures
      // are non-fatal; user can refresh manually from the menu.
      syncCatalog().catch((err) => {
        console.warn("[guest] background syncCatalog failed", err);
      });
      setPhase(PHASE_READY);
    }

    return () => { cancelled = true; };
  }, []);

  // Called from the welcome modal CTA in PHASE_AWAITING_CONSENT.
  // Persists the welcome-dismissed flag, then triggers the seed download.
  async function handleConsent() {
    try {
      // Set the dismissed flag BEFORE starting the download — if the
      // download fails we still don't want to nag with the welcome
      // again (the BootError UI is the right place to recover).
      await setGuestMeta(WELCOME_KEY, new Date().toISOString());
    } catch (err) {
      console.warn("[guest] failed to persist welcome dismissal", err);
    }
    setPhase(PHASE_LOADING_SEED);
    try {
      await loadSeedFromUrl();
      syncCatalog().catch((err) => {
        console.warn("[guest] background syncCatalog failed", err);
      });
      setPhase(PHASE_READY);
    } catch (err) {
      console.error("[guest] seed download failed", err);
      setError(err?.message || String(err));
      setPhase(PHASE_ERROR);
    }
  }

  if (phase === PHASE_INITIALIZING || phase === PHASE_LOADING_SEED) {
    return (
      <BootSplash
        message={
          phase === PHASE_LOADING_SEED
            ? "Downloading catalog…"
            : "Starting up…"
        }
      />
    );
  }

  if (phase === PHASE_AWAITING_CONSENT) {
    // Mandatory welcome: render OVER an empty backdrop (no children yet —
    // there's no catalog to query). dismissable=false forces the explicit
    // CTA click; ctaLabel "Get started" sets the right expectation.
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg, #fff)" }}>
        <WelcomeModal
          isOpen={true}
          dismissable={false}
          ctaLabel="Get started"
          onClose={handleConsent}
        />
      </div>
    );
  }

  if (phase === PHASE_ERROR) {
    return <BootError message={error} />;
  }

  return (
    <>
      {storageMode === "memory" && <MemoryModeBanner />}
      {children}
    </>
  );
}

function BootSplash({ message }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "var(--bg, #fff)",
        color: "var(--text, #111)",
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 16 }}>CollectCore</div>
      <div style={{ color: "var(--text-muted)" }}>{message}</div>
      {/* Inline keyframes — no global CSS edit needed for one spinner. */}
      <div
        aria-hidden
        style={{
          width: 24,
          height: 24,
          border: "2px solid var(--border, #ddd)",
          borderTopColor: "var(--accent, #2a9d8f)",
          borderRadius: "50%",
          animation: "guest-boot-spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes guest-boot-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function BootError({ message }) {
  // "Failed to fetch" is a network/CORS error, not a storage problem.
  // Misleading users toward the storage/incognito hint here is what
  // generated repeated false-trail debugging in early testing — instead
  // diagnose by category so the suggested fix actually applies.
  const isNetwork = /failed to fetch|networkerror|load failed/i.test(message || "");
  const isStorage = /opfs|sahpool|access handle|persist|quota/i.test(message || "");

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 520,
        margin: "10vh auto",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Couldn't start CollectCore</h2>
      {isNetwork ? (
        <p style={{ color: "var(--text-muted)" }}>
          Couldn't reach the catalog server. Most often this clears up on
          a reload. If it persists, the catalog API may be temporarily
          down — check that <code>api.collectcoreapp.com</code> is
          reachable, then try again.
        </p>
      ) : isStorage ? (
        <p style={{ color: "var(--text-muted)" }}>
          Your browser is blocking the local storage CollectCore needs.
          Try closing other CollectCore tabs and reloading. If the
          problem persists, restart the browser to release any stuck
          storage handles.
        </p>
      ) : (
        <p style={{ color: "var(--text-muted)" }}>
          Something went wrong while preparing your local catalog.
          Reloading the page usually fixes it.
        </p>
      )}
      <pre
        style={{
          background: "var(--code-bg, #f5f5f5)",
          padding: 12,
          fontSize: 12,
          overflowX: "auto",
        }}
      >
        {message}
      </pre>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ marginTop: 12, padding: "8px 16px", cursor: "pointer" }}
      >
        Reload
      </button>
    </div>
  );
}

function MemoryModeBanner() {
  return (
    <div
      role="status"
      style={{
        padding: "8px 12px",
        background: "var(--warning-bg, #fff3cd)",
        color: "var(--warning-text, #856404)",
        borderBottom: "1px solid var(--warning-text, #856404)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      Storage mode: in-memory. Your changes won't survive a reload — close
      other CollectCore tabs and reload to enable persistent storage.
    </div>
  );
}
