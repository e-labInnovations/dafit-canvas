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
