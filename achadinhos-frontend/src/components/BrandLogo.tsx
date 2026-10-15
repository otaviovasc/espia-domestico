import './brand-logo.css'

type BrandLogoProps = {
  compact?: boolean
  className?: string
}

/** The offer tag doubles as an eye: looking closely is the product's signature. */
export function BrandLogo({ compact = false, className = '' }: BrandLogoProps) {
  return (
    <span
      className={`brand-logo${compact ? ' brand-logo--compact' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label="Espiã Doméstico"
    >
      <svg className="brand-logo__mark" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M9 5.5h13.8a5 5 0 0 1 3.54 1.46l10.1 10.1a4.15 4.15 0 0 1 0 5.88l-10.1 10.1a5 5 0 0 1-3.54 1.46H9a6 6 0 0 1-6-6v-17a6 6 0 0 1 6-6Z"
          fill="#F8D95A"
          stroke="#18243C"
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path
          d="M6.9 20c2.4-4.2 5.2-6.3 8.6-6.3s6.2 2.1 8.6 6.3c-2.4 4.2-5.2 6.3-8.6 6.3S9.3 24.2 6.9 20Z"
          fill="#FFFFFF"
          stroke="#18243C"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <circle cx="15.5" cy="20" r="3.65" fill="#18243C" />
        <circle cx="30.3" cy="20" r="1.9" fill="#18243C" />
      </svg>
      {!compact && (
        <span className="brand-logo__wordmark" aria-hidden="true">
          <span className="brand-logo__name">Espiã</span>
          <span className="brand-logo__descriptor">Doméstico</span>
        </span>
      )}
    </span>
  )
}
