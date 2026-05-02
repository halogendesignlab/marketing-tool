"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getPendingApprovals, approveContent, rejectContent } from "@/lib/api";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";

interface ContentItem {
  id: number;
  content_type: string;
  platform: string | null;
  status: string;
  title: string | null;
  body: string;
  scheduled_for: string | null;
  created_at: string;
}

export default function ApprovalsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getPendingApprovals()
      .then(setItems)
      .finally(() => setFetching(false));
  }, [user]);

  const handleApprove = async (item: ContentItem) => {
    try {
      await approveContent(item.id, editingId === item.id ? editBody : undefined);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setEditingId(null);
      toast.success("Approved");
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async (id: number) => {
    try {
      await rejectContent(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Rejected");
    } catch {
      toast.error("Failed to reject");
    }
  };

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Pending Approvals</h1>
          <span className="text-sm text-gray-500">{items.length} item{items.length !== 1 ? "s" : ""}</span>
        </div>

        {fetching && <p className="text-gray-400 text-sm">Loading...</p>}

        {!fetching && items.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm">Nothing pending approval.</p>
          </div>
        )}

        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                    {item.content_type.replace("_", " ")}
                  </span>
                  {item.platform && (
                    <span className="text-xs text-gray-400 capitalize">{item.platform}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </span>
              </div>

              {item.title && (
                <h3 className="font-medium text-gray-900 mb-2">{item.title}</h3>
              )}

              {editingId === item.id ? (
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 min-h-[120px]"
                />
              ) : (
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {item.body}
                </p>
              )}

              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => handleApprove(item)}
                  className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Approve
                </button>

                {editingId === item.id ? (
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel edit
                  </button>
                ) : (
                  <button
                    onClick={() => { setEditingId(item.id); setEditBody(item.body); }}
                    className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                )}

                <button
                  onClick={() => handleReject(item.id)}
                  className="px-4 py-1.5 text-red-500 text-sm hover:text-red-700 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
