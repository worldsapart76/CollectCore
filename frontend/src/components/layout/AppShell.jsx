import TopNav from "./TopNav";

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="app-main">{children}</main>
    </div>
  );
}