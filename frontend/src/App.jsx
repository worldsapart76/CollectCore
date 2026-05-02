import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./pages/HomePage";
import { activeModules } from "./modules";
import InboxPage from "./pages/InboxPage";
import PhotocardLibraryPage from "./pages/PhotocardLibraryPage";
import AdminPage from "./pages/AdminPage";
import ExportPage from "./pages/ExportPage";
import BooksIngestPage from "./pages/BooksIngestPage";
import BooksLibraryPage from "./pages/BooksLibraryPage";
import GraphicNovelsIngestPage from "./pages/GraphicNovelsIngestPage";
import GraphicNovelsLibraryPage from "./pages/GraphicNovelsLibraryPage";
import VideoGamesIngestPage from "./pages/VideoGamesIngestPage";
import VideoGamesLibraryPage from "./pages/VideoGamesLibraryPage";
import MusicIngestPage from "./pages/MusicIngestPage";
import MusicLibraryPage from "./pages/MusicLibraryPage";
import VideoIngestPage from "./pages/VideoIngestPage";
import VideoLibraryPage from "./pages/VideoLibraryPage";
import BoardgamesIngestPage from "./pages/BoardgamesIngestPage";
import BoardgamesLibraryPage from "./pages/BoardgamesLibraryPage";
import TTRPGIngestPage from "./pages/TTRPGIngestPage";
import TTRPGLibraryPage from "./pages/TTRPGLibraryPage";
// One-time CSV importer (DELETABLE) — see backend/routers/csv_import.py
import CsvImportPage from "./csvImport/CsvImportPage";

// Guest debug page is dev-only. The `import.meta.env.DEV ? ... : null`
// constant-folds at build time, so in a production bundle Rollup eliminates
// both the lazy() call and the dynamic import — meaning the sqlite-wasm
// chunk never gets emitted into the admin dist.
const GuestDebugPage = import.meta.env.DEV
  ? lazy(() => import("./guest/GuestDebugPage"))
  : null;

// Guest bootstrap (Phase 7a) wraps the app for !isAdmin builds. Owns first-
// launch flow: catalog seed download, background delta sync, welcome modal.
// Use `import.meta.env.VITE_IS_ADMIN` directly (NOT the imported `isAdmin`
// constant) so Vite inline-replaces the literal before Rollup's chunk-graph
// pass — guarantees the lazy import + sqlite-wasm chunk are eliminated from
// admin bundles. Verified with `import.meta.env.DEV` in the GuestDebugPage
// line above, same mechanism.
const GuestBootstrap = import.meta.env.VITE_IS_ADMIN === "true"
  ? null
  : lazy(() => import("./guest/GuestBootstrap"));

// When only one module is configured (e.g. mobile build), skip the home page
// and land directly on that module's primary path.
const singleModulePath = activeModules.length === 1 ? activeModules[0].primaryPath : null;

export default function App() {
  const inner = (
    <AppShell>
      <Routes>
        <Route
          path="/"
          element={singleModulePath ? <Navigate to={singleModulePath} replace /> : <HomePage />}
        />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/library" element={<PhotocardLibraryPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/csv-import" element={<CsvImportPage />} />
        <Route path="/books/add" element={<BooksIngestPage />} />
        <Route path="/books/library" element={<BooksLibraryPage />} />
        <Route path="/graphicnovels/add" element={<GraphicNovelsIngestPage />} />
        <Route path="/graphicnovels/library" element={<GraphicNovelsLibraryPage />} />
        <Route path="/videogames/add" element={<VideoGamesIngestPage />} />
        <Route path="/videogames/library" element={<VideoGamesLibraryPage />} />
        <Route path="/music/add" element={<MusicIngestPage />} />
        <Route path="/music/library" element={<MusicLibraryPage />} />
        <Route path="/video/add" element={<VideoIngestPage />} />
        <Route path="/video/library" element={<VideoLibraryPage />} />
        <Route path="/boardgames/add" element={<BoardgamesIngestPage />} />
        <Route path="/boardgames/library" element={<BoardgamesLibraryPage />} />
        <Route path="/ttrpg/add" element={<TTRPGIngestPage />} />
        <Route path="/ttrpg/library" element={<TTRPGLibraryPage />} />
        {/* Guest webview debug — dev-only. Promoted/replaced when guest UI lands. */}
        {import.meta.env.DEV && (
          <Route
            path="/_guest_debug"
            element={
              <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
                <GuestDebugPage />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );

  if (GuestBootstrap) {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
        <GuestBootstrap>{inner}</GuestBootstrap>
      </Suspense>
    );
  }
  return inner;
}