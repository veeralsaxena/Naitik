export default function ExifSummary({ flags }) {
  const hasFlags = Array.isArray(flags) && flags.length > 0;

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">Metadata Audit</span>
          <h2>EXIF summary</h2>
        </div>
      </div>
      {hasFlags ? (
        <div className="exif-list">
          {flags.map((flag) => (
            <div key={flag} className="exif-pill exif-pill--bad">
              {flag.replaceAll('_', ' ')}
            </div>
          ))}
        </div>
      ) : (
        <div className="exif-list">
          <div className="exif-pill exif-pill--good">No suspicious EXIF fields</div>
        </div>
      )}
    </article>
  );
}
