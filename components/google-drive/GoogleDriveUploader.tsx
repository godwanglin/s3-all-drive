"use client";

import { useEffect, useRef, useState } from "react";
import type { DriveAccount } from "./GoogleDriveAccounts";

interface DriveFolder {
  id: string;
  name: string;
}

interface Props {
  accounts: DriveAccount[];
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
  onUploaded: (accountId: string) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(file: File) {
  if (file.type.startsWith("image/")) return "IMG";
  if (file.type.includes("pdf")) return "PDF";
  if (file.type.includes("video")) return "VID";
  if (file.type.includes("audio")) return "AUD";
  return "FILE";
}

export function GoogleDriveUploader({ accounts, selectedAccountId, onAccountChange, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [folderId, setFolderId] = useState("root");
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const targetAccountId = selectedAccountId || accounts[0]?.id || "";

  useEffect(() => {
    if (!targetAccountId || !isOpen) {
      setFolders([]);
      return;
    }

    fetch(`/api/google-drive/folders?accountId=${encodeURIComponent(targetAccountId)}`)
      .then((res) => res.json())
      .then((data) => setFolders(data?.success && Array.isArray(data.data.folders) ? data.data.folders : []))
      .catch(() => setFolders([]));
  }, [targetAccountId, isOpen]);

  function selectFile(nextFile?: File) {
    if (!nextFile) return;
    setFile(nextFile);
    setProgress(0);
    setStatus("File ready to upload.");
  }

  function closeModal() {
    if (uploading) return;
    setIsOpen(false);
    setIsDragging(false);
    setFile(null);
    setProgress(0);
    setStatus("");
    setFolderId("root");
  }

  function uploadFile() {
    if (!file || !targetAccountId || uploading) return;
    const formData = new FormData();
    formData.append("accountId", targetAccountId);
    formData.append("folderId", folderId);
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    setUploading(true);
    setStatus("Uploading to Google Drive...");
    setProgress(1);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) {
          setProgress(100);
          setStatus("Upload completed successfully.");
          setFile(null);
          onUploaded(targetAccountId);
          return;
        }
        setStatus(data?.error?.message || "Upload failed.");
      } catch {
        setStatus("Upload failed.");
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setStatus("Upload failed. Please retry.");
    };

    xhr.open("POST", "/api/google-drive/files/upload");
    xhr.send(formData);
  }

  return (
    <>
      <button className="btn upload-open-btn" onClick={() => setIsOpen(true)}>
        Upload File
      </button>

      {isOpen && (
        <div className="glass-backdrop" role="dialog" aria-modal="true">
          <div className="glass-modal">
            <div className="glass-glow" />
            <div className="modal-head">
              <div>
                <h2>Upload File</h2>
                <p>Stream file directly to selected Google Drive account.</p>
              </div>
              <button className="modal-close" onClick={closeModal} aria-label="Close upload modal">
                X
              </button>
            </div>

            <button
              className={`dropzone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                selectFile(event.dataTransfer.files?.[0]);
              }}
              type="button"
            >
              {file ? (
                <div className="selected-file">
                  <div className="file-badge">{getFileIcon(file)}</div>
                  <div>
                    <strong>{file.name}</strong>
                    <span>
                      {formatBytes(file.size)} - {file.type || "application/octet-stream"}
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="upload-icon">↑</div>
                  <strong>Drop file here or click to browse</strong>
                  <span>Metadata is sent before the file so upload can stream directly to Google Drive.</span>
                </>
              )}
            </button>
            <input ref={inputRef} type="file" hidden onChange={(event) => selectFile(event.target.files?.[0])} />

            <label className="field-label" htmlFor="target-account">Target Storage Account</label>
            <select
              id="target-account"
              className="glass-select"
              value={targetAccountId}
              onChange={(event) => onAccountChange(event.target.value)}
              disabled={uploading}
            >
              <option value="">Automatic (Default)</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.email} ({account.email})
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="virtual-folder">Virtual Folder</label>
            <select
              id="virtual-folder"
              className="glass-select"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              disabled={!targetAccountId || uploading}
            >
              <option value="root">Root Drive</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>

            {(status || uploading || progress > 0) && (
              <div className="upload-state">
                <div className="progress-row">
                  <span>{status}</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn ghost" onClick={closeModal} disabled={uploading}>Cancel</button>
              <button className="btn accent" onClick={uploadFile} disabled={!file || !targetAccountId || uploading}>
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
