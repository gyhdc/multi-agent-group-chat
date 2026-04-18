import { DiscussionRoom, ProviderPreset, ResearchDirectionPreset } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  listRooms: () => request<DiscussionRoom[]>("/api/rooms"),
  createRoom: (room?: Partial<DiscussionRoom>) =>
    request<DiscussionRoom>("/api/rooms", {
      method: "POST",
      body: JSON.stringify(room ?? {}),
    }),
  updateRoom: (roomId: string, room: Partial<DiscussionRoom>) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(room),
    }),
  deleteRoom: (roomId: string) =>
    request<void>(`/api/rooms/${roomId}`, {
      method: "DELETE",
    }),
  startRoom: (roomId: string) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/start`, {
      method: "POST",
    }),
  stepRoom: (roomId: string) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/step`, {
      method: "POST",
    }),
  runRoom: (roomId: string) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/run`, {
      method: "POST",
    }),
  stopRoom: (roomId: string) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/stop`, {
      method: "POST",
    }),
  toggleInsightSaved: (roomId: string, insightId: string) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/insights/${insightId}/toggle-save`, {
      method: "POST",
    }),
  addUserMessage: (roomId: string, content: string, replyToMessageId?: string | null) =>
    request<DiscussionRoom>(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, replyToMessageId: replyToMessageId ?? null }),
    }),
  listProviderPresets: () => request<ProviderPreset[]>("/api/provider-presets"),
  listResearchDirections: () => request<ResearchDirectionPreset[]>("/api/research-directions"),
  createResearchDirection: (direction: Partial<ResearchDirectionPreset>) =>
    request<ResearchDirectionPreset>("/api/research-directions", {
      method: "POST",
      body: JSON.stringify(direction),
    }),
  updateResearchDirection: (directionId: string, direction: Partial<ResearchDirectionPreset>) =>
    request<ResearchDirectionPreset>(`/api/research-directions/${directionId}`, {
      method: "PUT",
      body: JSON.stringify(direction),
    }),
  deleteResearchDirection: (directionId: string) =>
    request<void>(`/api/research-directions/${directionId}`, {
      method: "DELETE",
    }),
  createProviderPreset: (preset: Partial<ProviderPreset>) =>
    request<ProviderPreset>("/api/provider-presets", {
      method: "POST",
      body: JSON.stringify(preset),
    }),
  updateProviderPreset: (presetId: string, preset: Partial<ProviderPreset>) =>
    request<ProviderPreset>(`/api/provider-presets/${presetId}`, {
      method: "PUT",
      body: JSON.stringify(preset),
    }),
  deleteProviderPreset: (presetId: string) =>
    request<void>(`/api/provider-presets/${presetId}`, {
      method: "DELETE",
    }),
};
