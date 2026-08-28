"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "buckets" | "keys" | "storage" | "domains";
type Row = Record<string, any>;
type PendingDelete = { kind: "bucket" | "key" | "domain" | "folder" | "object"; item: Row };
type CreatedCredentials = { rawKey: string; accessKeyId: string; secretAccessKey: string };
const permissions = [
  "file:create", "file:read", "file:update", "file:delete",
  "video:create", "video:read",
  "folder:create", "folder:read", "folder:update", "folder:delete"
];

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Request failed");
  return payload.data;
}

function bytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function StorageAdminDashboard({ mode }: { mode: Mode }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [folders, setFolders] = useState<Row[]>([]);
  const [buckets, setBuckets] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [form, setForm] = useState<Row>({});
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [folderPath, setFolderPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: "Root" }]);
  const [newFolderName, setNewFolderName] = useState("");
  const currentFolderId = folderPath[folderPath.length - 1].id;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const bucketData = await api("/api/v1/buckets");
      const bucketList = bucketData.buckets || [];
      setBuckets(bucketList);
      const bucketId = selectedBucket || bucketList[0]?.id || "";
      if (!selectedBucket && bucketId) setSelectedBucket(bucketId);

      if (mode === "buckets") setRows(bucketList);
      if (mode === "keys") setRows((await api("/api/v1/api-keys")).api_keys || []);
      if (mode === "domains") setRows((await api("/api/v1/domains")).domains || []);
      if (mode === "storage" && bucketId) {
        const [folderData, objectData] = await Promise.all([
          api(`/api/v1/folders?bucket_id=${bucketId}${currentFolderId ? `&parent_id=${currentFolderId}` : ""}`),
          api(`/api/v1/objects?bucket_id=${bucketId}${currentFolderId ? `&folder_id=${currentFolderId}` : ""}`),
        ]);
        setFolders(folderData.folders || []);
        setRows(objectData.objects || []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [mode, selectedBucket, folderPath]);

  const filtered = useMemo(() => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const title = mode === "buckets" ? "Buckets" : mode === "keys" ? "API Keys" : mode === "storage" ? "Object Storage" : "Custom Domains";

  const create = () => {
    setForm(
      mode === "buckets"
        ? { name: "", slug: "", max_bytes: "" }
        : mode === "keys"
        ? { name: "", bucket_id: buckets[0]?.id || "", permissions: ["file:read"] }
        : mode === "domains"
        ? { domain: "", bucket_id: "" }
        : {}
    );
    setOpen(true);
  };

  const submit = async () => {
    try {
      if (mode === "buckets") await api("/api/v1/buckets", { method: "POST", body: JSON.stringify({ ...form, max_bytes: form.max_bytes ? Number(form.max_bytes) : null }) });
      if (mode === "keys") {
        const result = await api("/api/v1/api-keys", { method: "POST", body: JSON.stringify(form) });
        setCreatedCredentials({ rawKey: result.raw_key, accessKeyId: result.s3_access_key_id, secretAccessKey: result.s3_secret_access_key });
      }
      if (mode === "domains") await api("/api/v1/domains", { method: "POST", body: JSON.stringify(form) });
      setOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim() || !selectedBucket) return;
    try {
      await api("/api/v1/folders", {
        method: "POST",
        body: JSON.stringify({ bucket_id: selectedBucket, parent_id: currentFolderId, name: newFolderName.trim() }),
      });
      setNewFolderName("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Folder creation failed");
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedBucket) return;
    const data = new FormData();
    data.append("file", file);
    data.append("bucket_id", selectedBucket);
    if (currentFolderId) data.append("folder_id", currentFolderId);
    try {
      await api("/api/v1/objects", { method: "POST", body: data });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    }
    event.target.value = "";
  };

  const confirmRemove = async () => {
    if (!pendingDelete) return;
    try {
      const path =
        pendingDelete.kind === "bucket"
          ? `/api/v1/buckets/${pendingDelete.item.id}`
          : pendingDelete.kind === "key"
          ? `/api/v1/api-keys/${pendingDelete.item.id}`
          : pendingDelete.kind === "domain"
          ? `/api/v1/domains/${pendingDelete.item.id}`
          : pendingDelete.kind === "folder"
          ? `/api/v1/folders/${pendingDelete.item.id}?bucket_id=${selectedBucket}`
          : `/api/v1/objects/${pendingDelete.item.id}?bucket_id=${selectedBucket}`;
      await api(path, { method: "DELETE" });
      setPendingDelete(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  };

  return (
    <div className="liquid-universe">
      <div className="ambient-blob blob-one" />
      <div className="ambient-blob blob-two" />
      <div className="ambient-blob blob-three" />
      <div className="glass-container-full">
        <main className="storage-admin-page">
          <header className="storage-admin-head">
            <div>
              <span className="eyebrow">ALLDRIVE STORAGE</span>
              <h1>{title}</h1>
              <p>Kelola storage object secara aman dan terisolasi per bucket.</p>
            </div>
            <div className="storage-admin-actions">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." />
              {mode === "storage" && (
                <select
                  value={selectedBucket}
                  onChange={(event) => {
                    setSelectedBucket(event.target.value);
                    setFolderPath([{ id: null, name: "Root" }]);
                  }}
                >
                  <option value="">Select bucket</option>
                  {buckets.map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {bucket.name}
                    </option>
                  ))}
                </select>
              )}
              {mode !== "storage" && <button className="btn accent" onClick={create}>+ Create</button>}
            </div>
          </header>

          <nav className="storage-admin-nav">
            <a className={mode === "buckets" ? "active" : ""} href="/dashboard/buckets">Buckets</a>
            <a className={mode === "keys" ? "active" : ""} href="/dashboard/api-keys">API Keys</a>
            <a className={mode === "storage" ? "active" : ""} href="/dashboard/storage">Storage</a>
            <a className={mode === "domains" ? "active" : ""} href="/dashboard/domains">Domains</a>
            <a href="/dashboard/docs">Docs</a>
          </nav>

          {mode === "storage" && selectedBucket && (
            <div className="storage-browser-tools">
              <div className="storage-breadcrumb">
                {folderPath.map((item, index) => (
                  <span key={`${item.id || "root"}-${index}`}>
                    <button onClick={() => setFolderPath(folderPath.slice(0, index + 1))}>{item.name}</button>
                    {index < folderPath.length - 1 && <b>/</b>}
                  </span>
                ))}
              </div>
              <div className="storage-browser-actions">
                <label className="btn ghost upload-label">
                  Upload
                  <input type="file" hidden onChange={upload} />
                </label>
                <input
                  className="folder-name-input"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void createFolder(); }}
                  placeholder="New folder name"
                />
                <button className="btn accent" onClick={() => void createFolder()}>Create folder</button>
              </div>
            </div>
          )}

          {createdCredentials && (
            <div className="glass-backdrop" onClick={() => setCreatedCredentials(null)}>
              <section className="glass-modal small-modal credential-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head"><div><h2>API Key Created</h2><p>Simpan secret ini sekarang. Secret tidak bisa ditampilkan ulang.</p></div><button className="modal-close" onClick={() => setCreatedCredentials(null)}>X</button></div>
                {[{ label: "Access Key ID", value: createdCredentials.accessKeyId }, { label: "Secret Access Key", value: createdCredentials.secretAccessKey }, { label: "Raw API Key", value: createdCredentials.rawKey }].map((field) => (
                  <label key={field.label} className="credential-field">{field.label}<div><input className="glass-input" readOnly value={field.value} /><button className="btn ghost" onClick={() => void navigator.clipboard.writeText(field.value)}>Copy</button></div></label>
                ))}
                <div className="modal-footer"><button className="btn accent" onClick={() => setCreatedCredentials(null)}>Done</button></div>
              </section>
            </div>
          )}
          {error && (
            <div className="storage-error">
              {error}
              <button onClick={() => void load()}>Retry</button>
            </div>
          )}

          {loading ? (
            <div className="storage-loading">Loading...</div>
          ) : mode === "storage" ? (
            <div className="storage-table-wrap">
              <table className="storage-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {folders.map((folder) => (
                    <tr key={folder.id} className="storage-folder-row" onDoubleClick={() => setFolderPath([...folderPath, { id: folder.id, name: folder.name }])}>
                      <td>
                        <button className="storage-name-action" onClick={() => setFolderPath([...folderPath, { id: folder.id, name: folder.name }])}>
                          <span className="material-symbols-rounded">folder</span>{folder.name}
                        </button>
                      </td>
                      <td>Folder</td>
                      <td>-</td>
                      <td>Ready</td>
                      <td className="storage-row-actions">
                        <button onClick={() => setPendingDelete({ kind: "folder", item: folder })}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <a className="storage-name-action file" href={`/api/v1/objects/${row.id}/download?bucket_id=${selectedBucket}`} target="_blank">
                          <span className="material-symbols-rounded">draft</span>{row.name}
                        </a>
                      </td>
                      <td>{row.mimeType || "file"}</td>
                      <td>{bytes(row.fileSize)}</td>
                      <td>{row.status}</td>
                      <td className="storage-row-actions">
                        <button onClick={() => setPendingDelete({ kind: "object", item: row })}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!folders.length && !filtered.length && <div className="storage-empty">Folder ini kosong.</div>}
            </div>
          ) : (
            <div className="storage-table-wrap">
              <table className="storage-table">
                <thead>
                  <tr>
                    {mode === "buckets" ? (
                      <>
                        <th>Name</th>
                        <th>Slug</th>
                        <th>Usage</th>
                        <th>Status</th>
                        <th />
                      </>
                    ) : mode === "keys" ? (
                      <>
                        <th>Name</th>
                        <th>Bucket</th>
                        <th>Prefix</th>
                        <th>Status</th>
                        <th />
                      </>
                    ) : (
                      <>
                        <th>Domain</th>
                        <th>Bucket</th>
                        <th>Status</th>
                        <th />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      {mode === "buckets" && (
                        <>
                          <td>{row.name}</td>
                          <td>{row.slug}</td>
                          <td>{bytes(row.used_bytes)} / {row.max_bytes ? bytes(row.max_bytes) : "unlimited"}</td>
                          <td>{row.is_active ? "Active" : "Inactive"}</td>
                          <td><button onClick={() => setPendingDelete({ kind: "bucket", item: row })}>Delete</button></td>
                        </>
                      )}
                      {mode === "keys" && (
                        <>
                          <td>{row.name}</td>
                          <td>{row.bucket_name || "-"}</td>
                          <td>{row.key_prefix}</td>
                          <td>{row.status}</td>
                          <td>{row.status === "ACTIVE" && <button onClick={() => setPendingDelete({ kind: "key", item: row })}>Revoke</button>}</td>
                        </>
                      )}
                      {mode === "domains" && (
                        <>
                          <td>{row.domain}</td>
                          <td>{row.bucket?.name || "-"}</td>
                          <td>{row.isVerified ? "Verified" : "Unverified"}</td>
                          <td><button onClick={() => setPendingDelete({ kind: "domain", item: row })}>Delete</button></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && <div className="storage-empty">No records found.</div>}
            </div>
          )}

          {open && (
            <div className="glass-backdrop" onClick={() => setOpen(false)}>
              <section className="glass-modal storage-form-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <h2>Create {title.slice(0, -1)}</h2>
                    <p>Isi data dengan valid sebelum disimpan.</p>
                  </div>
                  <button className="modal-close" onClick={() => setOpen(false)}>X</button>
                </div>
                {mode === "buckets" && (
                  <>
                    <label>Name<input className="glass-input" value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                    <label>Slug<input className="glass-input" value={form.slug || ""} onChange={(event) => setForm({ ...form, slug: event.target.value })} /></label>
                    <label>Max bytes<input className="glass-input" type="number" value={form.max_bytes || ""} onChange={(event) => setForm({ ...form, max_bytes: event.target.value })} /></label>
                  </>
                )}
                {mode === "keys" && (
                  <>
                    <label>Name<input className="glass-input" value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                    <label>
                      Bucket
                      <select className="glass-input" value={form.bucket_id || ""} onChange={(event) => setForm({ ...form, bucket_id: event.target.value })}>
                        {buckets.map((bucket) => (
                          <option key={bucket.id} value={bucket.id}>
                            {bucket.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset>
                      <legend>Permissions</legend>
                      {permissions.map((permission) => (
                        <label key={permission} className="permission-check">
                          <input
                            type="checkbox"
                            checked={(form.permissions || []).includes(permission)}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                permissions: event.target.checked
                                ? [...form.permissions, permission]
                                : form.permissions.filter((item: string) => item !== permission),
                              })
                            }
                          />
                          {permission}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
                {mode === "domains" && (
                  <>
                    <label>Domain<input className="glass-input" value={form.domain || ""} onChange={(event) => setForm({ ...form, domain: event.target.value })} /></label>
                    <label>
                      Bucket
                      <select className="glass-input" value={form.bucket_id || ""} onChange={(event) => setForm({ ...form, bucket_id: event.target.value })}>
                        <option value="">No bucket</option>
                        {buckets.map((bucket) => (
                          <option key={bucket.id} value={bucket.id}>
                            {bucket.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <div className="modal-footer">
                  <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
                  <button className="btn accent" onClick={() => void submit()}>Save</button>
                </div>
              </section>
            </div>
          )}

          {pendingDelete && (
            <div className="glass-backdrop" onClick={() => setPendingDelete(null)}>
              <section className="glass-modal small-modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <h2>Confirm Action</h2>
                    <p>Tindakan ini tidak bisa dibatalkan secara otomatis.</p>
                  </div>
                  <button className="modal-close" onClick={() => setPendingDelete(null)}>X</button>
                </div>
                <div className="modal-footer">
                  <button className="btn ghost" onClick={() => setPendingDelete(null)}>Cancel</button>
                  <button className="btn danger" onClick={() => void confirmRemove()}>Confirm</button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
