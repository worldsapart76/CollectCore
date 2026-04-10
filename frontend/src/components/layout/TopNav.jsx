import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { MODULE_DEFS, getActiveModuleId } from "../../modules";
import { fetchSettings } from "../../api";

function navClass({ isActive }) {
  return isActive ? "topnav-link active" : "topnav-link";
}

export default function TopNav({ theme, toggleTheme }) {
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [enabledModuleIds, setEnabledModuleIds] = useState([]);
  const dropdownRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const activeModuleId = getActiveModuleId(location.pathname);
  const activeModule = activeModuleId ? MODULE_DEFS[activeModuleId] : null;

  useEffect(() => {
    fetchSettings()
      .then(settings => {
        try {
          setEnabledModuleIds(JSON.parse(settings.modules_enabled || "[]"));
        } catch {
          setEnabledModuleIds([]);
        }
      })
      .catch(() => setEnabledModuleIds(Object.keys(MODULE_DEFS)));
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleOutsideClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [dropdownOpen]);

  async function handleExit() {
    setIsShuttingDown(true);
    try {
      await fetch("http://127.0.0.1:8000/shutdown", { method: "POST" });
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

  const enabledModules = enabledModuleIds
    .map(id => MODULE_DEFS[id])
    .filter(Boolean);

  return (
    <header className="topnav">
      <div className="topnav-left">
        {/* Logo */}
        <NavLink to="/" className="topnav-brand" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="brand-badge">CC</span>
          <span>CollectCore</span>
        </NavLink>

        {/* Module switcher dropdown */}
        {activeModule && (
          <div className="module-switcher" ref={dropdownRef} style={{ position: "relative" }}>
            <button
              className="module-switcher-btn"
              onClick={() => setDropdownOpen(o => !o)}
            >
              {activeModule.label} ▾
            </button>
            {dropdownOpen && (
              <div className="module-dropdown">
                {enabledModules.map(mod => (
                  <button
                    key={mod.id}
                    className={`module-dropdown-item${mod.id === activeModuleId ? " active" : ""}`}
                    onClick={() => {
                      setDropdownOpen(false);
                      navigate(mod.primaryPath);
                    }}
                  >
                    {mod.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Module-specific nav links */}
        {activeModule && (
          <nav className="topnav-links">
            {activeModule.links.map(link => (
              <NavLink key={link.to} to={link.to} className={navClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>

      <div className="topnav-right">
        <NavLink to="/admin" className={navClass}>
          Admin
        </NavLink>
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title="Toggle dark mode"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button
          type="button"
          className="topnav-link"
          onClick={handleExit}
          style={{ background: "none", border: "none", cursor: "pointer", font: "inherit" }}
        >
          Exit
        </button>
      </div>
    </header>
  );
}
