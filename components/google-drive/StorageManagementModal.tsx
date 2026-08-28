"use client";

import { useState } from "react";
import type { DriveAccount } from "./GoogleDriveAccounts";

interface Props {
  accounts: DriveAccount[];
  selectedAccountId: string;
  onClose: () => void;
  onRefresh: () => void;
}

function quota(value?: number) {
  if (!value) return "0 GB";
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function StorageManagementModal({ accounts, selectedAccountId, onClose, onRefresh }: Props) {
  const [pendingDisconnect, setPendingDisconnect] = useState<DriveAccount | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");
  const totalUsage = accounts.reduce((sum, account) => sum + (account.usageBytes || 0), 0);
  const totalLimit = accounts.reduce((sum, account) => sum + (account.limitBytes || 0), 0);
  const totalPercent = totalLimit > 0 ? Math.round((totalUsage / totalLimit) * 100) : 0;

  const disconnectAccount = async () => {
    if (!pendingDisconnect || disconnecting) return;
    setDisconnecting(true);
    setDisconnectError("");
    try {
      const response = await fetch(`/api/google-drive/accounts?accountId=${encodeURIComponent(pendingDisconnect.id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setDisconnectError(data?.error?.message || "Gagal disconnect akun.");
        return;
      }
      setPendingDisconnect(null);
      onRefresh();
    } catch {
      setDisconnectError("Gagal disconnect akun.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="glass-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="glass-modal storage-modal" onClick={(event) => event.stopPropagation()}>
        <div className="glass-glow" />
        <div className="modal-head">
          <div>
            <h2>Storage Management</h2>
            <p>Kelola semua akun Google Drive yang terhubung ke AllDrive.</p>
          </div>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>

        <div className="storage-summary">
          <div className="storage-stat">
            <small>Total Akun</small>
            <strong>{accounts.length}</strong>
          </div>
          <div className="storage-stat">
            <small>Total Storage</small>
            <strong>{quota(totalUsage)} / {quota(totalLimit)}</strong>
          </div>
          <div className="storage-stat">
            <small>Usage Rata-rata</small>
            <strong>{totalPercent}%</strong>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="storage-empty">Belum ada akun Google Drive yang terhubung.</div>
        ) : (
          <div className="storage-account-list">
            {accounts.map((account) => (
              <div key={account.id} className={`storage-account-card ${account.id === selectedAccountId ? "active" : ""}`}>
                <span className="explorer-avatar">
                  {account.picture ? <img src={account.picture} alt="" /> : account.email.slice(0, 2).toUpperCase()}
                </span>
                <div className="storage-account-meta">
                  <b>{account.name || "Drive account"}</b>
                  <small>{account.email}</small>
                  <small>{quota(account.usageBytes)} dari {quota(account.limitBytes)} • {account.usagePercent || 0}% used</small>
                  <div className="storage-progress"><span style={{ width: `${account.usagePercent || 0}%` }} /></div>
                </div>
                <div className="storage-actions">
                  <button className="btn danger" onClick={() => setPendingDisconnect(account)}>Disconnect</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingDisconnect && (
          <div className="glass-backdrop confirm-backdrop" role="dialog" aria-modal="true" onClick={() => !disconnecting && setPendingDisconnect(null)}>
            <div className="glass-modal small-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h2>Disconnect Account</h2>
                  <p>Akun ini akan dihapus dari AllDrive, tapi data di Google Drive tidak terhapus.</p>
                </div>
                <button className="modal-close" onClick={() => setPendingDisconnect(null)} disabled={disconnecting}>X</button>
              </div>
              <div className="confirm-account">
                <span className="explorer-avatar">
                  {pendingDisconnect.picture ? <img src={pendingDisconnect.picture} alt="" /> : pendingDisconnect.email.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <b>{pendingDisconnect.name || "Drive account"}</b>
                  <small>{pendingDisconnect.email}</small>
                </div>
              </div>
              {disconnectError && <p className="form-error">{disconnectError}</p>}
              <div className="modal-footer">
                <button className="btn ghost" onClick={() => setPendingDisconnect(null)} disabled={disconnecting}>Cancel</button>
                <button className="btn danger" onClick={() => void disconnectAccount()} disabled={disconnecting}>
                  {disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
