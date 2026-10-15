import { useId } from 'react'
import './brand-pattern.css'

type BrandPatternProps = {
  variant: 'poster' | 'empty' | 'header'
  className?: string
}

/** Decorative offer-inspection artwork. The eye and punched tag share the brand geometry. */
export function BrandPattern({ variant, className = '' }: BrandPatternProps) {
  const id = `espia-pattern-${useId().replace(/:/g, '')}`
  const isPoster = variant === 'poster'
  const viewBox = isPoster ? '0 0 520 360' : variant === 'header' ? '0 0 440 88' : '0 0 200 140'

  return (
    <svg
      className={`brand-pattern brand-pattern--${variant}${className ? ` ${className}` : ''}`}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id={`${id}-dots`} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.8" fill={isPoster ? '#18243C' : 'currentColor'} />
        </pattern>
        <pattern id={`${id}-stripes`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <path d="M0 0V12" stroke="#18243C" strokeWidth="4" />
        </pattern>
        <clipPath id={`${id}-bounds`}>
          <rect width={isPoster ? 520 : variant === 'header' ? 440 : 200} height={isPoster ? 360 : variant === 'header' ? 88 : 140} rx={isPoster ? 24 : 0} />
        </clipPath>
        <g id={`${id}-tag`}>
          <path
            d="M9 5.5h13.8a5 5 0 0 1 3.54 1.46l10.1 10.1a4.15 4.15 0 0 1 0 5.88l-10.1 10.1a5 5 0 0 1-3.54 1.46H9a6 6 0 0 1-6-6v-17a6 6 0 0 1 6-6Z"
            fill="#F8D95A" stroke="#18243C" strokeWidth={isPoster ? 0.85 : 1.5} strokeLinejoin="round"
          />
          <path
            d="M6.9 20c2.4-4.2 5.2-6.3 8.6-6.3s6.2 2.1 8.6 6.3c-2.4 4.2-5.2 6.3-8.6 6.3S9.3 24.2 6.9 20Z"
            fill="#FFFFFF" stroke="#18243C" strokeWidth={isPoster ? 0.7 : 1.3} strokeLinejoin="round"
          />
          <circle cx="15.5" cy="20" r="3.65" fill="#18243C" />
          <circle cx="30.3" cy="20" r="1.9" fill="#18243C" />
        </g>
      </defs>

      <g clipPath={`url(#${id}-bounds)`}>
        {isPoster ? (
          <>
            <rect width="520" height="360" rx="24" fill="#DDE6FF" />
            <circle cx="464" cy="27" r="147" fill="#3153C7" />
            <circle cx="464" cy="27" r="100" stroke="#FFFFFF" strokeWidth="2.5" />
            <path d="M-20 264a118 118 0 0 1 118 118H-20Z" fill="#F8D95A" />
            <rect x="25" y="30" width="80" height="98" fill={`url(#${id}-dots)`} />
            <path d="M429 254h112v112H429Z" fill={`url(#${id}-stripes)`} />
            <g className="brand-pattern__card">
              <rect x="105" y="91" width="312" height="191" rx="22" transform="rotate(7 261 186)" fill="#18243C" />
              <rect x="97" y="81" width="312" height="191" rx="22" transform="rotate(7 253 176)" fill="#FFFFFF" stroke="#18243C" strokeWidth="3" />
              <g transform="rotate(-10 260 180)">
                <use href={`#${id}-tag`} transform="translate(105 31) scale(7.2)" />
              </g>
            </g>
            <path d="M65 194c-30 25-28 66 9 81" stroke="#3153C7" strokeWidth="14" strokeLinecap="round" />
            <path d="M166 325c25-23 50 23 75 0s50 23 75 0" stroke="#3153C7" strokeWidth="8" strokeLinecap="round" />
            <circle cx="438" cy="215" r="7" fill="#F8D95A" stroke="#18243C" strokeWidth="2.5" />
          </>
        ) : variant === 'header' ? (
          <>
            <path d="M437-46a92 92 0 0 1 0 184" stroke="var(--app-accent, #3153C7)" strokeWidth="24" />
            <path d="M438-13a59 59 0 0 1 0 118" stroke="#F8D95A" strokeWidth="3" />
            <rect x="226" y="6" width="62" height="76" fill={`url(#${id}-dots)`} className="brand-pattern__quiet" />
            <g className="brand-pattern__card" transform="rotate(-12 345 44)">
              <use href={`#${id}-tag`} transform="translate(300 -2) scale(2.3)" />
            </g>
            <path d="M214 69q13-15 26 0t26 0" stroke="var(--app-accent, #3153C7)" strokeWidth="4" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M47 34c-31 12-33 56-5 69" stroke="var(--app-accent, #3153C7)" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 7" />
            <path d="M154 19a43 43 0 0 1 0 86" stroke="var(--app-accent, #3153C7)" strokeWidth="13" />
            <g className="brand-pattern__card" transform="rotate(-12 100 67)">
              <use href={`#${id}-tag`} transform="translate(47 10) scale(2.85)" />
            </g>
            <path d="M67 120q11-12 22 0t22 0" stroke="var(--app-accent, #3153C7)" strokeWidth="4" strokeLinecap="round" />
            <circle cx="44" cy="17" r="3" fill="#F8D95A" stroke="#18243C" strokeWidth="1.5" />
          </>
        )}
      </g>
    </svg>
  )
}
