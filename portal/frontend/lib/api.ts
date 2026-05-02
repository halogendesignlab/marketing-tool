import axios from "axios";
import Cookies from "js-cookie";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      Cookies.remove("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const form = new URLSearchParams({ username: email, password });
  const res = await api.post("/api/auth/token", form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data;
}

export async function getMe() {
  const res = await api.get("/api/auth/me");
  return res.data;
}

// ── Content ───────────────────────────────────────────────────────────────────

export async function getContentItems(params?: Record<string, string | number>) {
  const res = await api.get("/api/content/", { params });
  return res.data;
}

export async function approveContent(id: number, body?: string, scheduledFor?: string) {
  const res = await api.post(`/api/approvals/${id}/approve`, { body, scheduled_for: scheduledFor });
  return res.data;
}

export async function rejectContent(id: number, reason?: string) {
  const res = await api.post(`/api/approvals/${id}/reject`, { reason });
  return res.data;
}

export async function getPendingApprovals(clientId?: number) {
  const res = await api.get("/api/approvals/", { params: clientId ? { client_id: clientId } : {} });
  return res.data;
}

// ── Assets ────────────────────────────────────────────────────────────────────

export async function getAssets(params?: Record<string, string | number>) {
  const res = await api.get("/api/assets/", { params });
  return res.data;
}

export async function approveAsset(id: number) {
  const res = await api.post(`/api/assets/${id}/approve`);
  return res.data;
}

export async function rejectAsset(id: number) {
  const res = await api.post(`/api/assets/${id}/reject`);
  return res.data;
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export async function getReviews(params?: Record<string, string | number | boolean>) {
  const res = await api.get("/api/reviews/", { params });
  return res.data;
}

export async function getReviewResponse(reviewId: number) {
  const res = await api.get(`/api/reviews/${reviewId}/response`);
  return res.data;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getReports(clientId?: number) {
  const res = await api.get("/api/reports/", { params: clientId ? { client_id: clientId } : {} });
  return res.data;
}

export async function getLatestReport(clientId: number) {
  const res = await api.get(`/api/reports/latest/${clientId}`);
  return res.data;
}

// ── Directories ───────────────────────────────────────────────────────────────

export async function getDirectoryListings(params?: Record<string, string | number | boolean>) {
  const res = await api.get("/api/directories/", { params });
  return res.data;
}

// ── Clients ───────────────────────────────────────────────────────────────────

export async function getClients() {
  const res = await api.get("/api/clients/");
  return res.data;
}
