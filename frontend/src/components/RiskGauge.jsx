import { useEffect, useState } from 'react';

const RISK_TONES = {
  low: '#2bc7a0',
  medium: '#f4c15d',
  high: '#ff8b4d',
  critical: '#ff5f5f',
};

export default function RiskGauge({ score, riskLevel = 'critical' }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = 78;
  const circumference = Math.PI * radius;
  const dashOffset = circumference - (circumference * animatedScore) / 100;
  const color = RISK_TONES[riskLevel] || RISK_TONES.critical;

  useEffect(() => {
    let frameId;
    let start;

    function animate(timestamp) {
      if (!start) {
        start = timestamp;
      }
      const progress = Math.min((timestamp - start) / 900, 1);
      setAnimatedScore(Math.round(score * progress));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    }

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [score]);

  return (
    <div className="risk-gauge">
      <svg viewBox="0 0 220 140" className="risk-gauge__svg" role="img" aria-label={`Risk score ${score}`}>
        <defs>
          <linearGradient id="riskGaugeGradient" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#1f4d46" />
            <stop offset="40%" stopColor="#f4c15d" />
            <stop offset="75%" stopColor="#ff8b4d" />
            <stop offset="100%" stopColor="#ff5f5f" />
          </linearGradient>
        </defs>
        <path
          d="M 31 109 A 79 79 0 0 1 189 109"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M 31 109 A 79 79 0 0 1 189 109"
          fill="none"
          stroke="url(#riskGaugeGradient)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 120ms linear' }}
        />
        <circle cx="110" cy="109" r="6" fill={color} />
      </svg>
      <div className="risk-gauge__content">
        <span className="panel-kicker">Composite Score</span>
        <strong style={{ color }}>{animatedScore}/100</strong>
        <p>{riskLevel.toUpperCase()} risk band</p>
      </div>
    </div>
  );
}
