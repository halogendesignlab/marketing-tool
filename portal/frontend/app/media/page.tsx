"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useClient } from "@/lib/client-context";
import { useRequireClient } from "@/lib/use-require-client";
import Nav from "@/components/Nav";
import {
  getMediaFolders,
  createMediaFolder,
  deleteMediaFolder,
  getMediaItems,
  getMediaItemCount,
  getUnorganizedMedia,
  getMediaFilters,
  uploadMediaToLibrary,
  deleteMediaItem,
  moveMediaItem,
  type MediaFilters,
} from "@/lib/api";
import toast from "react-hot-toast";
import Cookies from "js-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface MediaFolder {
  id: number;
  name: string;
  parent_id: number | null;
  children: MediaFolder[];
  item_count: number;
}

interface MediaItemMeta {
  category?: string;
  project?: string;
  photo_type?: string;
  folder_path?: string;
}

interface MediaItem {
  id: number;
  filename: string;
  url: string;
  mime_type: string;
  size: number;
  folder_id: number | null;
  last_used_at: string | null;
  created_at: string;
  meta?: MediaItemMeta | null;
}

// ── Folder tree node ──────────────────────────────────────────────────────────

function FolderNode({
  folder,
  selectedId,
  onSelect,
  onDelete,
  depth = 0,
}: {
  folder: MediaFolder;
  selectedId: number | null | "all" | "unorganized";
  onSelect: (id: number) => void;
  onDelete: (id: number, name: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isSelected = selectedId === folder.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer group text-sm font-sans transition-colors duration-150 ${isSelected ? "bg-tint text-ink-900" : "text-fg-2 hover:bg-ink-600"}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(folder.id)}
      >
        {folder.children.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            className="w-4 h-4 flex items-center justify-center shrink-0 opacity-60"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
        {folder.children.length === 0 && <span className="w-4" />}
        <span className="truncate flex-1">{folder.name}</span>
        <span className={`text-xs shrink-0 ${isSelected ? "text-ink-900/70" : "text-fg-3"}`}>
          {folder.item_count}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(folder.id, folder.name); }}
          className={`opacity-0 group-hover:opacity-100 ml-1 shrink-0 transition-opacity duration-150 ${isSelected ? "text-ink-900/60 hover:text-ink-900" : "text-fg-3 hover:text-signal-bad"}`}
          title="Delete folder"
        >
          ✕
        </button>
      </div>
      {open && folder.children.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MediaPage() {
  const { user } = useAuth();
  const { selectedClient } = useClient();
  const ready = useRequireClient();
  const selectedClientId = selectedClient?.id ?? null;

  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<number | null | "all" | "unorganized">("all");
  const [fetching, setFetching] = useState(true);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 48;
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterPhotoType, setFilterPhotoType] = useState("");
  const [availableFilters, setAvailableFilters] = useState<{ categories: string[]; projects: string[]; photo_types: string[] }>({ categories: [], projects: [], photo_types: [] });
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset folder/page when client switches
  useEffect(() => {
    setSelectedFolder("all");
    setPage(0);
  }, [selectedClientId]);

  const loadFolders = useCallback(async () => {
    const data = await getMediaFolders(selectedClientId ?? undefined);
    setFolders(data);
  }, [selectedClientId]);

  const loadItems = useCallback(async () => {
    setFetching(true);
    try {
      const offset = page * PAGE_SIZE;
      const cid = selectedClientId ?? undefined;
      const f: MediaFilters = {
        search: search || undefined,
        category: filterCategory || undefined,
        project: filterProject || undefined,
        photo_type: filterPhotoType || undefined,
      };
      let data: MediaItem[];
      let count: number;
      if (selectedFolder === "all") {
        [data, count] = await Promise.all([
          getMediaItems(undefined, cid, PAGE_SIZE, offset, f),
          getMediaItemCount(undefined, cid, f),
        ]);
      } else if (selectedFolder === "unorganized") {
        [data, count] = await Promise.all([
          getUnorganizedMedia(cid, PAGE_SIZE, offset, f),
          getMediaItemCount(undefined, cid, f),
        ]);
      } else {
        [data, count] = await Promise.all([
          getMediaItems(selectedFolder, cid, PAGE_SIZE, offset, f),
          getMediaItemCount(selectedFolder, cid, f),
        ]);
      }
      setItems(data);
      setTotalItems(count);
    } finally {
      setFetching(false);
    }
  }, [selectedFolder, selectedClientId, page, search, filterCategory, filterProject, filterPhotoType]);

  // Load filter options whenever client changes
  useEffect(() => {
    if (!user) return;
    getMediaFilters(selectedClientId ?? undefined).then(setAvailableFilters);
  }, [user, selectedClientId]);

  // Reset page to 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [search, filterCategory, filterProject, filterPhotoType, selectedFolder]);

  useEffect(() => {
    if (!user) return;
    loadFolders();
  }, [user, selectedClientId, loadFolders]);

  useEffect(() => {
    if (!user) return;
    loadItems();
  }, [user, selectedFolder, selectedClientId, loadItems]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let succeeded = 0;
    for (const file of Array.from(files)) {
      try {
        const folderId = typeof selectedFolder === "number" ? selectedFolder : null;
        await uploadMediaToLibrary(file, folderId, selectedClientId ?? undefined);
        succeeded++;
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    if (succeeded > 0) {
      toast.success(`Uploaded ${succeeded} file${succeeded > 1 ? "s" : ""}`);
      await loadItems();
      await loadFolders();
    }
  };

  const handleDelete = async (item: MediaItem) => {
    try {
      await deleteMediaItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      await loadFolders();
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleDeleteFolder = async (id: number, name: string) => {
    if (!confirm(`Delete folder "${name}"? Items inside will be moved to root.`)) return;
    try {
      await deleteMediaFolder(id);
      if (selectedFolder === id) setSelectedFolder("all");
      await loadFolders();
      await loadItems();
      toast.success("Folder deleted");
    } catch {
      toast.error("Failed to delete folder");
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      const parentId = typeof selectedFolder === "number" ? selectedFolder : undefined;
      await createMediaFolder(newFolderName.trim(), parentId);
      setNewFolderName("");
      setShowNewFolder(false);
      await loadFolders();
      toast.success("Folder created");
    } catch {
      toast.error("Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleMoveToFolder = async (item: MediaItem, folderId: number | null) => {
    try {
      await moveMediaItem(item.id, folderId);
      await loadItems();
      await loadFolders();
    } catch {
      toast.error("Failed to move item");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  if (!ready) return null;

  const folderLabel =
    selectedFolder === "all"
      ? "All media"
      : selectedFolder === "unorganized"
      ? "Unorganized"
      : flattenFolders(folders).find((f) => f.id === selectedFolder)?.name ?? "Folder";

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <div className="flex" style={{ height: "calc(100vh - 53px)" }}>
        {/* ── Sidebar ── */}
        <aside className="w-56 bg-ink-800 border-r border-ink-600 flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 border-b border-ink-600">
            <button
              onClick={() => setShowNewFolder(true)}
              className="w-full text-left text-xs text-fg-3 hover:text-fg-1 font-sans px-2 py-1 rounded-md hover:bg-ink-600 transition-colors duration-150"
            >
              + New folder
            </button>
            {showNewFolder && (
              <div className="mt-2 flex gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                  }}
                  placeholder="Folder name"
                  className="flex-1 bg-ink-700 border border-ink-600 rounded-md px-2 py-1 text-xs text-fg-1 placeholder-fg-3 focus:outline-none focus:border-tint transition-colors duration-150"
                />
                <button
                  onClick={handleCreateFolder}
                  disabled={creatingFolder}
                  className="text-xs bg-tint text-ink-900 font-sans font-semibold px-2 py-1 rounded-md disabled:opacity-50"
                >
                  OK
                </button>
              </div>
            )}
          </div>

          <nav className="flex-1 p-2 space-y-0.5">
            <button
              onClick={() => setSelectedFolder("all")}
              className={`w-full text-left px-2 py-1 rounded-md font-sans text-sm transition-colors duration-150 ${selectedFolder === "all" ? "bg-tint text-ink-900" : "text-fg-2 hover:bg-ink-600"}`}
            >
              All media
            </button>
            <button
              onClick={() => setSelectedFolder("unorganized")}
              className={`w-full text-left px-2 py-1 rounded-md font-sans text-sm transition-colors duration-150 ${selectedFolder === "unorganized" ? "bg-tint text-ink-900" : "text-fg-2 hover:bg-ink-600"}`}
            >
              Unorganized
            </button>

            {folders.length > 0 && (
              <div className="pt-1 mt-1 border-t border-ink-600">
                {folders.map((folder) => (
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    selectedId={selectedFolder}
                    onSelect={(id) => setSelectedFolder(id)}
                    onDelete={handleDeleteFolder}
                  />
                ))}
              </div>
            )}
          </nav>
        </aside>

        {/* ── Main area ── */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h1 className="font-sans font-semibold text-fg-1 text-lg">{folderLabel}</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-fg-3 font-sans">{items.length} item{items.length !== 1 ? "s" : ""}</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn-primary disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              type="search"
              placeholder="Search by name or project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-ink-700 border border-ink-600 rounded-md px-3 py-1.5 text-sm text-fg-1 placeholder-fg-3 focus:outline-none focus:border-tint transition-colors duration-150 w-56 font-mono"
            />
            {availableFilters.categories.length > 0 && (
              <select
                value={filterCategory}
                onChange={(e) => { setFilterCategory(e.target.value); setFilterProject(""); }}
                className="bg-ink-700 border border-ink-600 rounded-md px-2 py-1.5 text-sm text-fg-2 font-sans focus:outline-none focus:border-tint transition-colors duration-150"
              >
                <option value="">All categories</option>
                {availableFilters.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {availableFilters.projects.length > 0 && (
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="bg-ink-700 border border-ink-600 rounded-md px-2 py-1.5 text-sm text-fg-2 font-sans focus:outline-none focus:border-tint transition-colors duration-150 max-w-[220px]"
              >
                <option value="">All projects</option>
                {availableFilters.projects
                  .filter((p) => !filterCategory || availableFilters.projects.includes(p))
                  .map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
              </select>
            )}
            {availableFilters.photo_types.length > 0 && (
              <select
                value={filterPhotoType}
                onChange={(e) => setFilterPhotoType(e.target.value)}
                className="bg-ink-700 border border-ink-600 rounded-md px-2 py-1.5 text-sm text-fg-2 font-sans focus:outline-none focus:border-tint transition-colors duration-150"
              >
                <option value="">All types</option>
                {availableFilters.photo_types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            {(search || filterCategory || filterProject || filterPhotoType) && (
              <button
                onClick={() => { setSearch(""); setFilterCategory(""); setFilterProject(""); setFilterPhotoType(""); }}
                className="text-xs text-fg-3 hover:text-fg-1 font-sans px-2 py-1.5 rounded-md hover:bg-ink-600 transition-colors duration-150"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Pagination */}
          {totalItems > PAGE_SIZE && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-fg-3 font-sans">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalItems)} of {totalItems}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost py-1 px-3 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= totalItems}
                  className="btn-ghost py-1 px-3 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed transition-colors duration-150 mb-4 ${dragOver ? "border-tint bg-ink-700" : "border-transparent"}`}
          >
            {fetching && (
              <p className="text-fg-3 font-sans text-sm text-center py-8">Loading…</p>
            )}

            {!fetching && items.length === 0 && (
              <div className="text-center py-16 text-fg-3">
                <p className="text-sm font-sans">No images yet.</p>
                <p className="text-xs font-sans mt-1">Drag and drop files here or click Upload.</p>
              </div>
            )}

            {!fetching && items.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    folders={flattenFolders(folders)}
                    onMove={handleMoveToFolder}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Media card ────────────────────────────────────────────────────────────────

function MediaCard({
  item,
  folders,
  onMove,
}: {
  item: MediaItem;
  folders: MediaFolder[];
  onMove: (item: MediaItem, folderId: number | null) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const token = Cookies.get("token") ?? "";
  const src = item.url.startsWith("drive://")
    ? `${API_BASE}/api/media/drive-preview/${item.url.replace("drive://", "")}?token=${token}`
    : item.url.startsWith("http")
    ? item.url
    : `${API_BASE}${item.url}`;

  return (
    <div className="relative group rounded-md overflow-hidden border border-ink-600 bg-ink-700 aspect-square">
      <img
        src={src}
        alt={item.filename}
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
      />
      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors duration-150 flex flex-col justify-between p-2 opacity-0 group-hover:opacity-100">
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="bg-ink-800 border border-ink-600 rounded-md w-6 h-6 flex items-center justify-center text-fg-2 hover:text-fg-1 text-xs transition-colors duration-150"
            title="Move to folder"
          >
            ⋯
          </button>
        </div>
        <div className="space-y-1">
          {item.meta?.project && (
            <p className="text-white text-xs font-sans font-medium drop-shadow leading-tight">{item.meta.project}</p>
          )}
          {(item.meta?.category || item.meta?.photo_type) && (
            <div className="flex flex-wrap gap-1">
              {item.meta.category && (
                <span className="bg-white/20 text-white text-[10px] font-sans px-1.5 py-0.5 rounded leading-tight">
                  {item.meta.category}
                </span>
              )}
              {item.meta.photo_type && (
                <span className="bg-white/20 text-white text-[10px] font-sans px-1.5 py-0.5 rounded leading-tight">
                  {item.meta.photo_type}
                </span>
              )}
            </div>
          )}
          <p className="text-white/70 text-[10px] font-mono truncate drop-shadow">{item.filename}</p>
        </div>
      </div>

      {/* Move menu */}
      {showMenu && (
        <div className="absolute top-8 right-2 bg-ink-800 border border-ink-600 rounded-md shadow-lg z-10 py-1 min-w-[140px]">
          <p className="text-xs text-fg-3 font-sans px-3 py-1">Move to…</p>
          <button
            onClick={() => { onMove(item, null); setShowMenu(false); }}
            className="w-full text-left font-sans text-sm px-3 py-1 hover:bg-ink-600 text-fg-2 hover:text-fg-1 transition-colors duration-150"
          >
            Root (unorganized)
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => { onMove(item, f.id); setShowMenu(false); }}
              className="w-full text-left font-sans text-sm px-3 py-1 hover:bg-ink-600 text-fg-2 hover:text-fg-1 transition-colors duration-150 truncate"
            >
              {f.name}
            </button>
          ))}
          <button
            onClick={() => setShowMenu(false)}
            className="w-full text-left text-xs font-sans px-3 py-1 text-fg-3 hover:bg-ink-600 transition-colors duration-150"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flattenFolders(folders: MediaFolder[]): MediaFolder[] {
  const result: MediaFolder[] = [];
  function walk(nodes: MediaFolder[]) {
    for (const n of nodes) {
      result.push(n);
      walk(n.children);
    }
  }
  walk(folders);
  return result;
}
