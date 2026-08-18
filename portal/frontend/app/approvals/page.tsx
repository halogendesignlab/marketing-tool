"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { useAuth } from "@/lib/auth-context";
import Nav from "@/components/Nav";
import { useClient } from "@/lib/client-context";
import { useRequireClient } from "@/lib/use-require-client";
import {
  getPendingApprovals, approveContent, rejectContent, deleteContent,
  sendToClient, recallFromClient, undoApproval, updateContent,
} from "@/lib/api";
import { ContentItem, GenerateWizard } from "./shared";
import AdminBoard from "./AdminBoard";
import ClientFeed from "./ClientFeed";
import PublishedArchive from "./PublishedArchive";

export default function ApprovalsPage() {
  const { isAdmin } = useAuth();
  const { selectedClient } = useClient();
  const ready = useRequireClient();
  const selectedClientId = selectedClient?.id ?? null;

  const [items, setItems] = useState<ContentItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [tab, setTab] = useState<"active" | "published">("active");

  const loadDrafts = useCallback(() => {
    setFetching(true);
    getPendingApprovals(selectedClientId ?? undefined)
      .then(setItems)
      .finally(() => setFetching(false));
  }, [selectedClientId]);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  /** Batch drafts are written after the request returns, so poll them in.
   *  Refreshes quietly — no spinner — until the run has had time to finish. */
  const pollForBatch = useCallback(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      getPendingApprovals(selectedClientId ?? undefined)
        .then(setItems)
        .catch(() => {});
      if (Date.now() - started > 5 * 60 * 1000) clearInterval(timer);
    }, 8000);
  }, [selectedClientId]);

  const patch = (id: number, changes: Partial<ContentItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const drop = (id: number) => setItems((prev) => prev.filter((i) => i.id !== id));

  /** Confirmation that also offers a way back, since approval is otherwise silent. */
  const confirmWithUndo = (id: number, message: string) =>
    toast.success((t) => (
      <span className="flex items-center gap-3">
        {message}
        <button
          onClick={() => { toast.dismiss(t.id); handleUndo(id); }}
          className="font-semibold text-tint hover:text-tint-hot"
        >
          Undo
        </button>
      </span>
    ), { duration: 8000 });

  const handleApprove = async (id: number, body?: string, imageUrl?: string) => {
    try {
      const updated = await approveContent(id, body, imageUrl);
      patch(id, updated);
      confirmWithUndo(id, isAdmin ? "Approved — queued for publishing" : "Approved");
    } catch { toast.error("Failed to approve"); throw new Error("approve failed"); }
  };

  const handleSchedule = async (id: number, scheduledFor: string) => {
    try {
      const updated = await approveContent(id, undefined, undefined, scheduledFor);
      patch(id, updated);
      confirmWithUndo(id, "Scheduled");
    } catch { toast.error("Failed to schedule"); throw new Error("schedule failed"); }
  };

  const handleUndo = async (id: number) => {
    try {
      const updated = await undoApproval(id);
      patch(id, updated);
      toast.success("Back in your review queue");
    } catch { toast.error("Too late to undo — this has already published"); }
  };

  const handleEdit = async (
    id: number,
    payload: { title?: string; body?: string; image_url?: string },
  ) => {
    const updated = await updateContent(id, payload);
    patch(id, updated);
    toast.success("Changes saved");
  };

  const handleReject = async (id: number, reason?: string) => {
    try {
      const updated = await rejectContent(id, reason);
      // Rejection hands the item back to us, so it leaves the client's feed.
      if (isAdmin) patch(id, updated); else { drop(id); toast.success("Changes requested"); }
    } catch { toast.error("Failed"); throw new Error("reject failed"); }
  };

  const handleSendToClient = async (id: number) => {
    try {
      const updated = await sendToClient(id);
      patch(id, updated);
    } catch { toast.error("Failed to send to client"); }
  };

  const handleRecall = async (id: number) => {
    try {
      const updated = await recallFromClient(id);
      patch(id, updated);
    } catch { toast.error("Failed to recall"); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteContent(id); drop(id); }
    catch { toast.error("Failed to delete"); }
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-ink-900">
      <Nav />
      {/* Width is per-role, not per-tab, so switching tabs doesn't reflow the page. */}
      <main className={`mx-auto px-6 py-8 ${isAdmin ? "max-w-6xl" : "max-w-3xl"}`}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="font-display font-semibold text-fg-1 text-2xl">
              {isAdmin ? "Drafts" : "Your content"}
            </h1>
            <p className="text-sm text-fg-3 mt-0.5">
              {!isAdmin
                ? "Review what we've written for you this month."
                : tab === "published"
                ? "Everything that has gone live, however it got there."
                : "Review this month's content, then hand it to the client."}
            </p>
          </div>
          {isAdmin && tab === "active" && (
            <button onClick={() => setShowWizard(true)} className="btn-primary flex items-center gap-2 shrink-0">
              <span className="text-base leading-none">+</span> Generate post
            </button>
          )}
        </div>

        {isAdmin && (
          <div className="flex gap-1 mb-6 border-b border-ink-600">
            {([
              { key: "active", label: "Board" },
              { key: "published", label: "Published" },
            ] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-150 ${
                  tab === t.key ? "border-tint text-fg-1" : "border-transparent text-fg-3 hover:text-fg-2"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {!isAdmin ? (
          <ClientFeed
            items={items}
            clientId={selectedClientId}
            fetching={fetching}
            handlers={{
              onApprove: handleApprove,
              onSchedule: handleSchedule,
              onReject: handleReject,
              onUndo: handleUndo,
              onEdit: handleEdit,
            }}
          />
        ) : tab === "published" ? (
          <PublishedArchive clientId={selectedClientId} />
        ) : (
          <AdminBoard
            items={items}
            clientId={selectedClientId}
            fetching={fetching}
            handlers={{
              onApprove: handleApprove,
              onDelete: handleDelete,
              onSendToClient: handleSendToClient,
              onRecall: handleRecall,
              onItemChange: patch,
            }}
          />
        )}
      </main>

      {showWizard && (
        <GenerateWizard
          onClose={() => setShowWizard(false)}
          onCreated={(item) => setItems((prev) => [item, ...prev])}
          onBatchQueued={pollForBatch}
          selectedClientId={selectedClientId}
        />
      )}
    </div>
  );
}
