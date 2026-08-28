"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GlassFileExplorer } from "@/components/google-drive/GlassFileExplorer";
import { StorageManagementModal } from "@/components/google-drive/StorageManagementModal";
import type { DriveAccount } from "@/components/google-drive/GoogleDriveAccounts";
import type { DriveFileItem } from "@/components/google-drive/GoogleDriveFileList";

function DashboardContent() {
  const searchParams = useSearchParams();
  const driveConnected = searchParams.get("drive_connected");
  const driveError = searchParams.get("drive_error");
  const [accounts, setAccounts] = useState<DriveAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState("root");
  const [folderHistory, setFolderHistory] = useState([{ id: "root", name: "Root" }]);
  const [currentView, setCurrentView] = useState("all");
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [storageModalOpen, setStorageModalOpen] = useState(false);

  async function loadAccounts() {
    const res = await fetch("/api/google-drive/accounts");
    const data = await res.json();
    if (data?.success && Array.isArray(data.data.accounts)) {
      setAccounts(data.data.accounts);
      if (data.data.accounts.length && !selectedAccountId) setSelectedAccountId(data.data.accounts[0].id);
    }
  }

  async function loadFiles(accountId: string, folderId = currentFolderId, view = "all") {
    if (!accountId) return setFiles([]);
    setLoadingFiles(true);
    try {
      const params = new URLSearchParams({ accountId, folderId, view });
      const res = await fetch(`/api/google-drive/files?${params}`);
      const data = await res.json();
      setFiles(data?.success && Array.isArray(data.data.files) ? data.data.files : []);
    } finally {
      setLoadingFiles(false);
    }
  }

  useEffect(() => { void loadAccounts(); }, []);
  useEffect(() => {
    setCurrentFolderId("root");
    setFolderHistory([{ id: "root", name: "Root" }]);
    setCurrentView("all");
    if (selectedAccountId) void loadFiles(selectedAccountId, "root", "all");
  }, [selectedAccountId]);

  function navigateToFolder(folder: { id: string; name: string }) {
    setCurrentFolderId(folder.id);
    setCurrentView("all");
    setFolderHistory((items) => {
      const index = items.findIndex((item) => item.id === folder.id);
      return index >= 0 ? items.slice(0, index + 1) : [...items, folder];
    });
    void loadFiles(selectedAccountId, folder.id, "all");
  }

  function changeTab(tab: string) {
    setCurrentView(tab);
    setCurrentFolderId("root");
    setFolderHistory([{ id: "root", name: "Root" }]);
    void loadFiles(selectedAccountId, "root", tab);
  }

  return (
    <div className="liquid-universe">
      <div className="ambient-blob blob-one" />
      <div className="ambient-blob blob-two" />
      <div className="ambient-blob blob-three" />
      <div className="glass-container-full">
        {driveConnected && <div className="glass-toast success">Google Drive account connected successfully.</div>}
        {driveError && <div className="glass-toast error">Failed to connect Google Drive: {driveError}</div>}
        <GlassFileExplorer
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          files={files}
          loading={loadingFiles}
          currentFolderId={currentFolderId}
          folderHistory={folderHistory}
          onNavigateFolder={navigateToFolder}
          onSelectAccount={setSelectedAccountId}
          onTabChange={changeTab}
          onRefresh={() => void loadFiles(selectedAccountId, currentFolderId, currentView)}
          onManageStorage={() => setStorageModalOpen(true)}
        />
        {storageModalOpen && (
          <StorageManagementModal
            accounts={accounts}
            selectedAccountId={selectedAccountId}
            onClose={() => setStorageModalOpen(false)}
            onRefresh={() => void loadAccounts()}
          />
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="main"><p className="muted">Loading dashboard...</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}
