"use client";

import { useMemo, useState } from "react";
import type { DriveAccount } from "./GoogleDriveAccounts";
import type { DriveFileItem } from "./GoogleDriveFileList";
import { GoogleDriveUploader } from "./GoogleDriveUploader";

interface Props {
  accounts: DriveAccount[];
  selectedAccountId: string;
  files: DriveFileItem[];
  loading: boolean;
  currentFolderId?: string;
  folderHistory?: Array<{ id: string; name: string }>;
  onNavigateFolder?: (folder: { id: string; name: string }) => void;
  onSelectAccount: (id: string) => void;
  onTabChange?: (tab: string) => void;
  onRefresh: () => void;
  onManageStorage?: () => void;
}

function bytes(value?: string) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1073741824) return `${(size / 1048576).toFixed(1)} MB`;
  return `${(size / 1073741824).toFixed(2)} GB`;
}

function quota(value?: number) {
  if (!value) return "0 GB";
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function typeOf(file: DriveFileItem) {
  const mime = (file.mimeType || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (mime.includes("folder")) return ["FOLDER", "folder", "folder"];
  if (mime.includes("image") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return ["IMAGE", "image", "image"];
  if (mime.includes("pdf") || ext === "pdf") return ["PDF", "pdf", "picture_as_pdf"];
  if (mime.includes("spreadsheet") || mime.includes("excel") || ["xlsx", "xls", "csv", "tsv"].includes(ext)) return ["SHEET", "sheet", "table_view"];
  if (mime.includes("presentation") || ["pptx", "ppt", "key"].includes(ext)) return ["SLIDE", "slide", "slideshow"];
  if (mime.includes("video") || ["mp4", "mkv", "mov", "webm", "avi"].includes(ext)) return ["VIDEO", "video", "movie"];
  if (mime.includes("audio") || ["mp3", "wav", "flac", "m4a", "ogg"].includes(ext)) return ["AUDIO", "audio", "audio_file"];
  if (mime.includes("zip") || mime.includes("compressed") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) return ["ZIP", "archive", "folder_zip"];
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("typescript") || ["ts", "tsx", "js", "jsx", "json", "html", "css", "py", "rs", "sql", "md"].includes(ext)) return ["CODE", "code", "code"];
  if (mime.includes("document") || mime.includes("word") || mime.includes("text") || ["docx", "doc", "txt", "rtf"].includes(ext)) return ["DOC", "doc", "description"];
  return ["FILE", "file", "draft"];
}

export function GlassFileExplorer({ accounts, selectedAccountId, files, loading, currentFolderId = "root", folderHistory = [{ id: "root", name: "Root" }], onNavigateFolder, onSelectAccount, onTabChange, onRefresh, onManageStorage }: Props) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [contextFile, setContextFile] = useState<DriveFileItem | null>(null);
  const [contextPosition, setContextPosition] = useState({ x: 0, y: 0 });
  const [previewFile, setPreviewFile] = useState<DriveFileItem | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [connectUrl, setConnectUrl] = useState("");
  const [connectToken, setConnectToken] = useState("");
  const [connectError, setConnectError] = useState("");
  const [loadingConnectUrl, setLoadingConnectUrl] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [connectingToken, setConnectingToken] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const previewKind = previewFile ? typeOf(previewFile)[1] : "";
  const shownFiles = useMemo(() => {
    const filtered = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
    const sorted = tab === "recent" ? filtered.slice().sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || "")) : filtered;
    return sorted.slice().sort((a, b) => Number(b.mimeType?.includes("folder")) - Number(a.mimeType?.includes("folder")));
  }, [files, query, tab]);
  const toggle = (id: string) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const openItem = (file: DriveFileItem) => {
    const kind = typeOf(file)[1];
    if (kind === "folder" && onNavigateFolder) {
      onNavigateFolder({ id: file.id, name: file.name });
      return;
    }
    if (kind === "image") {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setPreviewFile(file);
      return;
    }
    if (kind === "video") {
      setPreviewFile(file);
    }
  };
  const openContext = (event: React.MouseEvent, file: DriveFileItem) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected([]);
    setContextFile(file);
    setContextPosition({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 300),
    });
  };
  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const response = await fetch("/api/google-drive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccountId, name, parentFolderId: currentFolderId }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setFolderError(data?.error?.message || "Failed to create folder.");
        return;
      }
      setNewFolderName("");
      setNewFolderOpen(false);
      onRefresh();
    } catch {
      setFolderError("Failed to create folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const openConnectDialog = async () => {
    setConnectModalOpen(true);
    setConnectError("");
    setConnectToken("");
    setLoadingConnectUrl(true);
    try {
      const response = await fetch("/api/google-drive/auth?format=json");
      const data = await response.json();
      setConnectUrl(data?.success ? data.data.url : "");
    } finally {
      setLoadingConnectUrl(false);
    }
  };

  const copyConnectUrl = async () => {
    if (!connectUrl) return;
    await navigator.clipboard.writeText(connectUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const connectWithToken = async () => {
    const token = connectToken.trim();
    if (!token || connectingToken) return;
    setConnectingToken(true);
    setConnectError("");
    try {
      const response = await fetch("/api/google-drive/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setConnectError(data?.error?.message || "Token tidak valid atau sudah kadaluarsa.");
        return;
      }
      setConnectToken("");
      setConnectModalOpen(false);
      onRefresh();
    } catch {
      setConnectError("Gagal menghubungkan Google Drive dengan token.");
    } finally {
      setConnectingToken(false);
    }
  };

  return (
    <div className="explorer-glass-shell">
      <aside className="explorer-sidebar">
        <div className="explorer-brand"><span className="brand-gem">9D</span><span><b>AllDrive</b><small>Multi-Drive Hub</small></span></div>
        <div className="explorer-label">EXPLORER</div>
        {[
          ["all", "All Files", "home"],
          ["recent", "Recent", "schedule"],
          ["starred", "Starred", "star"],
          ["shared", "Shared", "group"],
          ["trash", "Trash", "delete"],
        ].map(([key, label, icon]) => (
            <button key={key} className={`explorer-nav ${tab === key ? "active" : ""}`} onClick={() => { setTab(key); onTabChange?.(key); }}>
            <span className="material-symbols-rounded">{icon}</span>{label}
          </button>
        ))}
        <div className="explorer-label accounts-label">CONNECTED ACCOUNTS</div>
        <button type="button" className="connect-drive" onClick={() => void openConnectDialog()}>
          <span className="connect-drive-icon"><span className="material-symbols-rounded">add</span></span>
          <span>Connect New Drive</span>
        </button>
        {onManageStorage && (
          <button type="button" className="manage-drive-btn" onClick={onManageStorage}>
            <span className="material-symbols-rounded">storage</span>
            <span>Storage Management</span>
          </button>
        )}
      </aside>

      <section className="explorer-main">
        <header className="explorer-header">
          <div className="pathbar">
            <button
              className="pathbar-back"
              disabled={folderHistory.length <= 1}
              onClick={() => {
                if (folderHistory.length > 1) {
                  onNavigateFolder?.(folderHistory[folderHistory.length - 2]);
                }
              }}
              title="Back"
            >
              <span className="material-symbols-rounded">arrow_back</span>
            </button>
            <div className="pathbar-crumbs">
              {folderHistory.map((item, index) => (
                <span key={item.id} className="pathbar-segment">
                  <button
                    className={item.id === currentFolderId ? "active" : ""}
                    onClick={() => onNavigateFolder?.(item)}
                  >
                    {index === 0 ? "Root dir" : item.name}
                  </button>
                  {index < folderHistory.length - 1 && <i>›</i>}
                </span>
              ))}
            </div>
            <button className="pathbar-refresh" onClick={onRefresh} title="Refresh">
              <span className="material-symbols-rounded">refresh</span>
            </button>
          </div>
          <div className="explorer-toolbar">
            <label className="explorer-search"><span className="material-symbols-rounded">search</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and folders..." /></label>
            <div className="account-selector">
              <span className="material-symbols-rounded">account_circle</span>
              <select value={selectedAccountId} onChange={(event) => onSelectAccount(event.target.value)} disabled={accounts.length === 0}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.email}</option>
                ))}
              </select>
            </div>
            <div className="view-toggle"><button aria-label="Grid view" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><span className="material-symbols-rounded">grid_view</span></button><button aria-label="List view" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><span className="material-symbols-rounded">view_list</span></button></div>
            <button className="btn new-folder-btn" onClick={() => setNewFolderOpen(true)} disabled={!selectedAccountId}>
              <span className="material-symbols-rounded">create_new_folder</span>
              New Folder
            </button>
            <GoogleDriveUploader accounts={accounts} selectedAccountId={selectedAccountId} onAccountChange={onSelectAccount} onUploaded={onRefresh} />
          </div>
        </header>
        {selected.length > 0 && <div className="selection-bar"><b>{selected.length} selected</b><span /><button onClick={() => setSelected([])}>Clear</button></div>}
        {loading ? <div className="skeleton-explorer">{Array.from({ length: 8 }).map((_, i) => <div key={i} />)}</div> : shownFiles.length === 0 ? (
          <div className="explorer-empty"><div><span className="material-symbols-rounded">folder_open</span></div><h2>No files found</h2><p>Upload a file or connect another Drive account to start exploring.</p></div>
        ) : (
          <div className="file-scroll-panel">
          {view === "grid" ? (
            <div className="file-glass-grid">{shownFiles.map((file) => { const [label, kind, icon] = typeOf(file); const active = selected.includes(file.id); const isFolder = kind === "folder"; const imageUrl = `/api/google-drive/files/${file.id}/download?accountId=${selectedAccountId}&preview=1`; return <button key={file.id} className={`file-glass-card ${active ? "selected" : ""}`} onClick={() => openItem(file)} onContextMenu={(e) => openContext(e, file)}><div className="file-card-top"><span className={`type-pill ${kind}`}>{label}</span><input type="checkbox" checked={active} readOnly /></div>{isFolder ? <img className="folder-image-icon" src="/icons/folder.png" alt="" /> : kind === "image" ? <img className="image-file-preview" src={imageUrl} alt="" loading="lazy" /> : <div className={`file-icon ${kind}`}><span className="material-symbols-rounded">{icon}</span></div>}<strong title={file.name}>{file.name}</strong><small>{bytes(file.size)} <span>•</span> {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : "-"}</small></button>; })}</div>
          ) : (
            <div className="file-glass-table"><table><thead><tr><th></th><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th /></tr></thead><tbody>{shownFiles.map((file) => { const [label, kind, icon] = typeOf(file); const active = selected.includes(file.id); const isFolder = kind === "folder"; return <tr key={file.id} className={active ? "selected" : ""} onClick={() => openItem(file)} onContextMenu={(e) => openContext(e, file)}><td></td><td><b className="list-name-cell">{isFolder ? <img className="list-folder-icon" src="/icons/folder.png" alt="" /> : <span className={`material-symbols-rounded list-material-icon ${kind}`}>{icon}</span>}{file.name}</b></td><td><span className={`type-pill ${kind}`}>{label}</span></td><td>{isFolder ? "-" : bytes(file.size)}</td><td>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : "-"}</td><td>{!isFolder && <a href={`/api/google-drive/files/${file.id}/download?accountId=${selectedAccountId}`}>Download</a>}</td></tr>; })}</tbody></table></div>
          )}
          </div>
        )}
        {previewFile && (
          <div className="glass-backdrop" role="dialog" onClick={() => setPreviewFile(null)}>
            <div className="media-viewer-modal" onClick={(e) => e.stopPropagation()}>
              <div className="viewer-head">
                <strong>{previewFile.name}</strong>
                <div className="viewer-actions">
                  {previewKind === "image" && (
                    <>
                      <button onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}>+</button>
                      <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>-</button>
                      <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
                    </>
                  )}
                  <button onClick={() => setPreviewFile(null)}>X</button>
                </div>
              </div>
              <div className="viewer-body">
                {previewKind === "image" ? (
                  <div className="pan-zoom-container">
                    <img src={`/api/google-drive/files/${previewFile.id}/download?accountId=${selectedAccountId}&preview=1`} alt="" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
                  </div>
                ) : (
                  <video
                    controls
                    autoPlay
                    preload="metadata"
                    playsInline
                    src={`/api/google-drive/files/${previewFile.id}/stream?accountId=${selectedAccountId}`}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {newFolderOpen && (
          <div className="glass-backdrop" role="dialog" aria-modal="true" onClick={() => !creatingFolder && setNewFolderOpen(false)}>
            <div className="glass-modal small-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h2>New Folder</h2>
                  <p>Create folder in {folderHistory[folderHistory.length - 1]?.name || "Root"}.</p>
                </div>
                <button className="modal-close" onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}>X</button>
              </div>
              <label className="field-label" htmlFor="new-folder-name">Folder Name</label>
              <input
                id="new-folder-name"
                className="glass-input"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void createFolder(); }}
                placeholder="Nama folder"
                autoFocus
              />
              {folderError && <p className="form-error">{folderError}</p>}
              <div className="modal-footer">
                <button className="btn ghost" onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}>Cancel</button>
                <button className="btn accent" onClick={() => void createFolder()} disabled={!newFolderName.trim() || creatingFolder}>
                  {creatingFolder ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}

        {connectModalOpen && (
          <div className="glass-backdrop" role="dialog" aria-modal="true" onClick={() => setConnectModalOpen(false)}>
            <div className="glass-modal small-modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h2>Connect Google Drive</h2>
                  <p>Open langsung atau salin URL login untuk profile Chrome lain.</p>
                </div>
                <button className="modal-close" onClick={() => setConnectModalOpen(false)}>X</button>
              </div>
              <div className="connect-options">
                <a href={connectUrl || "/api/google-drive/auth"} target="_blank" rel="noreferrer" className="btn accent connect-action-btn">
                  <span className="material-symbols-rounded">open_in_new</span>
                  Open in Tab
                </a>
                <button type="button" className="btn ghost connect-action-btn" onClick={() => void copyConnectUrl()} disabled={loadingConnectUrl || !connectUrl}>
                  <span className="material-symbols-rounded">content_copy</span>
                  {copiedUrl ? "URL Copied" : "Salin URL"}
                </button>
              </div>
              <input className="glass-input connect-url-input" readOnly value={loadingConnectUrl ? "Preparing login URL..." : connectUrl} onClick={(event) => event.currentTarget.select()} />
              <label className="field-label" htmlFor="connect-token">Paste Callback Token</label>
              <textarea id="connect-token" className="glass-input connect-token-input" value={connectToken} onChange={(event) => setConnectToken(event.target.value)} placeholder="Paste token hasil callback dari profile Chrome lain di sini" />
              {connectError && <p className="form-error">{connectError}</p>}
              <button type="button" className="btn accent connect-submit-btn" onClick={() => void connectWithToken()} disabled={!connectToken.trim() || connectingToken}>
                {connectingToken ? "Validating..." : "Connect"}
              </button>
            </div>
          </div>
        )}

        {contextFile && (
          <div className="glass-context-menu" style={{ left: contextPosition.x, top: contextPosition.y }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { openItem(contextFile); setContextFile(null); }}>
              <span className="material-symbols-rounded">folder_open</span> Open
            </button>
            <button onClick={() => { navigator.clipboard.writeText(contextFile.name); setContextFile(null); }}>
              <span className="material-symbols-rounded">content_copy</span> Copy Name
            </button>
            {!contextFile.mimeType?.includes("folder") && (
              <a href={`/api/google-drive/files/${contextFile.id}/download?accountId=${selectedAccountId}`} className="menu-anchor">
                <span className="material-symbols-rounded">download</span> Download
              </a>
            )}
            <button onClick={() => { setContextFile(null); setSelected([]); }}>
              <span className="material-symbols-rounded">close</span> Close
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
