// ---------- Legacy v2 ----------

/** Single face shape returned by `/v2/faces` (used as the "All" fallback). */
export type MoyoungFace = {
  id: number
  tpl: number
  tpls: number[]
  firmware: string[]
  preview: string
  file: string
}

export type MoyoungFacesResponse = {
  code: number
  message: string
  current_page: string
  per_page: string
  total: number
  count: number
  faces: MoyoungFace[]
}

export type FacesQuery = {
  tpls: string
  fv: string
  per_page: string
  p: string
}

export const DEFAULT_FACES_QUERY: FacesQuery = {
  tpls: '38',
  fv: 'MOY-GKE5-2.2.7',
  per_page: '50',
  p: '1',
}

// ---------- V3 ----------

/** Tag returned by `/v3/tag-list` — each tag has 20 sample faces preloaded. */
export type V3Tag = {
  id: number
  tag_name: string
  faces: V3ListFace[]
}

export type V3TagListResponse = {
  code: number
  message: string
  data: V3Tag[]
}

/** Face shape inside `/v3/list` and inside `tag.faces[]`. Note: in `/v3/list`
 *  the `file` URL is empty (host-only) — the caller must hit `face-detail` to
 *  get the real download URL. */
export type V3ListFace = {
  id: number
  name: string
  size?: number
  uploader?: string
  recommend?: number
  /** Download count (lifetime). */
  download: number
  preview: string
  tpl?: number | null
  tpls?: number[]
  firmware?: string[]
  remark_en?: string
  remark_zh?: string
  /** May be host-only ("https://qn-hscdn2.moyoung.com/") in list responses. */
  file?: string
}

export type V3ListResponse = {
  code: number
  message: string
  total: number
  data: {
    faces: V3ListFace[]
    count: number
  }
}

/** Full face metadata from `/v3/face-detail`. Includes the real file URL plus
 *  related faces from the same family. */
export type V3FaceDetail = {
  id: number
  name: string
  /** Tag id (string-keyed in the API) → tag name. */
  tags: Record<string, string>
  download: number
  size: number
  file: string
  preview: string
  remark_cn: string | null
  remark_en: string | null
  uploader: string
  face_list: V3ListFace[]
}

export type V3FaceDetailResponse = {
  code: number
  message: string
  data: V3FaceDetail
}

/** Query for `/v3/list` and `/v3/tag-list`. */
export type V3Query = {
  tpls: string
  fv: string
  per_page: string
  p: string
  tag_id: string
  /** Default "1" — only show faces that passed QA. */
  tested: string
  lang: string
}

export const DEFAULT_V3_QUERY: V3Query = {
  tpls: '38',
  fv: 'MOY-GKE5-2.2.7',
  per_page: '50',
  p: '1',
  tag_id: '0',
  tested: '1',
  lang: 'en',
}
