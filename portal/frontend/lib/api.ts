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

export async function changePassword(currentPassword: string, newPassword: string) {
  await api.post("/api/auth/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

// ── Content ───────────────────────────────────────────────────────────────────

export async function getContentItems(params?: Record<string, string | number>) {
  const res = await api.get("/api/content/", { params });
  return res.data;
}

export async function approveContent(id: number, body?: string, imageUrl?: string, scheduledFor?: string) {
  const res = await api.post(`/api/approvals/${id}/approve`, {
    body,
    image_url: imageUrl,
    scheduled_for: scheduledFor,
  });
  return res.data;
}

export async function uploadMedia(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/api/media/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.url;
}

export async function rejectContent(id: number, reason?: string) {
  const res = await api.post(`/api/approvals/${id}/reject`, { reason });
  return res.data;
}

export async function sendToClient(id: number) {
  const res = await api.post(`/api/approvals/${id}/send-to-client`);
  return res.data;
}

export async function recallFromClient(id: number) {
  const res = await api.post(`/api/approvals/${id}/recall`);
  return res.data;
}

export async function deleteContent(id: number) {
  const res = await api.delete(`/api/approvals/${id}`);
  return res.data;
}

export async function getPendingApprovals(clientId?: number, status?: string) {
  const params: Record<string, string | number> = {};
  if (clientId) params.client_id = clientId;
  if (status) params.status = status;
  const res = await api.get("/api/approvals/", { params });
  return res.data;
}

export async function generateDraft(payload: {
  content_type: string;
  platform?: string;
  platforms?: string[];
  media_item_id?: number;
  topic?: string;
  client_id?: number;
}) {
  const res = await api.post("/api/approvals/generate", payload);
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

// ── Directories ───────────────────────────────────────────────────────────────

export async function getDirectoryListings(params?: Record<string, string | number | boolean>) {
  const res = await api.get("/api/directories/", { params });
  return res.data;
}

// ── Media library ─────────────────────────────────────────────────────────────

export async function getMediaFolders(clientId?: number) {
  const res = await api.get("/api/media/folders", { params: clientId ? { client_id: clientId } : {} });
  return res.data;
}

export async function createMediaFolder(name: string, parentId?: number) {
  const res = await api.post("/api/media/folders", { name, parent_id: parentId ?? null });
  return res.data;
}

export async function deleteMediaFolder(id: number) {
  const res = await api.delete(`/api/media/folders/${id}`);
  return res.data;
}

export interface MediaFilters {
  search?: string;
  category?: string;
  project?: string;
  photo_type?: string;
}

export async function getMediaItems(folderId?: number | null, clientId?: number, limit = 50, offset = 0, filters: MediaFilters = {}) {
  const params: Record<string, string | number> = { limit, offset };
  if (folderId != null) params.folder_id = folderId;
  if (clientId != null) params.client_id = clientId;
  if (filters.search) params.search = filters.search;
  if (filters.category) params.category = filters.category;
  if (filters.project) params.project = filters.project;
  if (filters.photo_type) params.photo_type = filters.photo_type;
  const res = await api.get("/api/media/items", { params });
  return res.data;
}

export async function getMediaItemCount(folderId?: number | null, clientId?: number, filters: MediaFilters = {}) {
  const params: Record<string, string | number> = {};
  if (folderId != null) params.folder_id = folderId;
  if (clientId != null) params.client_id = clientId;
  if (filters.search) params.search = filters.search;
  if (filters.category) params.category = filters.category;
  if (filters.project) params.project = filters.project;
  if (filters.photo_type) params.photo_type = filters.photo_type;
  const res = await api.get("/api/media/items/count", { params });
  return res.data.count as number;
}

export async function getUnorganizedMedia(clientId?: number, limit = 50, offset = 0, filters: MediaFilters = {}) {
  const params: Record<string, string | number> = { limit, offset };
  if (clientId != null) params.client_id = clientId;
  if (filters.search) params.search = filters.search;
  if (filters.category) params.category = filters.category;
  if (filters.project) params.project = filters.project;
  if (filters.photo_type) params.photo_type = filters.photo_type;
  const res = await api.get("/api/media/items/unorganized", { params });
  return res.data;
}

export async function getMediaFilters(clientId?: number): Promise<{ categories: string[]; projects: string[]; photo_types: string[] }> {
  const params: Record<string, number> = {};
  if (clientId != null) params.client_id = clientId;
  const res = await api.get("/api/media/filters", { params });
  return res.data;
}

export async function uploadMediaToLibrary(file: File, folderId?: number | null, clientId?: number): Promise<{ url: string; id: number }> {
  const form = new FormData();
  form.append("file", file);
  const params: Record<string, number> = {};
  if (folderId != null) params.folder_id = folderId;
  if (clientId != null) params.client_id = clientId;
  const res = await api.post("/api/media/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    params,
  });
  return res.data;
}

export async function deleteMediaItem(id: number) {
  const res = await api.delete(`/api/media/items/${id}`);
  return res.data;
}

export async function moveMediaItem(id: number, folderId: number | null) {
  const res = await api.patch(`/api/media/items/${id}/move`, { folder_id: folderId });
  return res.data;
}

export async function regenerateCaption(id: number) {
  const res = await api.post(`/api/approvals/${id}/regenerate-caption`);
  return res.data;
}

export async function regeneratePost(id: number) {
  const res = await api.post(`/api/approvals/${id}/regenerate-post`);
  return res.data;
}

// ── Reports ───────────────────────────────────────────────────────────────────

export async function getReportList(clientId?: number) {
  const res = await api.get("/api/reports/", { params: clientId ? { client_id: clientId } : {} });
  return res.data;
}

export async function getReport(id: number) {
  const res = await api.get(`/api/reports/${id}`);
  return res.data;
}

export async function triggerReport(month?: number, year?: number, clientId?: number) {
  const params: Record<string, number> = {};
  if (month) params.month = month;
  if (year) params.year = year;
  if (clientId) params.client_id = clientId;
  const res = await api.post("/api/reports/generate", null, { params });
  return res.data;
}

// ── Clients ───────────────────────────────────────────────────────────────────

export async function getClients() {
  const res = await api.get("/api/clients/");
  return res.data;
}

export async function getClientDetail(id: number) {
  const res = await api.get(`/api/clients/${id}/detail`);
  return res.data;
}

export async function createClient(data: Record<string, unknown>) {
  const res = await api.post("/api/clients/", data);
  return res.data;
}

export async function updateClient(id: number, data: Record<string, unknown>) {
  const res = await api.put(`/api/clients/${id}`, data);
  return res.data;
}

export async function inviteUser(clientId: number, data: { email: string; name: string; role: string; password: string }) {
  const res = await api.post(`/api/clients/${clientId}/users`, data);
  return res.data;
}

export async function addUserToClient(clientId: number, userId: number) {
  const res = await api.post(`/api/clients/${clientId}/users/${userId}`);
  return res.data;
}

export async function removeUser(clientId: number, userId: number) {
  await api.delete(`/api/clients/${clientId}/users/${userId}`);
}

export async function triggerDriveSync(clientId: number): Promise<{ imported: number }> {
  const res = await api.post(`/api/clients/${clientId}/drive-sync`);
  return res.data;
}

export async function getKeywordFileInfo(clientId: number): Promise<{
  exists: boolean;
  row_count?: number;
  preview?: string[];
  updated_at?: string;
}> {
  const res = await api.get(`/api/clients/${clientId}/keywords/info`);
  return res.data;
}

export async function uploadKeywordFile(clientId: number, file: File): Promise<{
  ok: boolean;
  row_count: number;
  preview: string[];
}> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post(`/api/clients/${clientId}/keywords/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUsers() {
  const res = await api.get("/api/users/");
  return res.data;
}

export async function updateUser(
  id: number,
  data: { name?: string; email?: string; role?: string; password?: string; is_active?: boolean; client_ids?: number[] }
) {
  const res = await api.put(`/api/users/${id}`, data);
  return res.data;
}
