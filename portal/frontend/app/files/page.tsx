"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";
import { useRequireClient } from "@/lib/use-require-client";
import Nav from "@/components/Nav";
import { getFiles, uploadFile, deleteFile, getFileDownloadUrl } from "@/lib/api";
import toast from "react-hot-toast";
import Cookies from "js-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ClientFile {
  id: number;
  client_id: number;
  filename: string;
  mime_type: string;
  size: number;
  description: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── File type icon ────────────────────────────────────────────────────────────

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === "application/pdf") {
    return (
      <svg className="w-5 h-5 text-signal-bad shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    );
  }
  if (mimeType.startsWith("image/")) {
    return (
      <svg className="w-5 h-5 text-spark shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-fg-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  isAdmin,
  onDelete,
}: {
  file: ClientFile;
  isAdmin: boolean;
  onDelete: (id: number) => void;
}) {
  const token = Cookies.get("token") ?? "";
  const downloadUrl = `${API_BASE}/api/files/${file.id}/download`;

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-lg border border-ink-600 bg-ink-700 hover:border-ink-500 transition-colors duration-150 group">
      <FileIcon mimeType={file.mime_type} />

      <div className="flex-1 min-w-0">
        <p className="text-fg-1 text-sm truncate">{file.filename}</p>
        {file.description && (
          <p className="text-fg-3 font-sans text-xs mt-0.5 truncate">{file.description}</p>
        )}
      </div>

      <div className="flex items-center gap-6 shrink-0">
        <span className="text-fg-3 font-sans text-xs w-16 text-right">{formatBytes(file.size)}</span>
        <span className="text-fg-3 font-sans text-xs w-24 text-right hidden sm:block">{formatDate(file.created_at)}</span>

        <a
          href={downloadUrl}
          download={file.filename}
          onClick={(e) => {
            // Attach auth token via header isn't possible with <a>, so we fetch manually
            e.preventDefault();
            fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } })
              .then((r) => r.blob())
              .then((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = file.filename;
                a.click();
                URL.revokeObjectURL(url);
              })
              .catch(() => toast.error("Download failed"));
          }}
          className="flex items-center gap-1 text-xs text-tint hover:text-tint/80 font-sans transition-colors duration-150"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <span className="hidden sm:inline">download</span>
        </a>

        {isAdmin && (
          <button
            onClick={() => onDelete(file.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-fg-3 hover:text-signal-bad"
            title="Delete file"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FilesPage() {
  const { user, isAdmin } = useAuth();
  const { selectedClient } = useClient();
  const ready = useRequireClient();
  const selectedClientId = selectedClient?.id ?? null;

  const [files, setFiles] = useState<ClientFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [description, setDescription] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    if (!selectedClientId) return;
    setLoading(true);
    try {
      const data = await getFiles(selectedClientId);
      setFiles(data);
    } catch {
      toast.error("Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    if (!user || !selectedClientId) return;
    loadFiles();
  }, [user, selectedClientId, loadFiles]);

  const handleUpload = async () => {
    if (!selectedClientId || pendingFiles.length === 0) return;
    setUploading(true);
    let succeeded = 0;
    for (const file of pendingFiles) {
      try {
        await uploadFile(selectedClientId, file, description || undefined);
        succeeded++;
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    setPendingFiles([]);
    setDescription("");
    if (succeeded > 0) {
      toast.success(`Uploaded ${succeeded} file${succeeded > 1 ? "s" : ""}`);
      await loadFiles();
    }
  };

  const handleFileInput = (incoming: FileList | null) => {
    if (!incoming) return;
    setPendingFiles((prev) => [...prev, ...Array.from(incoming)]);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this file?")) return;
    try {
      await deleteFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
      toast.success("File deleted");
    } catch {
      toast.error("Failed to delete file");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (isAdmin) handleFileInput(e.dataTransfer.files);
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="font-sans font-semibold text-fg-1 text-xl">files</h1>
          <p className="text-fg-3 font-sans text-sm mt-1">
            {isAdmin ? "Upload and manage files for this client." : "Files shared with you by Halogen."}
          </p>
        </div>

        {/* ── Upload area (admin only) ── */}
        {isAdmin && (
          <div className="mb-6 space-y-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed cursor-pointer transition-colors duration-150 px-6 py-10 text-center ${
                dragOver
                  ? "border-tint bg-ink-700"
                  : "border-ink-600 hover:border-ink-500 bg-ink-800 hover:bg-ink-750"
              }`}
            >
              <svg className="w-8 h-8 text-fg-3 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-fg-2 font-sans text-sm">Drag and drop files here, or click to browse</p>
              <p className="text-fg-3 font-sans text-xs mt-1">Any file type accepted</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFileInput(e.target.files)}
            />

            {pendingFiles.length > 0 && (
              <div className="rounded-lg border border-ink-600 bg-ink-800 p-4 space-y-3">
                <div className="space-y-1">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-fg-2 text-sm truncate">{f.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-fg-3 font-sans text-xs">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="text-fg-3 hover:text-signal-bad transition-colors duration-150"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1 bg-ink-700 border border-ink-600 rounded-md px-3 py-1.5 text-sm text-fg-1 placeholder-fg-3 font-sans focus:outline-none focus:border-tint transition-colors duration-150"
                  />
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="btn-primary disabled:opacity-50 shrink-0"
                  >
                    {uploading ? "Uploading…" : `Upload ${pendingFiles.length} file${pendingFiles.length > 1 ? "s" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── File list ── */}
        {loading ? (
          <p className="text-fg-3 font-sans text-sm py-12 text-center">Loading…</p>
        ) : files.length === 0 ? (
          <div className="text-center py-16 text-fg-3">
            <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-sans">No files yet.</p>
            {isAdmin && <p className="text-xs font-sans mt-1">Upload files above to share them with this client.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-fg-3 font-sans text-xs">{files.length} file{files.length !== 1 ? "s" : ""}</span>
            </div>
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                isAdmin={!!isAdmin}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
