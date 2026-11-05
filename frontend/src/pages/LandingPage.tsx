import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Logo, Footer } from "../components/Layout";
import { Radar } from "../components/three/Radar";
import { api } from "../lib/api";
import { eur, num, pct } from "../lib/format";
import { useApi } from "../lib/useApi";

export default function LandingPage() {
  const info = useApi((s) => api.modelInfo(s));
  const samples = useApi((s) => api.samples(s));
  const m = info.data;
  const q = m?.dataset.quality;
  const fraudSample = samples.data?.samples.find((s) => s.known_class === 1 && s.score >= (m?.threshold.value ?? 1));
  const rows = Number(q?.rows ?? 0);
  const fraud = Number(q?.fraud ?? 0);

  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="container">
        <header className="land-nav">
          <Logo />
          <nav aria-label="Main" className="land-links">
            <a href="#why">Why FraudLens</a>
            <a href="#how">How it works</a>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/check">Check a transaction</Link>
          </nav>
          <Link to="/check" className="btn btn-dark">
            Get started
          </Link>
        </header>

        <main id="main" tabIndex={-1}>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow-chip mono">FRAUD DETECTION · EXPLAINABLE AI</span>
              <h1>
                Catch more fraud. <span className="grad">Lose less money.</span>
              </h1>
              <p className="lead">
                FraudLens finds the rare fraudulent card payments hidden among normal ones, lets you choose how strict the alarm should be, and
                estimates how much money that choice saves.
              </p>
              <div className="cta-row">
                <Link to="/check" className="btn btn-green btn-lg">
                  Check a transaction <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link to="/dashboard" className="btn btn-light btn-lg">
                  Open dashboard
                </Link>
              </div>
              <dl className="hero-stats">
                <div>
                  <dt>card transactions</dt>
                  <dd className="mono">{m ? num(rows) : "—"}</dd>
                </div>
                <div>
                  <dt>are fraud</dt>
                  <dd className="mono">{m ? pct(fraud / rows, 2) : "—"}</dd>
                </div>
                <div>
                  <dt>est. money saved (test period)</dt>
                  <dd className="mono ink-green">{m ? eur(m.test_metrics.net_benefit, 0) : "—"}</dd>
                </div>
              </dl>
              {info.error && <p className="hint">Live figures are unavailable right now: {info.error.message}</p>}
            </div>
            <div className="hero-art">
              <Radar
                netBenefit={m?.test_metrics.net_benefit}
                threshold={m?.threshold.value}
                blocked={fraudSample ? { amount: fraudSample.features.Amount, score: fraudSample.score, rowId: fraudSample.row_id } : undefined}
              />
            </div>
          </section>

          <section id="why" className="land-section">
            <span className="eyebrow mono">WHY FRAUDLENS</span>
            <h2>Built for the three hard parts of fraud detection</h2>
            <div className="why-grid">
              <article className="card">
                <h3>1. Very imbalanced data</h3>
                <p>
                  Only {m ? num(fraud) : "492"} of {m ? num(rows) : "284,807"} payments are fraud. A model that always says "normal" is 99.8% accurate and
                  useless, so FraudLens is judged by precision, recall and PR-AUC instead.
                </p>
                <div className="imbalance-bar" aria-hidden="true">
                  <div style={{ flex: 99 }} className="imb-legit" />
                  <div style={{ flex: 1 }} className="imb-fraud" />
                </div>
                <div className="imbalance-legend mono">
                  <span>99.83% normal</span>
                  <span className="ink-fraud">0.17% fraud</span>
                </div>
              </article>
              <article className="card card-dark">
                <h3>2. You choose the threshold</h3>
                <p>
                  Move one slider to decide how strict the alarm is. A lower threshold catches more fraud but stops more honest customers. The trade-off is
                  recalculated live on held-out data.
                </p>
                <div className="fake-slider" aria-hidden="true">
                  <span style={{ left: `${(m?.threshold.value ?? 0.26) * 100}%` }} />
                </div>
                <div className="imbalance-legend mono muted-dark">
                  <span>catch more</span>
                  <span>fewer alarms</span>
                </div>
              </article>
              <article className="card">
                <h3>3. Money saved, not just accuracy</h3>
                <p>Business teams care about money. Every threshold is turned into a transparent estimate from the real transaction amounts.</p>
                <div className="formula mono">Net benefit = fraud amount caught × effectiveness − false alarms × review cost</div>
              </article>
            </div>
          </section>

          <section id="how" className="land-section">
            <span className="eyebrow mono">HOW IT WORKS</span>
            <div className="how-grid">
              {[
                ["01", "Send a transaction", "Pick a real test sample, type the values, or upload a CSV batch."],
                ["02", "Model scores it", `A ${m?.model_name ?? "LightGBM"} model returns a fraud score from 0 to 1 in milliseconds.`],
                ["03", "Threshold decides", "Block or approve, with a review flag when the score is close to the line."],
                ["04", "See why and the cost", "SHAP shows the top reasons; the money panel shows the estimated impact."],
              ].map(([n, t, d]) => (
                <div key={n} className="how-card">
                  <span className="mono how-n">{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="cta-band">
            <div>
              <h2>Try it on a real transaction</h2>
              <p>Pick a sample from the held-out test period and see the verdict in seconds.</p>
            </div>
            <Link to="/check" className="btn btn-mint btn-lg">
              Check a transaction <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </section>
        </main>
        <Footer />
      </div>
    </div>
  );
}
