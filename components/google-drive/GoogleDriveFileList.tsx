"use client";

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

interface Props {
  files: DriveFileItem[];
  loading: boolean;
  selectedAccountId: string;
  onRefresh: () => void;
}

function formatBytes(bytes?: string) {
  if (!bytes) return "-";
  const value = Number(bytes);
  if (Number.isNaN(value)) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function GoogleDriveFileList({ files, loading, selectedAccountId, onRefresh }: Props) {
  return (
    <div className="table-wrap">
      <div className="table-header">
        <div>
          <h2 style={{ margin: 0 }}>Drive Files</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>{files.length} items loaded from active account</p>
        </div>
        <button onClick={onRefresh} className="btn secondary" disabled={!selectedAccountId || loading}>Refresh</button>
      </div>
      {loading ? (
        <div style={{ padding: 24 }} className="muted">Loading files...</div>
      ) : files.length === 0 ? (
        <div style={{ padding: 24 }} className="muted">No files found on this drive account.</div>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Size</th><th>Modified</th><th>Action</th></tr></thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.id}>
                <td><strong>{file.name}</strong><div className="muted">{file.mimeType}</div></td>
                <td>{formatBytes(file.size)}</td>
                <td>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : "-"}</td>
                <td><a href={`/api/google-drive/files/${file.id}/download?accountId=${encodeURIComponent(selectedAccountId)}`} className="btn secondary">Download</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
