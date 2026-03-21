import { NavLink } from "react-router-dom";
import { useState } from "react";

function navClass({ isActive }) {
  return isActive ? "topnav-link active" : "topnav-link";
}

export default function TopNav() {
  const [isShuttingDown, setIsShuttingDown] = useState(false);

  async function handleExit() {
    setIsShuttingDown(true);

    try {
      await fetch("http://127.0.0.1:8000/shutdown", {
        method: "POST",
      });
    } catch (error) {
      console.error("Shutdown request failed:", error);
    }
  }

  if (isShuttingDown) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111",
          color: "#fff",
          fontSize: "18px",
          textAlign: "center",
          padding: "20px",
        }}
      >
        <div>
          App shutdown complete.
          <br />
          You can now close this window.
        </div>
      </div>
    );
  }

  return (
    <header className="topnav">
      <div className="topnav-left">
        <NavLink to="/" className="topnav-brand">
          Photocard Tracker
        </NavLink>

        <nav className="topnav-links">
          <NavLink to="/" className={navClass} end>
            Home
          </NavLink>
          <NavLink to="/inbox" className={navClass}>
            Inbox
          </NavLink>
          <NavLink to="/library" className={navClass}>
            Library
          </NavLink>
          <NavLink to="/export" className={navClass}>
            Export
          </NavLink>
        </nav>
      </div>

      <div
        className="topnav-right"
        style={{ display: "flex", gap: "8px", alignItems: "center" }}
      >
        <NavLink to="/admin" className={navClass}>
          Admin
        </NavLink>

        <button
          type="button"
          className="topnav-link"
          onClick={handleExit}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Exit
        </button>
      </div>
    </header>
  );
}