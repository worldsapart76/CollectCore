// Authenticated /pcs/ hamburger-menu items. Server-backed counterpart to the
// WASM tier's GuestMenuItems — but the /pcs tier has no local backup/restore
// or catalog refresh (data lives on the server), so this is just an account
// affordance: who you're signed in as, plus sign out via Cloudflare Access.

import { useEffect, useState } from "react";
import { getMe } from "./pcsData";

export default function PcsMenuItems({ itemClassName }) {
  const [me, setMe] = useState(null);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { /* unauthenticated / offline — leave generic label */ });
    return () => { alive = false; };
  }, []);

  return (
    <>
      <div
        className={itemClassName}
        style={{ cursor: "default", opacity: 0.75, fontSize: 12, lineHeight: 1.4 }}
      >
        {me?.email ? `Signed in as ${me.email}` : "Signed in"}
      </div>
      {/* Cloudflare Access logout endpoint — clears the edge session. */}
      <a
        className={itemClassName}
        href="/cdn-cgi/access/logout"
        style={{ textDecoration: "none" }}
      >
        Sign out
      </a>
    </>
  );
}
