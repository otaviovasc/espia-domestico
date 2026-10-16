export interface ProductOffer {
  title: string
  category: string
  oldPrice: string
  newPrice: string
  discountBadge: string
  image: string
  alt: string
  tag?: string
}

export interface BenefitItem {
  icon: string
  title: string
  description: string
}

export interface LandingTheme {
  isDark: boolean
  bodyBg: string
  bodyColor: string
  heroBadgeBg: string
  heroBadgeText: string
  heroBadgeBorder: string
  h1HighlightColor: string
  subtextColor: string
  cardBg: string
  cardBorder: string
  cardShadow: string
  cardBadgeBg: string
  cardBadgeText: string
  cardOldPriceColor: string
  cardNewPriceColor: string
  cardCategoryColor: string
  cardCategoryBg: string
  benefitBg: string
  benefitBorder: string
  benefitTitleColor: string
  benefitDescColor: string
  ctaPrimaryBg: string
  ctaPrimaryHover: string
  ctaPrimaryText: string
  ctaShadow: string
  stickyBg: string
  stickyBorder: string
  footerColor: string
  headerBg: string
  headerBorder: string
  radialGlow?: string
}

export interface LandingConfig {
  audience: 'feminino' | 'masculino'
  pageTitle: string
  metaDescription: string
  themeColor: string
  ogImage: string
  logoImage: string
  logoAlt: string
  brandName: string
  brandSub: string
  whatsappUrl: string
  pixelId: string

  hero: {
    topBadge: string
    headlineHtml: string
    subtitle: string
    ctaText: string
    microcopy: string
    socialProofCount: string
    socialProofLabel: string
  }

  offers: {
    sectionEyebrow: string
    sectionTitle: string
    sectionSubtitle: string
    products: ProductOffer[]
    ctaText: string
    microcopy: string
  }

  benefits: {
    sectionTitle: string
    items: BenefitItem[]
  }

  closing: {
    headline: string
    subtitle: string
    ctaText: string
    microcopy: string
  }

  stickyCta: {
    text: string
  }

  footer: {
    text: string
  }

  theme: LandingTheme
}
