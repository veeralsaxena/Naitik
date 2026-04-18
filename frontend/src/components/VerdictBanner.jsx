const STATUS_CLASS = {
  APPROVED: 'approved',
  FLAGGED: 'flagged',
  REJECTED: 'rejected',
};

export default function VerdictBanner({ status, riskScore, riskLevel, explanation, processingTimeMs, rejectReason }) {
  return (
    <section className={`verdict-banner verdict-banner--${STATUS_CLASS[status] || 'rejected'}`}>
      <div className="verdict-banner__headline">
        <div>
          <span className="panel-kicker">Final Verdict</span>
          <h2>{status}</h2>
        </div>
        <div className="verdict-banner__score">
          <strong>{riskScore}/100</strong>
          <span>{riskLevel}</span>
        </div>
      </div>

      <div className="verdict-banner__body">
        <p>{explanation}</p>
        <div className="verdict-banner__meta">
          <span>Processing time: {Number(processingTimeMs || 0).toFixed(0)} ms</span>
          <span>Reject reason: {rejectReason || 'N/A'}</span>
        </div>
      </div>
    </section>
  );
}
