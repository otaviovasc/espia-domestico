import type { LandingConfig, BenefitItem, ProductOffer } from './types.ts'

function renderBenefitIcon(icon: string): string {
  if (icon === 'lightning') {
    return `<svg class="b-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
  }
  if (icon === 'tag') {
    return `<svg class="b-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>`
  }
  return `<svg class="b-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`
}

const WHATSAPP_SVG = `<svg class="wa-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>`

function renderProductCard(p: ProductOffer): string {
  return `
    <article class="p-card">
      <div class="p-img-wrap">
        <span class="p-badge">${p.discountBadge}</span>
        <img
          src="${p.image}"
          alt="${p.alt}"
          width="280"
          height="280"
          loading="lazy"
          decoding="async"
          class="p-img"
          onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=(this.src.indexOf('/masculino')===-1?'/masculino':'')+this.getAttribute('src');}"
        />
      </div>
      <div class="p-info">
        <span class="p-cat">${p.category}</span>
        <h3 class="p-title">${p.title}</h3>
        <div class="p-pricing">
          <span class="p-old">De ${p.oldPrice}</span>
          <span class="p-new">Por <strong>${p.newPrice}</strong></span>
        </div>
      </div>
    </article>
  `
}

function renderBenefit(b: BenefitItem): string {
  return `
    <div class="b-row">
      <div class="b-icon-wrap" aria-hidden="true">
        ${renderBenefitIcon(b.icon)}
      </div>
      <div class="b-text">
        <strong>${b.title}</strong> — ${b.description}
      </div>
    </div>
  `
}

