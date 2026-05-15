import { insertableMeta, type InsertableType } from '../../lib/projectIO'

type Props = {
  /** Type-table entry being described. */
  k: InsertableType
  /** Compact = single-line label + small meta, for the popover hover.
   *  Expanded = full description + stat block, for the modal header. */
  variant?: 'compact' | 'expanded'
}

/** Shared "what is this type?" card. Used both as the content of a hover
 *  card off the (i) icon in the picker popover (compact variant) and at
 *  the top of the Insert modal (expanded variant). Centralising avoids
 *  description drift between the two surfaces. */
function InsertableInfoCard({ k, variant = 'compact' }: Props) {
  const meta = insertableMeta(k.type)
  const hex = `0x${k.type.toString(16).padStart(2, '0')}`
  return (
    <div className={`insertable-info-card insertable-info-card-${variant}`}>
      <header>
        <strong>{k.name}</strong>
        <code>{hex}</code>
      </header>
      {meta.description ? (
        <p>{meta.description}</p>
      ) : (
        <p className="hint">No description yet for this type.</p>
      )}
      <dl>
        <dt>Slots</dt>
        <dd>
          {k.count}
          {k.type >= 0xf6 && k.type <= 0xf8 && (
            <span className="hint">
              {' '}
              (× animationFrames at create time)
            </span>
          )}
        </dd>
        <dt>Default size</dt>
        <dd>
          {k.dim.w}×{k.dim.h}
        </dd>
        <dt>Default position</dt>
        <dd>
          x={k.pos.x}, y={k.pos.y}
        </dd>
        <dt>Seen in</dt>
        <dd>{k.faces} of 387 corpus faces</dd>
      </dl>
    </div>
  )
}

export default InsertableInfoCard
