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
    <div className="min-h-screen bg-ink-900">
      <Nav />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-sans font-semibold text-fg-1 text-xl">Reviews</h1>
          <button
            onClick={() => setShowResponded(!showResponded)}
            className="text-sm text-fg-3 hover:text-fg-1 font-sans transition-colors duration-150"
          >
            {showResponded ? "Show unanswered" : "Show responded"}
          </button>
        </div>

        {fetching && <p className="text-fg-3 font-sans text-sm">Loading…</p>}

        {!fetching && reviews.length === 0 && (
          <div className="bg-ink-700 rounded-xl border border-ink-600 p-10 text-center">
            <p className="text-fg-3 font-sans text-sm">No reviews found.</p>
          </div>
        )}

        <div className="space-y-4">
          {reviews.map((review) => {
            const draft = responses[review.id];
            return (
              <div key={review.id} className="bg-ink-700 rounded-xl border border-ink-600 p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-sans font-medium bg-ink-500 text-fg-2 px-2 py-0.5 rounded-md border border-ink-600 capitalize">
                      {review.platform}
                    </span>
                    {review.rating && (
                      <span className="text-xs text-signal-warn">
                        {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
                      </span>
                    )}
                    {review.sentiment && <SentimentBadge sentiment={review.sentiment} />}
                  </div>
                  <span className="text-xs text-fg-3 font-sans">
                    {formatDistanceToNow(new Date(review.detected_at), { addSuffix: true })}
                  </span>
                </div>

                {review.reviewer_name && (
                  <p className="text-sm font-sans font-medium text-fg-1 mb-1">{review.reviewer_name}</p>
                )}
                {review.body && (
                  <p className="text-sm text-fg-2 font-mono leading-relaxed mb-4">{review.body}</p>
                )}

                {draft && !review.responded_at && (
                  <div className="border-t border-ink-600 pt-4 mt-2">
                    <p className="text-xs font-sans font-medium text-fg-3 mb-2">Drafted response</p>
                    {editingId === review.id ? (
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="input min-h-[80px] resize-none"
                      />
                    ) : (
                      <p className="text-sm text-fg-2 font-mono bg-ink-500 border border-ink-600 rounded-md p-3 leading-relaxed">
                        {draft.body}
                      </p>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleApproveResponse(review.id)}
                        className="btn-primary"
                      >
                        Approve &amp; post
                      </button>
                      {editingId === review.id ? (
                        <button
                          onClick={() => setEditingId(null)}
                          className="btn-ghost"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => { setEditingId(review.id); setEditBody(draft.body); }}
                          className="btn-ghost"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => handleRejectResponse(review.id)}
                        className="text-sm text-signal-bad hover:opacity-80 font-sans transition-opacity duration-150"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {review.responded_at && (
                  <p className="text-xs text-signal-good font-sans mt-2">
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
    positive: "bg-signal-good/10 text-signal-good border-signal-good/30",
    neutral: "bg-ink-500 text-fg-3 border-ink-600",
    negative: "bg-signal-bad/10 text-signal-bad border-signal-bad/30",
  };
  return (
    <span className={`text-xs font-sans px-2 py-0.5 rounded-md capitalize border ${colors[sentiment] || "bg-ink-500 text-fg-3 border-ink-600"}`}>
      {sentiment}
    </span>
  );
}
