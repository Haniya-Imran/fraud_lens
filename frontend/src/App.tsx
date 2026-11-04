import { Link, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import BatchPage from "./pages/BatchPage";
import CheckPage from "./pages/CheckPage";
import DashboardPage from "./pages/DashboardPage";
import LandingPage from "./pages/LandingPage";
import ModelPage from "./pages/ModelPage";
import { SettingsProvider } from "./lib/settings";

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/check" element={<CheckPage />} />
          <Route path="/batch" element={<BatchPage />} />
          <Route path="/model" element={<ModelPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SettingsProvider>
  );
}
