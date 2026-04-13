import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import HomePage from "./pages/HomePage";
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

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/library" element={<PhotocardLibraryPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/admin" element={<AdminPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}