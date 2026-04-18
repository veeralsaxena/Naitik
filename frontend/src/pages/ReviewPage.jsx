import { Navigate, useLocation } from 'react-router-dom';

import ExifSummary from '../components/ExifSummary';
import GradCAMPanel from '../components/GradCAMPanel';
import HeatmapViewer from '../components/HeatmapViewer';
import RiskGauge from '../components/RiskGauge';
import SignalBreakdown from '../components/SignalBreakdown';
import VerdictBanner from '../components/VerdictBanner';

function MetricRail({ label, value, suffix = '', tone = 'neutral', percentage = 0 }) {
  return (
    <div className="metric-rail">
      <div className="metric-rail__header">
        <span>{label}</span>
        <strong>
          {value}
          {suffix}
        </strong>
      </div>
      <div className="metric-rail__track">
        <div className={`metric-rail__fill is-${tone}`} style={{ width: `${Math.max(0, Math.min(percentage, 100))}%` }} />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const location = useLocation();
  const result = location.state?.result;

  if (!result) {
    return <Navigate to="/" replace />;
  }

  const scores = result.forensics?.scores ?? result.scores ?? {};
  const signalBreakdown = result.signal_breakdown ?? [];
  const videoAnalysis = result.video_analysis ?? {};

  return (
    <div className="review-page">
      <header className="review-header">
        <div>
          <span className="eyebrow">Forensic Review Dashboard</span>
          <h1>Naitik analyst console</h1>
          <p>Clinical review surface for KYC fraud screening, deepfake detection, and identity match assessment.</p>
        </div>
        <div className="review-header__meta">
          <span>Session</span>
          <strong>{result.session_id || 'UNTRACKED'}</strong>
          <small>{result.submission_source || 'manual'} submission</small>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-column">
          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Subject Media</span>
                <h2>Original image with face boundary</h2>
              </div>
            </div>
            {result.forensics?.face_bbox_b64 ? (
              <img src={result.forensics.face_bbox_b64} alt="Subject with face boundary" className="analysis-image" />
            ) : (
              <div className="analysis-empty">No image preview available.</div>
            )}
          </article>

          <article className="panel gauge-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Overall Risk</span>
                <h2>Analyst confidence gauge</h2>
              </div>
            </div>
            <RiskGauge score={result.risk_score || 0} riskLevel={result.risk_level} />
          </article>
        </section>

        <section className="dashboard-column">
          <HeatmapViewer
            title="Error Level Analysis"
            subtitle="Compression inconsistencies and localized resave anomalies."
            imageB64={result.forensics?.ela_heatmap_b64}
            legendTitle="Cool → Hot"
            legendDescription="Blue/green indicates low residual error. Yellow/red indicates localized compression mismatch or suspicious recomposition."
          />
          <HeatmapViewer
            title="Frequency Spectrum"
            subtitle="Periodic frequency spikes associated with synthetic generation artifacts."
            imageB64={result.forensics?.fft_spectrum_b64}
            legendTitle="Low Energy → High Energy"
            legendDescription="Concentrated hot grid points away from the center can indicate unnatural spatial periodicity rather than organic camera noise."
          />
        </section>

        <section className="dashboard-column">
          <GradCAMPanel overlayB64={result.forensics?.gradcam_overlay_b64} />

          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Biometric Signals</span>
                <h2>Liveness and identity match</h2>
              </div>
            </div>
            <MetricRail
              label="Liveness"
              value={((scores.liveness || 0) * 100).toFixed(1)}
              suffix="%"
              tone={(scores.liveness || 0) >= 0.8 ? 'good' : (scores.liveness || 0) >= 0.7 ? 'warn' : 'bad'}
              percentage={(scores.liveness || 0) * 100}
            />
            <MetricRail
              label="ArcFace Similarity"
              value={scores.arcface_similarity !== null && scores.arcface_similarity !== undefined ? (scores.arcface_similarity * 100).toFixed(1) : 'N/A'}
              suffix={scores.arcface_similarity !== null && scores.arcface_similarity !== undefined ? '%' : ''}
              tone={(scores.arcface_similarity || 0) >= 0.5 ? 'good' : (scores.arcface_similarity || 0) >= 0.35 ? 'warn' : 'bad'}
              percentage={(scores.arcface_similarity || 0) * 100}
            />
            <MetricRail
              label="GenD Fake Probability"
              value={((scores.gend_fake_prob || 0) * 100).toFixed(1)}
              suffix="%"
              tone={(scores.gend_fake_prob || 0) <= 0.4 ? 'good' : (scores.gend_fake_prob || 0) <= 0.65 ? 'warn' : 'bad'}
              percentage={(scores.gend_fake_prob || 0) * 100}
            />
          </article>

          <ExifSummary flags={scores.exif_flags || []} />
        </section>
      </div>

      <div className="lower-grid">
        <article className="panel panel--wide">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Signal Breakdown</span>
              <h2>Risk-contributing signals across the seven-stage workflow</h2>
            </div>
          </div>
          <SignalBreakdown signalBreakdown={signalBreakdown} />
          {videoAnalysis?.frame_scores ? (
            <div className="video-metrics">
              <span>Video frame fake scores: {videoAnalysis.frame_scores.map((score) => score.toFixed(2)).join(', ')}</span>
              <span>Temporal variance: {(videoAnalysis.temporal_variance || 0).toFixed(4)}</span>
            </div>
          ) : null}
        </article>
      </div>

      <VerdictBanner
        status={result.status}
        riskScore={result.risk_score}
        riskLevel={result.risk_level}
        explanation={result.explanation}
        processingTimeMs={result.processing_time_ms}
        rejectReason={result.reject_reason}
      />
    </div>
  );
}
