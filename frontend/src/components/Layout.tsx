import { useEffect } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, FileSpreadsheet, Home, Info, ScanSearch } from "lucide-react";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/" className={`logo ${dark ? "logo-dark" : ""}`} aria-label="FraudLens home">
      <span className="logo-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </span>
      <span className="logo-text">FraudLens</span>
    </Link>
  );
}

const NAV = [
  { to: "/dashboard", label: "Overview", icon: BarChart3 },
  { to: "/check", label: "Check a transaction", icon: ScanSearch },
  { to: "/batch", label: "Batch CSV", icon: FileSpreadsheet },
  { to: "/model", label: "Model & data", icon: Info },
  { to: "/", label: "Home", icon: Home },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <p>
        <strong>FraudLens</strong> · Credit card fraud detection with explainable AI · Built by Haniya Imran
      </p>
      <p className="muted">
        Trained on the public{" "}
        <a href="https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud" target="_blank" rel="noreferrer">
          Credit Card Fraud Detection
        </a>{" "}
        dataset (ULB / Worldline, European cardholders, September 2013). Scores and money figures are estimates; a person should review blocks.
      </p>
    </footer>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Logo dark />
        <nav aria-label="Main" className="side-nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}>
              <Icon size={19} aria-hidden="true" />
              <span className="side-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <main id="main" tabIndex={-1} className="page-enter">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
}