export function renderLandingPage(cfg: LandingConfig): string {
  const t = cfg.theme

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0" />
    <meta name="theme-color" content="${cfg.themeColor}" />
    <meta name="description" content="${cfg.metaDescription}" />
    <title>${cfg.pageTitle}</title>

    <!-- Meta Pixel Code (Deferred) -->
    <script>
      ;(function () {
        function loadPixel() {
          if (window.fbq) return
          !(function (f, b, e, v, n, t, s) {
            if (f.fbq) return
            n = f.fbq = function () {
              n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
            }
            if (!f._fbq) f._fbq = n
            n.push = n
            n.loaded = !0
            n.version = '2.0'
            n.queue = []
            t = b.createElement(e)
            t.async = !0
            t.src = v
            s = b.getElementsByTagName(e)[0]
            s.parentNode.insertBefore(t, s)
          })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')
          fbq('init', '${cfg.pixelId}')
          fbq('track', 'PageView')
        }
        if ('requestIdleCallback' in window) requestIdleCallback(loadPixel, { timeout: 3000 })
        else window.addEventListener('load', loadPixel, { once: true })
      })()
    </script>
    <noscript>
      <img
        height="1"
        width="1"
        style="display: none"
        src="https://www.facebook.com/tr?id=${cfg.pixelId}&ev=PageView&noscript=1"
        alt=""
      />
    </noscript>
    <!-- End Meta Pixel Code -->

    <link rel="icon" type="image/png" href="${cfg.logoImage}" />
    <link rel="apple-touch-icon" href="${cfg.logoImage}" />
    <meta property="og:title" content="${cfg.pageTitle}" />
    <meta property="og:description" content="${cfg.metaDescription}" />
    <meta property="og:image" content="${cfg.ogImage}" />
    <meta property="og:type" content="website" />
    <link rel="preload" as="image" href="${cfg.logoImage}" fetchpriority="high" />

    <style>
      *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      html {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.4;
        background-color: ${t.bodyBg};
        color: ${t.bodyColor};
        -webkit-text-size-adjust: 100%;
        scroll-behavior: smooth;
      }
      body {
        min-height: 100vh;
        background-color: ${t.bodyBg};
        ${t.radialGlow ? `background-image: ${t.radialGlow}; background-repeat: no-repeat; background-attachment: fixed;` : ''}
        color: ${t.bodyColor};
        overflow-x: hidden;
        position: relative;
        padding-bottom: 64px;
      }
      a {
        color: inherit;
        text-decoration: none;
      }
      img {
        display: block;
        max-width: 100%;
        height: auto;
      }

      .container {
        width: 100%;
        max-width: 580px;
        margin-left: auto;
        margin-right: auto;
        padding-left: 16px;
        padding-right: 16px;
      }

      /* Header minimalista */
      .site-header {
        position: relative;
        z-index: 10;
        background: ${t.headerBg};
        border-bottom: 1px solid ${t.headerBorder};
      }
      .header-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 8px;
        padding-bottom: 8px;
      }
      .brand-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .brand-logo {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: contain;
        background: ${t.isDark ? '#1F2430' : '#FFFFFF'};
        padding: 2px;
      }
      .brand-title {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .live-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: ${t.heroBadgeBg};
        color: ${t.heroBadgeText};
        border: 1px solid ${t.heroBadgeBorder};
        font-size: 10px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 9999px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .pulsing-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #25D366;
        box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.7);
        animation: pulse 1.8s infinite cubic-bezier(0.66, 0, 0, 1);
      }
      @keyframes pulse {
        to { box-shadow: 0 0 0 6px rgba(37, 211, 102, 0); }
      }

      /* Hero Section (Foco Absoluto Acima da Dobra) */
      .hero {
        padding-top: 18px;
        padding-bottom: 16px;
        text-align: center;
      }
      .hero-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: ${t.heroBadgeBg};
        color: ${t.heroBadgeText};
        border: 1px solid ${t.heroBadgeBorder};
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        margin-bottom: 10px;
      }
      .hero-h1 {
        font-size: clamp(25px, 7vw, 34px);
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: -0.03em;
        color: ${t.bodyColor};
        margin-bottom: 8px;
      }
      .hero-h1 .highlight {
        color: ${t.h1HighlightColor};
      }
      .hero-sub {
        font-size: clamp(13px, 3.8vw, 15px);
        line-height: 1.4;
        color: ${t.subtextColor};
        max-width: 440px;
        margin-left: auto;
        margin-right: auto;
        margin-bottom: 16px;
      }

      /* CTA Button */
      .cta-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        max-width: 420px;
        margin-left: auto;
        margin-right: auto;
        min-height: 56px;
        background-color: ${t.ctaPrimaryBg};
        color: ${t.ctaPrimaryText};
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        box-shadow: ${t.ctaShadow};
        transition: transform 0.15s ease, background-color 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .cta-btn:hover {
        background-color: ${t.ctaPrimaryHover};
        transform: translateY(-2px);
      }
      .cta-btn:active {
        transform: translateY(1px) scale(0.99);
      }
      .wa-icon {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
      }
      .microcopy {
        margin-top: 8px;
        font-size: 11px;
        font-weight: 600;
        color: ${t.subtextColor};
        text-align: center;
      }

      /* Social Proof Strip */
      .social-proof-strip {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin-top: 14px;
        font-size: 12px;
        color: ${t.subtextColor};
      }
      .stars {
        color: #F59E0B;
        font-size: 13px;
        letter-spacing: 1px;
      }
      .social-proof-text strong {
        color: ${t.bodyColor};
      }

      /* Offers Section */
      .offers-section {
        padding-top: 18px;
        padding-bottom: 18px;
      }
      .sec-header {
        text-align: center;
        margin-bottom: 14px;
      }
      .sec-title {
        font-size: clamp(17px, 4.8vw, 20px);
        font-weight: 800;
        letter-spacing: -0.01em;
        color: ${t.bodyColor};
      }
      .sec-subtitle {
        font-size: 12px;
        color: ${t.subtextColor};
        margin-top: 2px;
      }

      /* Products Grid */
      .products-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }
      .p-card {
        background: ${t.cardBg};
        border: 1px solid ${t.cardBorder};
        border-radius: 12px;
        overflow: hidden;
        box-shadow: ${t.cardShadow};
        display: flex;
        flex-direction: column;
      }
      .p-img-wrap {
        position: relative;
        width: 100%;
        padding-top: 100%;
        background: ${t.isDark ? '#1A1E29' : '#F3EFEA'};
        overflow: hidden;
      }
      .p-img {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .p-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        background: ${t.cardBadgeBg};
        color: ${t.cardBadgeText};
        font-size: 10px;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        z-index: 2;
      }
      .p-info {
        padding: 8px 10px 10px;
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .p-cat {
        font-size: 9px;
        font-weight: 700;
        color: ${t.cardCategoryColor};
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 2px;
      }
      .p-title {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.25;
        color: ${t.bodyColor};
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        min-height: 30px;
        margin-bottom: 4px;
      }
      .p-pricing {
        display: flex;
        align-items: baseline;
        gap: 5px;
        margin-top: auto;
      }
      .p-old {
        font-size: 10px;
        color: ${t.cardOldPriceColor};
        text-decoration: line-through;
      }
      .p-new {
        font-size: 14px;
        color: ${t.cardNewPriceColor};
        font-weight: 800;
      }
      .p-new strong {
        font-weight: 800;
      }

      /* Benefits Section (Linhas ultra compactas) */
      .benefits-section {
        padding-top: 14px;
        padding-bottom: 16px;
      }
      .benefits-box {
        background: ${t.benefitBg};
        border: 1px solid ${t.benefitBorder};
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .b-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .b-icon-wrap {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: ${t.isDark ? '#232938' : '#F5EFEB'};
        color: #25D366;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .b-icon {
        width: 14px;
        height: 14px;
      }
      .b-text {
        font-size: 12px;
        color: ${t.subtextColor};
        line-height: 1.35;
      }
      .b-text strong {
        color: ${t.bodyColor};
      }

      /* Closing Section */
      .closing-section {
        padding-top: 16px;
        padding-bottom: 24px;
        text-align: center;
      }
      .closing-h2 {
        font-size: clamp(17px, 5vw, 21px);
        font-weight: 800;
        letter-spacing: -0.01em;
        margin-bottom: 4px;
      }
      .closing-sub {
        font-size: 12px;
        color: ${t.subtextColor};
        margin-bottom: 14px;
      }

      /* Footer */
      .site-footer {
        padding-top: 14px;
        padding-bottom: 18px;
        text-align: center;
        border-top: 1px solid ${t.headerBorder};
      }
      .footer-text {
        font-size: 11px;
        color: ${t.footerColor};
      }

      /* Sticky Mobile CTA Bar */
      .sticky-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 50;
        background: ${t.stickyBg};
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-top: 1px solid ${t.stickyBorder};
        padding: 6px 14px calc(6px + env(safe-area-inset-bottom, 0px));
        transform: translateY(120%);
        opacity: 0;
        transition: transform 0.25s ease, opacity 0.25s ease;
        pointer-events: none;
      }
      .sticky-bar.visible {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      .sticky-bar .cta-btn {
        min-height: 48px;
        font-size: 14px;
        border-radius: 10px;
      }

      @media (min-width: 641px) {
        .products-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <!-- Topbar minimalista -->
    <header class="site-header">
      <div class="container header-inner">
        <div class="brand-wrap">
          <img
            src="${cfg.logoImage}"
            alt="${cfg.logoAlt}"
            class="brand-logo"
            width="32"
            height="32"
            fetchpriority="high"
            onerror="if(!this.dataset.retried){this.dataset.retried='1';this.src=(this.src.indexOf('/masculino')===-1?'/masculino':'')+this.getAttribute('src');}"
          />
          <span class="brand-title">${cfg.brandName}</span>
        </div>
        <div class="live-badge" aria-label="Status do grupo">
          <span class="pulsing-dot" aria-hidden="true"></span>
          <span>Online</span>
        </div>
      </div>
    </header>

    <main>
      <!-- PRIMEIRA DOBRA (Hero) -->
      <section class="hero container" aria-labelledby="hero-heading">
        <div class="hero-pill">
          ${cfg.hero.topBadge}
        </div>

        <h1 id="hero-heading" class="hero-h1">
          ${cfg.hero.headlineHtml}
        </h1>

        <p class="hero-sub">
          ${cfg.hero.subtitle}
        </p>

        <a
          id="hero-cta"
          href="${cfg.whatsappUrl}"
          class="cta-btn"
          data-whatsapp-cta
          data-cta-loc="hero"
          aria-label="${cfg.hero.ctaText} no WhatsApp"
        >
          ${WHATSAPP_SVG}
          <span>${cfg.hero.ctaText}</span>
        </a>

        <div class="microcopy">
          <span>${cfg.hero.microcopy}</span>
        </div>

        <div class="social-proof-strip" aria-label="Avaliações do grupo">
          <span class="stars" aria-hidden="true">★★★★★</span>
          <span class="social-proof-text"><strong>${cfg.hero.socialProofCount}</strong> ${cfg.hero.socialProofLabel}</span>
        </div>
      </section>

      <!-- PROVA VISUAL (Amostra Real de Ofertas) -->
      <section class="offers-section container" aria-labelledby="offers-heading">
        <div class="sec-header">
          <h2 id="offers-heading" class="sec-title">${cfg.offers.sectionTitle}</h2>
          <p class="sec-subtitle">${cfg.offers.sectionSubtitle}</p>
        </div>

        <div class="products-grid">
          ${cfg.offers.products.map((p) => renderProductCard(p)).join('')}
        </div>

        <a
          href="${cfg.whatsappUrl}"
          class="cta-btn"
          data-whatsapp-cta
          data-cta-loc="offers"
          aria-label="${cfg.offers.ctaText} no WhatsApp"
        >
          ${WHATSAPP_SVG}
          <span>${cfg.offers.ctaText}</span>
        </a>

        <div class="microcopy">
          <span>${cfg.offers.microcopy}</span>
        </div>
      </section>

      <!-- BENEFÍCIOS (Linhas Compactas) -->
      <section class="benefits-section container" aria-label="Vantagens">
        <div class="benefits-box">
          ${cfg.benefits.items.map((b) => renderBenefit(b)).join('')}
        </div>
      </section>

      <!-- SEÇÃO FINAL -->
      <section class="closing-section container" aria-labelledby="closing-heading">
        <h2 id="closing-heading" class="closing-h2">${cfg.closing.headline}</h2>
        <p class="closing-sub">${cfg.closing.subtitle}</p>

        <a
          href="${cfg.whatsappUrl}"
          class="cta-btn"
          data-whatsapp-cta
          data-cta-loc="closing"
          aria-label="${cfg.closing.ctaText} no WhatsApp"
        >
          ${WHATSAPP_SVG}
          <span>${cfg.closing.ctaText}</span>
        </a>

        <div class="microcopy">
          <span>${cfg.closing.microcopy}</span>
        </div>
      </section>
    </main>

    <!-- Footer minimalista -->
    <footer class="site-footer">
      <div class="container">
        <p class="footer-text">${cfg.footer.text}</p>
      </div>
    </footer>

    <!-- CTA STICKY NO MOBILE (Surge após rolagem) -->
    <div id="sticky-cta-bar" class="sticky-bar" aria-hidden="true">
      <div class="container" style="padding: 0;">
        <a
          href="${cfg.whatsappUrl}"
          class="cta-btn"
          data-whatsapp-cta
          data-cta-loc="sticky"
          aria-label="${cfg.stickyCta.text} no WhatsApp"
        >
          ${WHATSAPP_SVG}
          <span>${cfg.stickyCta.text}</span>
        </a>
      </div>
    </div>

    <!-- Scripts de Interação e Tracking de Conversão -->
    <script>
      ;(function () {
        var audience = '${cfg.audience}';
        var lastClickTime = 0;

        function handleCtaClick(e) {
          var now = Date.now();
          var btn = e.currentTarget;
          var loc = btn.getAttribute('data-cta-loc') || 'unknown';

          if (now - lastClickTime < 1500) return;
          lastClickTime = now;

          if (window.fbq) {
            try {
              window.fbq('track', 'Lead', {
                content_name: 'WhatsApp Group',
                content_category: audience,
                button_location: loc
              });

              window.fbq('trackCustom', 'WhatsappGroupClick', {
                audience: audience,
                button_location: loc
              });
            } catch (err) {
              console.error('Erro fbq:', err);
            }
          }
        }

        var ctaButtons = document.querySelectorAll('[data-whatsapp-cta]');
        for (var i = 0; i < ctaButtons.length; i++) {
          ctaButtons[i].addEventListener('click', handleCtaClick);
        }

        var stickyBar = document.getElementById('sticky-cta-bar');
        var heroCta = document.getElementById('hero-cta');

        if (stickyBar && heroCta) {
          var isTicking = false;

          function onScroll() {
            var heroBounds = heroCta.getBoundingClientRect();
            if (heroBounds.bottom < 40 || window.scrollY > 200) {
              stickyBar.classList.add('visible');
              stickyBar.setAttribute('aria-hidden', 'false');
            } else {
              stickyBar.classList.remove('visible');
              stickyBar.setAttribute('aria-hidden', 'true');
            }
            isTicking = false;
          }

          window.addEventListener('scroll', function () {
            if (!isTicking) {
              window.requestAnimationFrame(onScroll);
              isTicking = true;
            }
          }, { passive: true });

          onScroll();
        }
      })();
    </script>
  </body>
</html>
`
}
