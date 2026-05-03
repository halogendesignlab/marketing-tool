"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getPendingApprovals, approveContent, rejectContent, uploadMedia } from "@/lib/api";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";

interface ContentItem {
  id: number;
  content_type: string;
  platform: string | null;
  status: string;
  title: string | null;
  body: string;
  image_url: string | null;
  scheduled_for: string | null;
  created_at: string;
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "bg-pink-50 text-pink-700",
  facebook: "bg-blue-50 text-blue-700",
  linkedin: "bg-sky-50 text-sky-700",
  gbp: "bg-green-50 text-green-700",
};

export default function ApprovalsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [imageMap, setImageMap] = useState<Record<number, string>>({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getPendingApprovals()
      .then(setItems)
      .finally(() => setFetching(false));
  }, [user]);

  const handleImageSelect = async (item: ContentItem, file: File) => {
    setUploading((prev) => ({ ...prev, [item.id]: true }));
    try {
      const url = await uploadMedia(file);
      setImageMap((prev) => ({ ...prev, [item.id]: url }));
    } catch {
      toast.error("Image upload failed");
    } finally {
      setUploading((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleApprove = async (item: ContentItem) => {
    try {
      const body = editingId === item.id ? editBody : undefined;
      const imageUrl = imageMap[item.id];
      await approveContent(item.id, body, imageUrl);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setImageMap((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      setEditingId(null);
      toast.success("Approved and queued for publishing");
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
          {items.map((item) => {
            const previewUrl = imageMap[item.id] || item.image_url;
            const needsImage = item.platform === "instagram";
            const platformColor = item.platform ? PLATFORM_COLORS[item.platform] || "bg-gray-100 text-gray-600" : "bg-gray-100 text-gray-600";

            return (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                      {item.content_type.replace("_", " ")}
                    </span>
                    {item.platform && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${platformColor}`}>
                        {item.platform}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                  </span>
                </div>

                {item.title && (
                  <h3 className="font-medium text-gray-900 mb-2">{item.title}</h3>
                )}

                {/* Body */}
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

                {/* Image section */}
                <div className="mt-4">
                  {previewUrl ? (
                    <div className="relative inline-block">
                      <img
                        src={previewUrl.startsWith("/") ? `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${previewUrl}` : previewUrl}
                        alt="Post image"
                        className="h-40 w-auto rounded-lg border border-gray-200 object-cover"
                      />
                      <button
                        onClick={() => {
                          setImageMap((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
                          if (fileInputRefs.current[item.id]) fileInputRefs.current[item.id]!.value = "";
                        }}
                        className="absolute -top-2 -right-2 bg-white border border-gray-300 rounded-full w-5 h-5 flex items-center justify-center text-gray-500 hover:text-red-500 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className={`inline-flex items-center gap-2 cursor-pointer border rounded-lg px-3 py-2 text-sm transition-colors ${needsImage ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100" : "border-gray-300 text-gray-500 hover:bg-gray-50"}`}>
                      <input
                        ref={(el) => { fileInputRefs.current[item.id] = el; }}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleImageSelect(item, f);
                        }}
                      />
                      {uploading[item.id] ? (
                        <span>Uploading...</span>
                      ) : (
                        <>
                          <span>{needsImage ? "⚠ Add image (required for Instagram)" : "Add image (optional)"}</span>
                        </>
                      )}
                    </label>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => handleApprove(item)}
                    disabled={uploading[item.id]}
                    className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
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
            );
          })}
        </div>
      </main>
    </div>
  );
}
