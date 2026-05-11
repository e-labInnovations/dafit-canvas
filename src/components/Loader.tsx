type Props = {
  /** Pixel size of the SVG (square). */
  size?: number
  /** Optional label rendered under the watch; also used as the ARIA label. */
  label?: string
  /** Progress percentage (0–100). When set, the spinning arc is replaced by a
   *  fill arc and the percent number is rendered in the centre of the face. */
  progress?: number
  /** Switches the arc to a "success" colour. Implicit when progress reaches 100. */
  done?: boolean
  className?: string
}

const ARC_RADIUS = 10
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS

function Loader({ size = 80, label, progress, done, className }: Props) {
  const isDeterminate = progress !== undefined
  const clamped = isDeterminate
    ? Math.max(0, Math.min(100, progress))
    : 0
  const dashLen = (clamped / 100) * ARC_CIRCUMFERENCE
  const isDone = done ?? clamped === 100

  return (
    <div
      className={`loader-wrap ${className ?? ''}`}
      role={isDeterminate ? 'progressbar' : 'status'}
      aria-label={label ?? (isDeterminate ? `${Math.round(clamped)}%` : 'Loading')}
      aria-valuenow={isDeterminate ? Math.round(clamped) : undefined}
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
    >
      <svg
        className="loader"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden
      >
        <defs>
          <clipPath id="loader-face-clip">
            <circle cx="31" cy="32" r="14.5" />
          </clipPath>
        </defs>

        {/* Side button */}
        <path
          className="loader-button"
          d="M48 36h-1v-8h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2z"
        />

        {/* Bands */}
        <path
          className="loader-band"
          d="M42 20H20l2.621-10.485A2 2 0 0 1 24.562 8h12.876a2 2 0 0 1 1.941 1.515zM39.379 54.485A2 2 0 0 1 37.438 56H24.562a2 2 0 0 1-1.941-1.515L20 44h22z"
        />

        {/* Case */}
        <circle className="loader-case-outer" cx="31" cy="32" r="17" />
        <circle className="loader-case-inner" cx="31" cy="32" r="16.5" />

        {/* Face */}
        <circle className="loader-face" cx="31" cy="32" r="14.5" />

        <g clipPath="url(#loader-face-clip)">
          {/* Static track ring */}
          <circle
            className="loader-track"
            cx="31"
            cy="32"
            r={ARC_RADIUS}
            fill="none"
          />

          {isDeterminate ? (
            <circle
              className={`loader-progress-arc ${isDone ? 'is-done' : ''}`}
              cx="31"
              cy="32"
              r={ARC_RADIUS}
              fill="none"
              strokeDasharray={`${dashLen} ${ARC_CIRCUMFERENCE}`}
            />
          ) : (
            <>
              <circle
                className="loader-arc"
                cx="31"
                cy="32"
                r={ARC_RADIUS}
                fill="none"
              />
              <circle className="loader-dot" cx="31" cy="32" r="1.6" />
            </>
          )}

          {isDeterminate && (
            <text
              className={`loader-percent ${isDone ? 'is-done' : ''}`}
              x="31"
              y="32"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {Math.round(clamped)}
            </text>
          )}
        </g>

        {/* Bezel ring */}
        <circle
          className="loader-bezel"
          cx="31"
          cy="32"
          r="14.5"
          fill="none"
        />
      </svg>
      {label && <span className="loader-label">{label}</span>}
    </div>
  )
}

export default Loader
