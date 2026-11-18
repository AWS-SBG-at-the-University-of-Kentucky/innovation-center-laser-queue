import { NavLink } from "react-router-dom";

const PAGES = [
  { to: "/submit", label: "Submit" },
  { to: "/queue", label: "Queue" },
  { to: "/analytics", label: "Analytics" },
];

/** Page links in the top bar. Only rendered for staff (see AuthGate). */
export function StaffNav() {
  return (
    <nav className="app-nav" aria-label="Pages">
      {PAGES.map(({ to, label }) => (
        // NavLink adds the "active" class and aria-current="page".
        <NavLink key={to} to={to}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
