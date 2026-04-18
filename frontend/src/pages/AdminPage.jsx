import { useState } from 'react';

import { apiClient } from '../api/client';
import ExifSummary from '../components/ExifSummary';
import GradCAMPanel from '../components/GradCAMPanel';
import HeatmapViewer from '../components/HeatmapViewer';
import RiskGauge from '../components/RiskGauge';
import SignalBreakdown from '../components/SignalBreakdown';
import VerdictBanner from '../components/VerdictBanner';

const ADMIN_PIN = '1234'; // hackathon demo PIN

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
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submittedFileName, setSubmittedFileName] = useState('');

  function handlePinSubmit(e) {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      setAuthenticated(true);
      setPinError('');
    } else {
      setPinError('Invalid PIN. Try again.');
    }
  }

  async function handleFileSubmit(file) {
    setIsLoading(true);
    setError('');
    setResult(null);
    setSubmittedFileName(file.name);
    try {
      const formData = new FormData();
      formData.append('media_file', file);
      const response = await apiClient.post('/verify/media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
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

  // ── PIN Gate ──
  if (!authenticated) {
    return (
      <div className="result-page">
        <div className="result-card">
          <div className="result-icon">🔐</div>
          <h1 className="result-title">Analyst Login</h1>
          <p className="result-subtitle">
            Enter the admin PIN to access the forensic analyst console.
          </p>
          <form onSubmit={handlePinSubmit} style={{ display: 'grid', gap: '16px', marginTop: '8px' }}>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="admin-pin-input"
            />
            {pinError && <div className="kyc-error">{pinError}</div>}
            <button className="kyc-primary-btn" type="submit">Unlock Console</button>
          </form>
          <div style={{ marginTop: '24px' }}>
            <a href="/" className="kyc-admin-link">← Back to KYC Flow</a>
          </div>
        </div>
      </div>
    );
  }

  // ── Scores — read from both top-level and forensics.scores ──
  const scores = result?.scores ?? result?.forensics?.scores ?? {};
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
          <a href="/" className="kyc-ghost-btn" style={{ fontSize: '12px', padding: '6px 12px' }}>← Switch to KYC Flow</a>
          <div className="review-header__meta">
            <span>Status</span>
            <strong className={
              result?.status === 'APPROVED' ? 'text-green' :
              result?.status === 'FLAGGED' ? 'text-amber' :
              result?.status === 'REJECTED' ? 'text-red' : ''
            }>{result ? result.status : 'AWAITING INPUT'}</strong>
            <small>{result ? `${result.processing_time_ms?.toFixed(0)}ms` : 'No submission yet'}</small>
          </div>
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
            <p>Running forensic pipeline on <strong>{submittedFileName}</strong>…</p>
          </div>
        ) : (
          <>
            <div className="admin-upload-icon">📁</div>
            <p>Drag & drop an image or video here, or click to upload</p>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>
              Supported: JPG, PNG, WebP, MP4, MOV, WebM (max 50MB)
            </p>
            <label className="kyc-primary-btn" style={{ cursor: 'pointer' }}>
              Upload Media
              <input type="file" accept="image/*,video/*,.webm,.mp4,.mov" onChange={handleUpload} hidden />
            </label>
          </>
        )}
      </div>

      {error && <div className="kyc-error" style={{ marginTop: 16 }}>{error}</div>}

      {result && (
        <>
          {/* Explanation Banner */}
          {result.explanation && (
            <div className="admin-explanation" style={{ marginTop: 16 }}>
              <span className="panel-kicker">Pipeline Summary</span>
              <p style={{ margin: '8px 0 0', lineHeight: '1.65', color: 'var(--muted)' }}>{result.explanation}</p>
            </div>
          )}

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
                    <h2>Composite risk score</h2>
                  </div>
                </div>
                <RiskGauge score={result.risk_score ?? 0} riskLevel={result.risk_level} />
              </article>
            </section>

            <section className="dashboard-column">
              <HeatmapViewer
                title="Error Level Analysis"
                subtitle="Compression inconsistencies and localized resave anomalies."
                imageB64={result.forensics?.ela_heatmap_b64}
                legendTitle="Cool → Hot"
                legendDescription="Blue/green = low residual error. Yellow/red = suspicious recomposition."
              />
              <HeatmapViewer
                title="Frequency Spectrum"
                subtitle="Periodic frequency spikes associated with synthetic generation artifacts."
                imageB64={result.forensics?.fft_spectrum_b64}
                legendTitle="Low → High Energy"
                legendDescription="Concentrated hot grid points away from center indicate unnatural spatial periodicity."
              />
            </section>

            <section className="dashboard-column">
              <GradCAMPanel overlayB64={result.forensics?.gradcam_overlay_b64} />

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <span className="panel-kicker">Biometric Signals</span>
                    <h2>Liveness, identity, and GenD scores</h2>
                  </div>
                </div>
                <MetricRail
                  label="Liveness"
                  value={scores.liveness != null ? (scores.liveness * 100).toFixed(1) : 'N/A'}
                  suffix={scores.liveness != null ? '%' : ''}
                  tone={(scores.liveness ?? 0) >= 0.8 ? 'good' : (scores.liveness ?? 0) >= 0.7 ? 'warn' : 'bad'}
                  percentage={(scores.liveness ?? 0) * 100}
                />
                <MetricRail
                  label="ArcFace Similarity"
                  value={scores.arcface_similarity != null ? (scores.arcface_similarity * 100).toFixed(1) : 'N/A'}
                  suffix={scores.arcface_similarity != null ? '%' : ''}
                  tone={(scores.arcface_similarity ?? 0) >= 0.5 ? 'good' : (scores.arcface_similarity ?? 0) >= 0.35 ? 'warn' : 'bad'}
                  percentage={(scores.arcface_similarity ?? 0) * 100}
                />
                <MetricRail
                  label="GenD Fake Probability"
                  value={scores.gend_fake_prob != null ? (scores.gend_fake_prob * 100).toFixed(1) : 'N/A'}
                  suffix={scores.gend_fake_prob != null ? '%' : ''}
                  tone={(scores.gend_fake_prob ?? 0) <= 0.4 ? 'good' : (scores.gend_fake_prob ?? 0) <= 0.65 ? 'warn' : 'bad'}
                  percentage={(scores.gend_fake_prob ?? 0) * 100}
                />
                <MetricRail
                  label="Blur Variance"
                  value={scores.blur_variance != null ? scores.blur_variance.toFixed(1) : 'N/A'}
                  suffix=""
                  tone={(scores.blur_variance ?? 0) >= 100 ? 'good' : (scores.blur_variance ?? 0) >= 35 ? 'warn' : 'bad'}
                  percentage={Math.min(((scores.blur_variance ?? 0) / 500) * 100, 100)}
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
              {videoAnalysis?.frame_scores && videoAnalysis.frame_scores.length > 0 && (
                <div className="video-metrics" style={{ marginTop: 16, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--cyan)', marginBottom: 8 }}>Video Frame Analysis</div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
                    Frame fake scores: {videoAnalysis.frame_scores.map((s) => s.toFixed(2)).join(', ')}
                  </span>
                  <br />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--muted)' }}>
                    Temporal variance: {(videoAnalysis.temporal_variance ?? 0).toFixed(4)}
                  </span>
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
