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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}