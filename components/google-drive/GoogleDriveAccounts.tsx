"use client";

export interface DriveAccount {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  usageBytes?: number;
  limitBytes?: number;
  usagePercent?: number;
}

interface Props {
  accounts: DriveAccount[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function GoogleDriveAccounts({ accounts, selectedId, onSelect }: Props) {
  return (
    <div className="card">
      <h2>Connected Google Drives</h2>
      <div className="account-list">
        {accounts.length === 0 ? (
          <p className="muted">No Google Drive connected yet.</p>
        ) : (
          accounts.map((account) => (
            <button
              key={account.id}
              className={`account-button ${account.id === selectedId ? "active" : ""}`}
              onClick={() => onSelect(account.id)}
            >
              {account.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.picture} alt="" className="avatar" />
              ) : (
                <div className="avatar" />
              )}
              <div>
                <strong>{account.name || "Google Account"}</strong>
                <div className="muted">{account.email}</div>
              </div>
            </button>
          ))
        )}
      </div>
      <div style={{ marginTop: 14 }}>
        <a href="/api/google-drive/auth" className="btn full">
          + Connect Google Drive
        </a>
      </div>
    </div>
  );
}
