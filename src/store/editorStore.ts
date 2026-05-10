import { create } from 'zustand'
import {
  PROJECT_VERSION,
  type ElementId,
  type FaceElement,
  type FaceProject,
} from '../types/face'

let idCounter = 0
const nextId = (): ElementId => {
  idCounter += 1
  return `el_${Date.now().toString(36)}_${idCounter}`
}

const defaultProject = (): FaceProject => ({
  version: PROJECT_VERSION,
  faceNumber: 50001,
  elements: [
    {
      id: nextId(),
      kind: 'background',
      name: 'Background',
      visible: true,
      x: 0,
      y: 0,
      color: '#0d0d12',
    },
    {
      id: nextId(),
      kind: 'time',
      name: 'Time',
      visible: true,
      x: 40,
      y: 96,
      format: 'HH:mm',
      fontSize: 56,
      color: '#ffffff',
    },
  ],
})

type EditorState = {
  project: FaceProject
  selectedId: ElementId | null
  select: (id: ElementId | null) => void
  addElement: (kind: FaceElement['kind']) => void
  updateElement: <T extends FaceElement>(id: ElementId, patch: Partial<T>) => void
  deleteElement: (id: ElementId) => void
  toggleVisible: (id: ElementId) => void
  moveLayer: (id: ElementId, direction: 'up' | 'down') => void
  setFaceNumber: (n: number) => void
  loadProject: (project: FaceProject) => void
  resetProject: () => void
}

const buildElement = (kind: FaceElement['kind']): FaceElement => {
  const base = {
    id: nextId(),
    visible: true,
    x: 80,
    y: 80,
  }
  switch (kind) {
    case 'background':
      return {
        ...base,
        kind: 'background',
        name: 'Background',
        x: 0,
        y: 0,
        color: '#1a1a22',
      }
    case 'time':
      return {
        ...base,
        kind: 'time',
        name: 'Time',
        format: 'HH:mm',
        fontSize: 48,
        color: '#ffffff',
      }
    case 'text':
      return {
        ...base,
        kind: 'text',
        name: 'Text',
        text: 'Hello',
        fontSize: 24,
        color: '#ffffff',
      }
  }
}

export const useEditor = create<EditorState>((set) => ({
  project: defaultProject(),
  selectedId: null,

  select: (id) => set({ selectedId: id }),

  addElement: (kind) =>
    set((state) => {
      const el = buildElement(kind)
      return {
        project: { ...state.project, elements: [...state.project.elements, el] },
        selectedId: el.id,
      }
    }),

  updateElement: (id, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        elements: state.project.elements.map((el) =>
          el.id === id ? ({ ...el, ...patch } as FaceElement) : el,
        ),
      },
    })),

  deleteElement: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        elements: state.project.elements.filter((el) => el.id !== id),
      },
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  toggleVisible: (id) =>
    set((state) => ({
      project: {
        ...state.project,
        elements: state.project.elements.map((el) =>
          el.id === id ? { ...el, visible: !el.visible } : el,
        ),
      },
    })),

  moveLayer: (id, direction) =>
    set((state) => {
      const elements = [...state.project.elements]
      const idx = elements.findIndex((e) => e.id === id)
      if (idx < 0) return state
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1
      if (targetIdx < 0 || targetIdx >= elements.length) return state
      ;[elements[idx], elements[targetIdx]] = [elements[targetIdx], elements[idx]]
      return { project: { ...state.project, elements } }
    }),

  setFaceNumber: (n) =>
    set((state) => ({ project: { ...state.project, faceNumber: n } })),

  loadProject: (project) => set({ project, selectedId: null }),

  resetProject: () => set({ project: defaultProject(), selectedId: null }),
}))
