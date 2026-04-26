import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { MODULE_DEFS, getActiveModuleId } from "../../modules";
import { fetchSettings } from "../../api";
import { API_BASE } from "../../utils/imageUrl";
import { isAdmin } from "../../utils/env";
import { usePageActionsList } from "../../contexts/PageActionsContext";

// Phase 7d: guest-mode hamburger menu items. Lazy + env-gated so admin
// builds eliminate the chunk + the sqliteService graph it pulls in.
const GuestMenuItems = import.meta.env.VITE_IS_ADMIN === "true"
  ? null
  : lazy(() => import("../../guest/GuestMenuItems"));

function navClass({ isActive }) {
  return isActive ? "topnav-link active" : "topnav-link";
}

export default function TopNav({ theme, toggleTheme }) {
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [enabledModuleIds, setEnabledModuleIds] = useState([]);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const [filtersAvailable, setFiltersAvailable] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const dropdownRef = useRef(null);
  const menuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const pageActions = usePageActionsList();

  const activeModuleId = getActiveModuleId(location.pathname);
  const activeModule = activeModuleId ? MODULE_DEFS[activeModuleId] : null;

  // Listen for FilterSidebarShell mount/unmount so we know whether to show the
  // filter icon button on mobile.
  useEffect(() => {
    const handler = (e) => setFiltersAvailable(!!e.detail);
    window.addEventListener("collectcore:filters-available", handler);
    return () => window.removeEventListener("collectcore:filters-available", handler);
  }, []);

  // Close nav drawer on route change.
  useEffect(() => { setNavDrawerOpen(false); }, [location.pathname]);

  // ESC closes nav drawer + body scroll lock while it's open.
  useEffect(() => {
    if (!navDrawerOpen) return;
    document.body.classList.add("filter-drawer-open");
    const onKey = (e) => { if (e.key === "Escape") setNavDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("filter-drawer-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [navDrawerOpen]);

  const loadSettingsRef = useRef(() => {});
  useEffect(() => {
    // Guest mode runs in single-module configuration (`VITE_ENABLED_MODULES=
    // photocards`) and has no /admin/settings endpoint to call — skip the
    // fetch entirely so we don't generate a 401/CORS error every page load.
    if (!isAdmin) {
      loadSettingsRef.current = () => {};
      setEnabledModuleIds(["photocards"]);
      return;
    }
    function loadSettings() {
      fetchSettings()
        .then(settings => {
          try {
            setEnabledModuleIds(JSON.parse(settings.modules_enabled || "[]"));
          } catch {
            setEnabledModuleIds([]);
          }
        })
        .catch(() => setEnabledModuleIds(Object.keys(MODULE_DEFS).sort()));
    }
    loadSettingsRef.current = loadSettings;
    loadSettings();
    function handleChange(e) {
      if (Array.isArray(e.detail)) {
        setEnabledModuleIds(e.detail);
      } else {
        loadSettings();
      }
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") loadSettings();
    }
    window.addEventListener("collectcore:modules-changed", handleChange);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("collectcore:modules-changed", handleChange);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Refetch enabled-modules whenever the drawer opens, so the list is fresh
  // even if the user toggled modules in a different browser or before this
  // session loaded the cached bundle.
  useEffect(() => {
    if (navDrawerOpen) loadSettingsRef.current();
  }, [navDrawerOpen]);

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

  // Close any open page-action menu on outside click / route change.
  useEffect(() => { setOpenMenuId(null); }, [location.pathname]);
  useEffect(() => {
    if (!openMenuId) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [openMenuId]);

  async function handleExit() {
    setIsShuttingDown(true);
    try {
      await fetch(`${API_BASE}/shutdown`, { method: "POST", credentials: "include" });
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
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));

  const HamburgerIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );

  const FilterIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );

  const SortIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="13" y2="6" />
      <line x1="3" y1="12" x2="11" y2="12" />
      <line x1="3" y1="18" x2="9" y2="18" />
      <polyline points="17 8 17 18 21 14" />
      <line x1="17" y1="18" x2="17" y2="18" />
    </svg>
  );

  const SelectIcon = ({ active }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      {active && <polyline points="7 12 11 16 17 9" />}
    </svg>
  );

  const UploadIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );

  const ICONS = { sort: SortIcon, select: SelectIcon, upload: UploadIcon };

  function renderPageAction(action) {
    const Icon = ICONS[action.iconName];
    if (!Icon) return null;

    if (action.kind === "menu") {
      const isOpen = openMenuId === action.id;
      return (
        <div
          key={action.id}
          ref={isOpen ? menuRef : undefined}
          style={{ position: "relative" }}
        >
          <button
            type="button"
            className="topnav-icon-btn"
            onClick={() => setOpenMenuId(isOpen ? null : action.id)}
            aria-label={action.label}
            aria-haspopup="menu"
            aria-expanded={isOpen}
          >
            <Icon />
          </button>
          {isOpen && (
            <div className="topnav-action-menu" role="menu">
              {action.options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`topnav-action-menu__item${opt.value === action.value ? " active" : ""}`}
                  onClick={() => {
                    action.onChange(opt.value);
                    setOpenMenuId(null);
                  }}
                  role="menuitem"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    // kind === "toggle" or default
    return (
      <button
        key={action.id}
        type="button"
        className={`topnav-icon-btn${action.active ? " active" : ""}`}
        onClick={action.onClick}
        aria-label={action.label}
        aria-pressed={action.active ? "true" : "false"}
      >
        <Icon active={action.active} />
      </button>
    );
  }

  return (
    <header className="topnav">
      {/* Mobile-only: hamburger on the left edge */}
      <div className="topnav-mobile-controls topnav-mobile-controls--left">
        <button
          type="button"
          className="topnav-icon-btn"
          onClick={() => setNavDrawerOpen(true)}
          aria-label="Open menu"
        >
          <HamburgerIcon />
        </button>
      </div>

      <div className="topnav-left">
        {/* Logo */}
        <NavLink to="/" className="topnav-brand" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="brand-badge">CC</span>
          <span>CollectCore</span>
        </NavLink>

        {/* Module switcher dropdown */}
        {activeModule && (
          <div className="module-switcher topnav-desktop-only" ref={dropdownRef} style={{ position: "relative" }}>
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
          <nav className="topnav-links topnav-desktop-only">
            {activeModule.links.map(link => (
              <NavLink key={link.to} to={link.to} className={navClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>

      <div className="topnav-right topnav-desktop-only">
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

      {/* Mobile-only: page actions + filter on the right edge */}
      <div className="topnav-mobile-controls topnav-mobile-controls--right">
        {pageActions.map(renderPageAction)}
        {filtersAvailable && (
          <button
            type="button"
            className="topnav-icon-btn"
            onClick={() => window.dispatchEvent(new CustomEvent("collectcore:filters-toggle"))}
            aria-label="Open filters"
          >
            <FilterIcon />
          </button>
        )}
      </div>

      {/* Mobile nav drawer — consolidates everything from topnav-right + module switcher */}
      {navDrawerOpen && (
        <div
          className="topnav-nav-backdrop"
          onClick={() => setNavDrawerOpen(false)}
        />
      )}
      <aside
        className={`topnav-nav-drawer${navDrawerOpen ? " open" : ""}`}
        {...(navDrawerOpen ? {} : { inert: "" })}
      >
        <div className="topnav-nav-drawer__header">
          <span style={{ fontWeight: 700, fontSize: 14 }}>Menu</span>
        </div>

        {activeModule && (
          <div className="topnav-nav-drawer__section">
            <div className="topnav-nav-drawer__label">Module</div>
            {enabledModules.map(mod => (
              <button
                key={mod.id}
                type="button"
                className={`topnav-nav-drawer__item${mod.id === activeModuleId ? " active" : ""}`}
                onClick={() => navigate(mod.primaryPath)}
              >
                {mod.label}
              </button>
            ))}
          </div>
        )}

        {activeModule && (
          <div className="topnav-nav-drawer__section">
            <div className="topnav-nav-drawer__label">{activeModule.label}</div>
            {activeModule.links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `topnav-nav-drawer__item${isActive ? " active" : ""}`}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        )}

        <div className="topnav-nav-drawer__section">
          {/* Admin link + Exit (legacy desktop-installer shutdown) are
              admin-only. Guest mode replaces them with Help / Refresh /
              Backup / Restore via GuestMenuItems below. */}
          {isAdmin && (
            <>
              <NavLink
                to="/admin"
                className={({ isActive }) => `topnav-nav-drawer__item${isActive ? " active" : ""}`}
              >
                Admin
              </NavLink>
              <button
                type="button"
                className="topnav-nav-drawer__item"
                onClick={handleExit}
              >
                Exit
              </button>
            </>
          )}
          <button
            type="button"
            className="topnav-nav-drawer__item"
            onClick={toggleTheme}
          >
            {theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}
          </button>
          {GuestMenuItems && (
            <Suspense fallback={null}>
              <GuestMenuItems itemClassName="topnav-nav-drawer__item" />
            </Suspense>
          )}
        </div>
      </aside>
    </header>
  );
}
