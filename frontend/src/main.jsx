import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/app.css";
import "./styles/primitives.css";

// Vite sets `import.meta.env.BASE_URL` from the `base` config in
// vite.config.js — '/' for admin, '/guest/' for guest. BrowserRouter
// needs the trailing slash stripped (e.g. '/guest' not '/guest/'), and
// '/' should pass as undefined so admin behaves exactly as before.
const _base = import.meta.env.BASE_URL.replace(/\/$/, "");
const ROUTER_BASENAME = _base === "" ? undefined : _base;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);