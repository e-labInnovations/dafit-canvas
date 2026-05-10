export const SCREEN_W = 240
export const SCREEN_H = 240

export type ElementId = string

type ElementBase = {
  id: ElementId
  name: string
  visible: boolean
  x: number
  y: number
}

export type BackgroundElement = ElementBase & {
  kind: 'background'
  color: string
}

export type TimeElement = ElementBase & {
  kind: 'time'
  format: 'HH:mm' | 'HH:mm:ss'
  fontSize: number
  color: string
}

export type TextElement = ElementBase & {
  kind: 'text'
  text: string
  fontSize: number
  color: string
}

export type FaceElement = BackgroundElement | TimeElement | TextElement

export type FaceProject = {
  version: 1
  faceNumber: number
  elements: FaceElement[]
}

export const PROJECT_VERSION = 1 as const
