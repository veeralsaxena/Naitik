import { useState } from 'react';

import { apiClient } from '../api/client';
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
        <strong>{value}{suffix}</strong>
      </div>
      <div className="metric-rail__track">
        <div className={`metric-rail__fill is-${tone}`} style={{ width: `${Math.max(0, Math.min(percentage, 100))}%` }} />
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  async function handleFileSubmit(file) {
    setIsLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('media_file', file);
      const response = await apiClient.post('/verify/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Pipeline failed');
    } finally {
      setIsLoading(false);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSubmit(file);
  }

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (file) handleFileSubmit(file);
  }

  const scores = result?.forensics?.scores ?? result?.scores ?? {};
  const signalBreakdown = result?.signal_breakdown ?? [];
  const videoAnalysis = result?.video_analysis ?? {};

  return (
    <div className="review-page">
      <header className="review-header">
        <div>
          <span className="eyebrow">Naitik Admin Portal</span>
          <h1>Forensic Analyst Console</h1>
          <p>Upload media to run the 7-stage forensic pipeline. View deepfake signals, heatmaps, and risk assessment.</p>
        </div>
        <div className="review-header__meta">
          <span>Status</span>
          <strong>{result ? result.status : 'AWAITING INPUT'}</strong>
          <small>{result ? `${result.processing_time_ms?.toFixed(0)}ms` : 'No submission yet'}</small>
        </div>
      </header>

      {/* Upload zone (always visible at top) */}
      <div
        className={`admin-upload-zone ${dragOver ? 'is-dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
      >
        {isLoading ? (
          <div className="admin-upload-loading">
            <div className="kyc-spinner" />
            <p>Running forensic pipeline…</p>
          </div>
        ) : (
          <>
            <div className="admin-upload-icon">📁</div>
            <p>Drag & drop an image or video here, or click to upload</p>
            <label className="kyc-primary-btn">
              Upload Media
              <input type="file" accept="image/*,video/*" onChange={handleUpload} hidden />
            </label>
          </>
        )}
      </div>

      {error && <div className="kyc-error" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <>
          <div className="dashboard-grid" style={{ marginTop: 24 }}>
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
                  <div className="analysis-empty">No face boundary overlay available.</div>
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
                legendDescription="Blue/green indicates low residual error. Yellow/red indicates suspicious recomposition."
              />
              <HeatmapViewer
                title="Frequency Spectrum"
                subtitle="Periodic frequency spikes associated with synthetic generation artifacts."
                imageB64={result.forensics?.fft_spectrum_b64}
                legendTitle="Low → High Energy"
                legendDescription="Concentrated hot grid points away from the center indicate unnatural spatial periodicity."
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
                  value={scores.liveness != null ? ((scores.liveness) * 100).toFixed(1) : 'N/A'}
                  suffix={scores.liveness != null ? '%' : ''}
                  tone={(scores.liveness || 0) >= 0.8 ? 'good' : (scores.liveness || 0) >= 0.7 ? 'warn' : 'bad'}
                  percentage={(scores.liveness || 0) * 100}
                />
                <MetricRail
                  label="ArcFace Similarity"
                  value={scores.arcface_similarity != null ? (scores.arcface_similarity * 100).toFixed(1) : 'N/A'}
                  suffix={scores.arcface_similarity != null ? '%' : ''}
                  tone={(scores.arcface_similarity || 0) >= 0.5 ? 'good' : (scores.arcface_similarity || 0) >= 0.35 ? 'warn' : 'bad'}
                  percentage={(scores.arcface_similarity || 0) * 100}
                />
                <MetricRail
                  label="GenD Fake Probability"
                  value={scores.gend_fake_prob != null ? ((scores.gend_fake_prob) * 100).toFixed(1) : 'N/A'}
                  suffix={scores.gend_fake_prob != null ? '%' : ''}
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
              {videoAnalysis?.frame_scores && (
                <div className="video-metrics">
                  <span>Video frame fake scores: {videoAnalysis.frame_scores.map((s) => s.toFixed(2)).join(', ')}</span>
                  <span>Temporal variance: {(videoAnalysis.temporal_variance || 0).toFixed(4)}</span>
                </div>
              )}
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
        </>
      )}
    </div>
  );
}
