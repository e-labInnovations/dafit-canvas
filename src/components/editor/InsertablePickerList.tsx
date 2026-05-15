import { useState } from 'react'
import { Info } from 'lucide-react'
import {
  INSERTABLE_CATEGORIES,
  TYPEC_INSERTABLE_TYPES,
  insertableMeta,
  type InsertableCategory,
  type InsertableType,
} from '../../lib/projectIO'
import Tooltip from '../Tooltip'
import InsertableInfoCard from './InsertableInfoCard'

type Props = {
  /** Fired when the user picks a row by clicking its name. The parent
   *  opens the matching modal (layer-insert or new-asset). */
  onPick: (k: InsertableType) => void
  /** Optional row-level "disabled" hint. The hover card + name still
   *  show, but the row gets a faded look + tooltip explaining why.
   *  Used for the one-animation-layer-per-face cap. */
  isDisabled?: (k: InsertableType) => string | null
  /** Restrict the visible types — defaults to all TYPEC_INSERTABLE_TYPES.
   *  Pass a filter for surfaces that only handle a subset. */
  types?: InsertableType[]
}

/** Clean, filterable, category-grouped list of insertable types. Shared
 *  by both the Layer Insert popover and the Asset Library New popover —
 *  both share the same picker mechanics; they just differ on what the
 *  picked row opens (the Insert layer modal vs. New asset modal). */
function InsertablePickerList({ onPick, isDisabled, types }: Props) {
  const [filter, setFilter] = useState('')
  const source = types ?? TYPEC_INSERTABLE_TYPES

  const filtered = source.filter((k) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      k.name.toLowerCase().includes(q) ||
      `0x${k.type.toString(16).padStart(2, '0')}`.includes(q)
    )
  })

  const byCat = new Map<InsertableCategory, typeof filtered>()
  for (const k of filtered) {
    const cat = insertableMeta(k.type).category
    const list = byCat.get(cat)
    if (list) list.push(k)
    else byCat.set(cat, [k])
  }

  return (
    <div className="insertable-picker">
      <input
        type="text"
        className="insertable-picker-filter"
        placeholder="Filter types…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      {filtered.length === 0 && (
        <p className="hint insertable-picker-empty">
          No types match "{filter}".
        </p>
      )}
      {INSERTABLE_CATEGORIES.map((cat) => {
        const items = byCat.get(cat.id)
        if (!items || items.length === 0) return null
        return (
          <div key={cat.id} className="insertable-picker-group">
            <div className="insertable-picker-section">{cat.label}</div>
            {items.map((k) => {
              const reason = isDisabled?.(k) ?? null
              return (
                <div
                  key={k.type}
                  className={`insertable-picker-row${reason ? ' disabled' : ''}`}
                >
                  <button
                    type="button"
                    className="insertable-picker-name"
                    onClick={() => {
                      if (reason) return
                      onPick(k)
                    }}
                    disabled={reason !== null}
                    title={reason ?? undefined}
                  >
                    <span>{k.name}</span>
                    <span className="insertable-picker-count">{k.count}</span>
                  </button>
                  <Tooltip
                    content={<InsertableInfoCard k={k} variant="compact" />}
                    placement="right"
                  >
                    <button
                      type="button"
                      className="insertable-picker-info"
                      aria-label={`About ${k.name}`}
                      // Plain click also opens the modal — info is a
                      // hover affordance only.
                      onClick={() => {
                        if (reason) return
                        onPick(k)
                      }}
                    >
                      <Info size={12} aria-hidden />
                    </button>
                  </Tooltip>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export default InsertablePickerList
