// Thin wrapper around the MoYoung HTTP endpoints. Two axios instances:
//  - `legacy`   → api.moyoung.com    (only /v2/faces is actually used)
//  - `cdn`      → api-cdn.moyoung.com (v3 face catalogue + detail + download
//                                      bookkeeping)
//
// All endpoints return a JSON envelope `{ code, message, data | <inline> }`.
// On `code !== 0` we throw so calling code can route into the page's error
// banner. The Vite dev proxy strips `/api/moyoung[-cdn]` before forwarding,
// so production builds talk to the same paths via whatever proxy is wired.

import axios, { AxiosError } from 'axios'
import type {
  FacesQuery,
  MoyoungFacesResponse,
  V3FaceDetail,
  V3FaceDetailResponse,
  V3ListResponse,
  V3Query,
  V3Tag,
  V3TagListResponse,
} from '../types/moyoung'

const legacy = axios.create({ baseURL: '/api/moyoung' })
const cdn = axios.create({ baseURL: '/api/moyoung-cdn' })

const throwIfApiError = <T extends { code: number; message: string }>(
  payload: T,
): T => {
  if (payload.code !== 0) {
    throw new Error(`MoYoung API ${payload.code}: ${payload.message}`)
  }
  return payload
}

const errorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ message?: string }>
    return ax.response?.data?.message ?? ax.message
  }
  return err instanceof Error ? err.message : String(err)
}

// ---------- v2 catalogue (used as the "All" fallback) ----------

export const fetchLegacyFaces = async (
  query: FacesQuery,
  signal?: AbortSignal,
): Promise<MoyoungFacesResponse> => {
  const res = await legacy.get<MoyoungFacesResponse>('/v2/faces', {
    params: query,
    signal,
  })
  return throwIfApiError(res.data)
}

// ---------- v3 ----------

/** Fetch the tag list. Each tag arrives with 20 sample faces preloaded — we
 *  use them only to know the category names; the actual list comes from
 *  `/v3/list?tag_id=…`. */
export const fetchV3Tags = async (
  query: Pick<V3Query, 'tpls' | 'fv' | 'lang' | 'tested'>,
  signal?: AbortSignal,
): Promise<V3Tag[]> => {
  const res = await cdn.get<V3TagListResponse>('/faces/v3/tag-list', {
    params: { ...query, per_page: '20', p: '1' },
    signal,
  })
  return throwIfApiError(res.data).data
}

export const fetchV3List = async (
  query: V3Query,
  signal?: AbortSignal,
): Promise<V3ListResponse> => {
  const res = await cdn.get<V3ListResponse>('/faces/v3/list', {
    params: query,
    signal,
  })
  return throwIfApiError(res.data)
}

export const fetchV3FaceDetail = async (
  id: number,
  query: Pick<V3Query, 'fv' | 'lang'>,
  signal?: AbortSignal,
): Promise<V3FaceDetail> => {
  const res = await cdn.get<V3FaceDetailResponse>('/faces/v3/face-detail', {
    params: { id, ...query },
    signal,
  })
  return throwIfApiError(res.data).data
}

/** Bookkeeping ping — the server returns an empty payload but increments the
 *  download counter. We fire-and-forget; any failure is swallowed since the
 *  user is only here to get the .bin, not to update MoYoung's stats. */
export const pingV3Download = async (
  id: number,
  fv: string,
): Promise<void> => {
  try {
    await cdn.post('/faces/v3/face-download', null, { params: { id, fv } })
  } catch {
    /* intentionally swallowed */
  }
}

export { errorMessage }
