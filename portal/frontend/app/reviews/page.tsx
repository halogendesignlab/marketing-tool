"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { getReviews, getReviewResponse, approveContent, rejectContent } from "@/lib/api";
import toast from "react-hot-toast";
import { formatDistanceToNow } from "date-fns";

interface Review {
  id: number;
  platform: string;
  reviewer_name: string | null;
  rating: number | null;
  body: string | null;
  sentiment: string | null;
  responded_at: string | null;
  detected_at: string;
}

interface ResponseDraft {
  id: number;
  body: string;
  status: string;
}

export default function ReviewsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [responses, setResponses] = useState<Record<number, ResponseDraft>>({});
  const [fetching, setFetching] = useState(true);
  const [showResponded, setShowResponded] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getReviews({ responded: showResponded })
      .then(async (data: Review[]) => {
        setReviews(data);
        const drafts: Record<number, ResponseDraft> = {};
        await Promise.all(
          data
            .filter((r) => !r.responded_at)
            .map(async (r) => {
              try {
                const resp = await getReviewResponse(r.id);
                if (resp) drafts[r.id] = resp;
              } catch {
                // no draft yet
              }
            })
        );
        setResponses(drafts);
      })
      .finally(() => setFetching(false));
  }, [user, showResponded]);

  const handleApproveResponse = async (reviewId: number) => {
    const draft = responses[reviewId];
    if (!draft) return;
    try {
      await approveContent(draft.id, editingId === reviewId ? editBody : undefined);
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
      setEditingId(null);
      toast.success("Response approved — will post to GBP");
    } catch {
      toast.error("Failed to approve response");
    }
  };

  const handleRejectResponse = async (reviewId: number) => {
    const draft = responses[reviewId];
    if (!draft) return;
    try {
      await rejectContent(draft.id);
      setResponses((prev) => {
        const n = { ...prev };
        delete n[reviewId];
        return n;
      });
      toast.success("Response rejected");
    } catch {
      toast.error("Failed to reject response");
    }
  };

  if (loading || !user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Reviews</h1>
          <button
            onClick={() => setShowResponded(!showResponded)}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            {showResponded ? "Show unanswered" : "Show responded"}
          </button>
        </div>

        {fetching && <p className="text-gray-400 text-sm">Loading...</p>}

        {!fetching && reviews.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm">No reviews found.</p>
          </div>
        )}

        <div className="space-y-4">
          {reviews.map((review) => {
            const draft = responses[review.id];
            return (
              <div key={review.id} className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                      {review.platform}
                    </span>
                    {review.rating && (
                      <span className="text-xs text-yellow-500">
                        {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                      </span>
                    )}
                    {review.sentiment && <SentimentBadge sentiment={review.sentiment} />}
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(review.detected_at), { addSuffix: true })}
                  </span>
                </div>

                {review.reviewer_name && (
                  <p className="text-sm font-medium text-gray-700 mb-1">{review.reviewer_name}</p>
                )}
                {review.body && (
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">{review.body}</p>
                )}

                {draft && !review.responded_at && (
                  <div className="border-t border-gray-100 pt-4 mt-2">
                    <p className="text-xs font-medium text-gray-500 mb-2">Drafted response</p>
                    {editingId === review.id ? (
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 min-h-[80px]"
                      />
                    ) : (
                      <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 leading-relaxed">
                        {draft.body}
                      </p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleApproveResponse(review.id)}
                        className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        Approve &amp; post
                      </button>
                      {editingId === review.id ? (
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => { setEditingId(review.id); setEditBody(draft.body); }}
                          className="px-4 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => handleRejectResponse(review.id)}
                        className="px-4 py-1.5 text-red-500 text-sm hover:text-red-700 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {review.responded_at && (
                  <p className="text-xs text-green-600 mt-2">
                    Responded {formatDistanceToNow(new Date(review.responded_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    positive: "bg-green-100 text-green-700",
    neutral: "bg-gray-100 text-gray-600",
    negative: "bg-red-100 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${colors[sentiment] || "bg-gray-100 text-gray-600"}`}>
      {sentiment}
    </span>
  );
}
