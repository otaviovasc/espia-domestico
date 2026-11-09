/* Shared DOM extraction logic. Kept dependency free for Firefox and Node tests. */
(function (root) {
  "use strict";

  const PRODUCT_ID = /\b(?:MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}\b/i;
  const EXACT_PRODUCT_ID = /^(?:MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}$/i;
  const EXACT_REQUEST_ITEM_ID = /^(?:MLBU|MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}$/i;
  const PRODUCT_PATH = /\/(?:p\/)?(?:MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}/i;
  const SHARE_WORDS = /(?:compartilh|gerar\s*link|criar\s*link|link\s*de\s*(?:afiliad|divulga)|copiar\s*link|share|generate\s*link)/i;
  const WAIT_MS = 4500;

  function clean(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(value, base) {
    if (!value) return null;
    try {
      const url = new URL(value, base);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function isProductUrl(value, base) {
    const url = absoluteUrl(value, base);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return /(?:^|\.)(?:mercadolivre\.com\.br|mercadolibre\.com(?:\.[a-z]{2})?)$/i.test(parsed.hostname) &&
        (PRODUCT_PATH.test(parsed.pathname) || PRODUCT_ID.test(parsed.pathname));
    } catch (_) {
      return false;
    }
  }

  function productId(value) {
    const match = String(value ?? "").match(PRODUCT_ID);
    return match ? match[0].replace(/[-\s]/g, "").toUpperCase() : null;
  }

  function productIdFromUrl(value, base) {
    const url = absoluteUrl(value, base);
    if (!url) return null;
    const parsed = new URL(url);
    const queryIds = [];
    for (const wid of parsed.searchParams.getAll("wid")) {
      if (!EXACT_PRODUCT_ID.test(wid)) return null;
      queryIds.push(productId(wid));
    }
    for (const filter of parsed.searchParams.getAll("pdp_filters")) {
      const itemFields = [...filter.matchAll(/(?:^|[|,;])item_id:([^|,;]*)/gi)];
      if (/item_id/i.test(filter) && !itemFields.length) return null;
      for (const [, itemId] of itemFields) {
        if (!EXACT_PRODUCT_ID.test(itemId)) return null;
        queryIds.push(productId(itemId));
      }
    }
    if (queryIds.length) return queryIds.every(id => id === queryIds[0]) ? queryIds[0] : null;
    return productId(parsed.pathname);
  }

  function hasItemIdQuery(parsed) {
    return parsed.searchParams.has("wid") ||
      parsed.searchParams.getAll("pdp_filters").some(filter => /item_id/i.test(filter));
  }

  function isAffiliateUrl(value, base) {
    const url = absoluteUrl(value, base);
    if (!url) return false;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "meli.la") return parsed.pathname.length > 1;
    if (!/(?:^|\.)(?:mercadolivre\.com(?:\.br)?|mercadolibre\.com(?:\.[a-z]{2})?)$/i.test(parsed.hostname)) return false;
    return /^\/sec\/[^/]+/i.test(parsed.pathname) ||
      ["matt_tool", "matt_word", "matt_source", "matt_campaign"].some(key => parsed.searchParams.has(key));
  }

  function isAttributedAffiliateUrl(value, base, expectedId) {
    if (!isAffiliateUrl(value, base)) return false;
    const expected = productId(expectedId);
    if (!expected) return false;
    const parsed = new URL(value, base);
    const linkId = productIdFromUrl(value, base);
    if (linkId) return linkId === expected;
    if (productId(parsed.pathname) || hasItemIdQuery(parsed)) return false;
    const origin = parsed.searchParams.get("origin_url");
    return !!origin && isProductUrl(origin, base) && productIdFromUrl(origin, base) === expected;
  }

  function attributedCandidate(rootElement, base, expectedId) {
    return candidatesFrom(rootElement, base).find(candidate => isAttributedAffiliateUrl(candidate.url, base, expectedId)) || null;
  }

  function attrs(element) {
    return Object.fromEntries(Array.from(element.attributes || [], attribute => [attribute.name, attribute.value]));
  }

  function elementText(element) {
    return clean(element?.innerText || element?.textContent || "");
  }

  function linksIn(element, base) {
    return Array.from(element.querySelectorAll("a[href]"), link => ({
      text: elementText(link),
      href: absoluteUrl(link.getAttribute("href"), base),
      attributes: attrs(link)
    }));
  }

  function scoreContainer(element) {
    const descriptor = `${element.tagName} ${element.className || ""} ${element.getAttribute("data-testid") || ""}`;
    let score = /^(LI|ARTICLE)$/i.test(element.tagName) ? 3 : 0;
    if (/(?:card|product|item|result|offer|produto)/i.test(descriptor)) score += 3;
    if (element.querySelector("img")) score += 1;
    if (Array.from(element.querySelectorAll("button, [role='button']")).some(control => SHARE_WORDS.test(labelOf(control)))) score += 4;
    if (/(?:R\$|\$)\s*[\d.,]+/.test(elementText(element))) score += 1;
    const textLength = elementText(element).length;
    if (textLength > 5000) score -= 5;
    if (element.querySelectorAll("a[href]").length > 12) score -= 3;
    return score;
  }

  function cardFor(anchor) {
    let node = anchor;
    let best = null;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      const score = scoreContainer(node);
      if (score >= 3 && (!best || score > best.score || (score === best.score && depth < best.depth))) {
        best = { element: node, score, depth };
      }
    }
    return best?.element || anchor.parentElement || anchor;
  }

  function findCards(doc, base) {
    const hubCards = Array.from(doc.querySelectorAll("li.poly-card"));
    if (hubCards.length) {
      const seenHub = new Set();
      return hubCards.flatMap(element => {
        const anchor = element.querySelector("a.poly-component__title[href]") ||
          Array.from(element.querySelectorAll("a[href]")).find(link => isProductUrl(link.getAttribute("href"), base));
        if (!anchor) return [];
        const href = absoluteUrl(anchor.getAttribute("href"), base);
        if (!href) return [];
        const id = productId(element.querySelector("input[data-testid='form-data-id']")?.value) || productId(href);
        const key = id || new URL(href).origin + new URL(href).pathname;
        if (seenHub.has(key)) return [];
        seenHub.add(key);
        return [{ element, anchor, href, id }];
      });
    }
    const seen = new Set();
    const cards = [];
    for (const anchor of doc.querySelectorAll("a[href]")) {
      if (!isProductUrl(anchor.getAttribute("href"), base)) continue;
      const href = absoluteUrl(anchor.getAttribute("href"), base);
      const id = productId(href);
      const key = id || new URL(href).origin + new URL(href).pathname;
      if (seen.has(key)) continue;
      const element = cardFor(anchor);
      if (elementText(element).length > 8000 || element.querySelectorAll("a[href]").length > 25) continue;
      seen.add(key);
      cards.push({ element, anchor, href, id });
    }
    return cards;
  }

  function labelOf(element) {
    return clean([elementText(element), element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" "));
  }

  function shareControl(card) {
    const hubButton = card.querySelector("[data-testid='form-action'] button[type='submit']");
    if (hubButton && SHARE_WORDS.test(labelOf(hubButton))) return hubButton;
    const controls = card.querySelectorAll("button, [role='button'], a[href], input[type='button']");
    return Array.from(controls).find(control => SHARE_WORDS.test(labelOf(control)) &&
      !isProductUrl(control.getAttribute("href"), document.baseURI));
  }

  function parseMoneyAmount(element) {
    if (!element) return null;
    const fraction = clean(element.querySelector(".andes-money-amount__fraction")?.textContent).replace(/\D/g, "");
    const cents = clean(element.querySelector(".andes-money-amount__cents")?.textContent).replace(/\D/g, "");
    const symbol = clean(element.querySelector(".andes-money-amount__currency-symbol")?.textContent);
    if (!fraction || (cents && cents.length > 2)) return null;
    const amount = Number(fraction) + Number(cents || 0) / 100;
    if (!Number.isFinite(amount)) return null;
    return { amount: Math.round(amount * 100) / 100, currency: symbol === "R$" ? "BRL" : null };
  }

  function extractPricing(card) {
    const currentElement = card.querySelector(".poly-price__current .andes-money-amount, .poly-price__amount");
    const originalElement = card.querySelector(".poly-price__previous.andes-money-amount, .poly-price__previous .andes-money-amount");
    const current = parseMoneyAmount(currentElement);
    const original = parseMoneyAmount(originalElement);
    const discountLabel = elementText(card.querySelector(".poly-price__disc-label, .andes-money-amount__discount")) || null;
    const discountMatch = discountLabel?.match(/(\d{1,3}(?:[,.]\d+)?)\s*%\s*(?:OFF|de desconto)/i);
    const discountPercent = discountMatch ? Number(discountMatch[1].replace(",", ".")) : null;
    const paymentElement = card.querySelector(".poly-price__installments");
    const paymentLabel = elementText(paymentElement);
    const paymentAmount = parseMoneyAmount(paymentElement?.querySelector(".andes-money-amount"));
    const installmentCount = Number(paymentLabel.match(/\b(\d{1,2})\s*x\b/i)?.[1]);
    const installment = paymentAmount && installmentCount > 0
      ? { count: installmentCount, amount: paymentAmount.amount, currency: paymentAmount.currency,
        interestFree: /\bsem juros\b/i.test(paymentLabel), label: paymentLabel }
      : null;
    const alternativePayment = paymentAmount && !installment && /\bem outros meios\b/i.test(paymentLabel)
      ? { amount: paymentAmount.amount, currency: paymentAmount.currency, label: paymentLabel }
      : null;
    const sameCurrency = current?.currency && current.currency === original?.currency;
    const hasDiscount = sameCurrency && original.amount > current.amount;
    return {
      currency: current?.currency || original?.currency || null,
      currentAmount: current?.amount ?? null,
      originalAmount: original?.amount ?? null,
      discountPercent,
      discountAmount: hasDiscount ? Math.round((original.amount - current.amount) * 100) / 100 : null,
      discountAmountSource: hasDiscount ? "derived_from_visible_prices" : null,
      discountLabel,
      installment,
      alternativePayment
    };
  }

  function extractCard(entry, position, base) {
    const { anchor, href, id } = entry;
    // Picker controls belong to the extension, not the captured page evidence.
    const element = entry.element;
    const pickerControls = Array.from(element.querySelectorAll("[data-affiliate-picker]"), control => ({
      control, parent: control.parentNode, next: control.nextSibling
    }));
    for (const { control } of pickerControls) control.remove();
    try {
      const text = elementText(element);
      const images = Array.from(element.querySelectorAll("img"), image => ({
        src: absoluteUrl(image.getAttribute("src") || image.getAttribute("data-src"), base),
        srcset: image.getAttribute("srcset") || null,
        alt: image.getAttribute("alt") || null,
        attributes: attrs(image)
      }));
      const heading = element.querySelector("h1, h2, h3, h4, [data-testid*='title'], [class*='title']");
      const title = elementText(heading) || elementText(anchor) || images.find(image => image.alt)?.alt || null;
      const priceMatches = Array.from(new Set([
        ...Array.from(element.querySelectorAll(".andes-money-amount[aria-label]"), price => clean(price.getAttribute("aria-label"))),
        ...[...text.matchAll(/(?:R\$|\$)\s*[\d.,]+/g)].map(match => match[0])
      ].filter(Boolean)));
      const commissionMatch = text.match(/(?:GANHOS(?:\s+EXTRAS?)?|COMISSÃO)\s*:?\s*([\d.,]+\s*%)|([\d.,]+\s*%)\s*(?:de\s+)?comissão/i);
      const buttons = Array.from(element.querySelectorAll("button, [role='button']"), button => ({
        text: labelOf(button), attributes: attrs(button)
      }));
      const inputs = Array.from(element.querySelectorAll("input, textarea"), input => ({
        value: input.value || null, attributes: attrs(input)
      }));
      return {
        position,
        productId: id,
        title,
        productUrl: href,
        commissionedUrl: null,
        commissionedUrlStatus: "not_attempted",
        commissionedUrlEvidence: null,
        visible: {
          description: Array.from(element.querySelectorAll(".poly-component__description, [data-testid='product-description'], [itemprop='description']"), elementText).filter(Boolean).join(" ") || null,
          prices: priceMatches,
          pricing: extractPricing(element),
          commissionPercent: commissionMatch?.[1] || commissionMatch?.[2] || null,
          text,
          images: images.map(({ src, alt }) => ({ src, alt }))
        },
        raw: {
          tagName: element.tagName,
          attributes: attrs(element),
          html: element.outerHTML,
          links: linksIn(element, base),
          images,
          buttons,
          inputs
        }
      };
    } finally {
      for (const { control, parent, next } of pickerControls) parent.insertBefore(control, next?.parentNode === parent ? next : null);
    }
  }

  function candidatesFrom(rootElement, base) {
    if (!rootElement) return [];
    const candidates = [];
    for (const element of [rootElement, ...rootElement.querySelectorAll("*")]) {
      const values = [element.value, ...Array.from(element.attributes || [], attribute => attribute.value)];
      for (const value of values) {
        const url = absoluteUrl(value, base);
        if (url && isAffiliateUrl(url, base)) candidates.push({ url, evidence: `${element.tagName.toLowerCase()} ${element.getAttribute("data-testid") || ""}`.trim() });
        if (typeof value === "string" && value.includes("http")) {
          for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
            const embeddedUrl = match[0].replace(/[),.;\\]+$/, "");
            if (isAffiliateUrl(embeddedUrl, base)) candidates.push({ url: embeddedUrl, evidence: `${element.tagName.toLowerCase()} attribute` });
          }
        }
      }
    }
    const text = elementText(rootElement);
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const url = match[0].replace(/[),.;]+$/, "");
      if (isAffiliateUrl(url, base)) candidates.push({ url, evidence: "visible text" });
    }
    return candidates;
  }

  function boundedShareResponse(value) {
    const fields = ["short_url", "long_url", "text", "type_url", "generated_date", "origin_url"];
    const response = {};
    for (const field of fields) {
      const item = value?.[field];
      if (typeof item === "string") response[field] = item.slice(0, 10000);
      else if (typeof item === "number" && Number.isFinite(item)) response[field] = item;
    }
    return response;
  }

  function normalizedOriginUrl(value) {
    if (typeof value !== "string") return null;
    const input = value.trim();
    const qualified = /^https:\/\//i.test(input) ? input :
      /^(?:[a-z0-9-]+\.)*mercadolivre\.com\.br\//i.test(input) ? `https://${input}` : null;
    if (!qualified) return null;
    try {
      const url = new URL(qualified);
      if (url.protocol !== "https:" || !/(?:^|\.)mercadolivre\.com\.br$/i.test(url.hostname) ||
          url.username || url.password) return null;
      url.hash = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function mlbuCatalogPath(value) {
    const normalized = normalizedOriginUrl(value);
    if (!normalized) return null;
    const url = new URL(normalized);
    return /\/up\/MLBU\d{6,}$/i.test(url.pathname) ? `${url.origin}${url.pathname}` : null;
  }

  function sameProductPath(left, right) {
    const first = normalizedOriginUrl(left);
    const second = normalizedOriginUrl(right);
    if (!first || !second) return false;
    const firstUrl = new URL(first);
    const secondUrl = new URL(second);
    if (firstUrl.origin !== secondUrl.origin || firstUrl.pathname !== secondUrl.pathname) return false;
    const variants = url => [...url.searchParams].filter(([key]) =>
      /^(?:variation_id|searchvariation)$/i.test(key)).map(([, value]) => value.trim()).filter(Boolean);
    const firstVariants = [...new Set(variants(firstUrl))];
    const secondVariants = [...new Set(variants(secondUrl))];
    return firstVariants.length <= 1 && secondVariants.length <= 1 &&
      (!firstVariants.length || !secondVariants.length || firstVariants[0] === secondVariants[0]);
  }

  function hookOriginMatchesCard(originUrl, productUrl, expected) {
    if (!sameProductPath(originUrl, productUrl)) return false;
    const card = new URL(normalizedOriginUrl(productUrl));
    const origin = new URL(normalizedOriginUrl(originUrl));
    return (!hasItemIdQuery(card) || productIdFromUrl(card.href, productUrl) === expected) &&
      (!hasItemIdQuery(origin) || productIdFromUrl(origin.href, productUrl) === expected);
  }

  function verifiedShareResponse(response, expectedId, expectedProductUrl, bridgeEvidence = null) {
    const expected = productId(expectedId);
    if (!expected || !response || typeof response !== "object") return null;
    if (!isAffiliateUrl(response.short_url, expectedProductUrl)) return null;
    const parsedShortUrl = new URL(response.short_url, expectedProductUrl);
    const linkedId = productIdFromUrl(response.short_url, expectedProductUrl);
    if (linkedId && linkedId !== expected) return null;
    if (!linkedId && hasItemIdQuery(parsedShortUrl)) return null;
    if (bridgeEvidence?.provenance === "react_hook") {
      if (!EXACT_PRODUCT_ID.test(String(bridgeEvidence.ownerItemId ?? "")) ||
          productId(bridgeEvidence.ownerItemId) !== expected ||
          !hookOriginMatchesCard(response.origin_url, expectedProductUrl, expected)) return null;
      return { url: response.short_url, share: boundedShareResponse(response),
        evidence: `Share response from current modal fiber for item ${expected}` };
    }
    if (bridgeEvidence?.provenance === "createLink_response") {
      const attribution = bridgeEvidence.attribution;
      const productLink = absoluteUrl(expectedProductUrl, expectedProductUrl);
      if (!productLink || !(isProductUrl(productLink, expectedProductUrl) || mlbuCatalogPath(productLink))) return null;
      const productLinkUrl = new URL(productLink);
      if (!EXACT_REQUEST_ITEM_ID.test(String(attribution?.requestItemId ?? "")) ||
          (hasItemIdQuery(productLinkUrl) && productIdFromUrl(productLink, expectedProductUrl) !== expected) ||
          !Array.isArray(attribution.requestUrls) || attribution.requestUrls.length !== 1 ||
          !sameProductPath(attribution.requestUrls[0], productLink)) return null;
      const requestItemId = String(attribution.requestItemId).replace(/[-\s]/g, "").toUpperCase();
      const submittedUrl = new URL(normalizedOriginUrl(attribution.requestUrls[0]));
      if (requestItemId === expected && hasItemIdQuery(submittedUrl) &&
          productIdFromUrl(attribution.requestUrls[0], expectedProductUrl) !== expected) return null;
      const addToList = attribution.requestItemAddToList == null ? null : productId(attribution.requestItemAddToList);
      const buyBoxWinner = attribution.requestBuyBoxWinner == null ? null : productId(attribution.requestBuyBoxWinner);
      if (attribution.requestItemAddToList != null &&
          (!EXACT_PRODUCT_ID.test(attribution.requestItemAddToList) || addToList !== expected)) return null;
      if (attribution.requestBuyBoxWinner != null &&
          (!EXACT_PRODUCT_ID.test(attribution.requestBuyBoxWinner) ||
            (buyBoxWinner !== expected && buyBoxWinner !== requestItemId))) return null;
      if (requestItemId !== expected) {
        if (addToList !== expected || attribution.requestUrls.length !== 1) return null;
        const urlItemId = productIdFromUrl(attribution.requestUrls[0], expectedProductUrl);
        const catalogPath = mlbuCatalogPath(attribution.requestUrls[0]);
        const cardCatalogPath = mlbuCatalogPath(expectedProductUrl);
        if (!(urlItemId === requestItemId ||
              (!urlItemId && catalogPath && catalogPath === cardCatalogPath))) return null;
      }
      const origin = normalizedOriginUrl(response.origin_url);
      const pairedOrigin = normalizedOriginUrl(attribution.matchedOriginUrl);
      if (!origin || origin !== pairedOrigin ||
          !attribution.requestUrls.some(url => normalizedOriginUrl(url) === origin)) return null;
      return { url: response.short_url, share: boundedShareResponse(response),
        evidence: `Captured createLink request and response for item ${expected}` };
    }
    if (!isProductUrl(response.origin_url, expectedProductUrl)) return null;
    if (productIdFromUrl(response.origin_url, expectedProductUrl) !== expected) return null;
    return { url: response.short_url, share: boundedShareResponse(response), evidence: `Share response with matching origin ${expected}` };
  }

  function requestPageShareState(expectedId, expectedProductUrl) {
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const timeout = setTimeout(() => finish(null), 700);
      function finish(result) {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(result);
      }
      function onMessage(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "affiliate-hub-exporter-page" ||
            message.type !== "share-state" || message.requestId !== requestId) return;
        if (productId(message.itemId) !== productId(expectedId)) return finish(null);
        const verified = verifiedShareResponse(message.share, expectedId, expectedProductUrl, message);
        finish(verified);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "affiliate-hub-exporter", type: "read-share-state", requestId,
        itemId: expectedId, productUrl: expectedProductUrl
      }, window.location.origin);
    });
  }

  function beginPageShareCapture(expectedId, expectedProductUrl) {
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const timeout = setTimeout(() => finish(false), 700);
      function finish(ready) {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve(ready);
      }
      function onMessage(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "affiliate-hub-exporter-page" ||
            message.type !== "share-capture-ready" || message.requestId !== requestId) return;
        finish(productId(message.itemId) === productId(expectedId) && message.ready === true);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "affiliate-hub-exporter", type: "begin-share-capture", requestId,
        itemId: expectedId, productUrl: expectedProductUrl
      }, window.location.origin);
    });
  }

  function findShareInFiber(hostFiber, expectedId, expectedProductUrl) {
    if (!hostFiber || !expectedId) return null;
    const expected = productId(expectedId);
    if (!expected) return null;
    let fiber = hostFiber;
    const visitedFibers = new Set();
    for (let depth = 0; fiber && depth < 100 && !visitedFibers.has(fiber); depth += 1, fiber = fiber.return) {
      visitedFibers.add(fiber);
      const ownerId = productId(fiber.memoizedProps?.dataToLink?.itemId);
      if (ownerId !== expected) continue;
      let hook = fiber.memoizedState;
      const visitedHooks = new Set();
      for (let hookIndex = 0; hook && hookIndex < 100 && !visitedHooks.has(hook); hookIndex += 1, hook = hook.next) {
        visitedHooks.add(hook);
        const response = hook.memoizedState;
        if (!response || typeof response !== "object") continue;
        const verified = verifiedShareResponse(response, expectedId, expectedProductUrl,
          { provenance: "react_hook", ownerItemId: expected });
        if (verified) return verified;
      }
    }
    return null;
  }

  function findShareInPageState(copyButton, expectedId, expectedProductUrl) {
    const candidates = [copyButton?.wrappedJSObject, copyButton];
    try {
      const pageButton = window.wrappedJSObject?.document?.getElementById("copy_link");
      if (pageButton) candidates.push(pageButton);
    } catch (_) { /* Firefox may block waived wrappers on this page. */ }
    for (const element of candidates) {
      if (!element) continue;
      try {
        const key = Object.keys(element).find(name => name.startsWith("__reactFiber$"));
        if (!key) continue;
        const found = findShareInFiber(element[key], expectedId, expectedProductUrl);
        if (found) return found;
      } catch (_) { /* A page wrapper may reject property access. */ }
    }
    return null;
  }

  function visibleDialogs(doc) {
    return Array.from(doc.querySelectorAll("[role='dialog'], dialog, [aria-modal='true'], [class*='modal'], [class*='popover']"))
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function entryKey(entry) {
    if (entry.id) return entry.id;
    const url = new URL(entry.href);
    return `${url.origin}${url.pathname}`;
  }

  async function discoverCards(limit, operations, maxScrollAttempts = Math.min(500, Math.max(40, limit * 4))) {
    const END_QUIET_MS = 6000;
    const seen = new Set();
    const cards = [];
    let scrollAttempts = 0;
    let endChecks = 0;
    let endQuietMs = 0;
    let lastEndSignature = null;
    let lastWaitMs = 0;
    let stalledChecks = 0;
    let stopReason = "safety_limit";
    try {
      await operations.prepare();
      while (true) {
        const interrupted = operations.stopReason?.();
        if (interrupted) { stopReason = interrupted; break; }
        const entries = operations.find();
        const newlySeen = [];
        for (const entry of entries) {
          const key = operations.key(entry);
          if (seen.has(key)) continue;
          seen.add(key);
          newlySeen.push({ entry, key });
        }
        for (const { entry, key } of newlySeen) {
          if (cards.length >= limit || operations.stopReason?.()) break;
          const card = operations.snapshot(entry, cards.length + 1);
          if (operations.matches && !operations.matches(card)) continue;
          cards.push(card);
          await operations.resolve(entry, key, card);
          operations.progress?.({ matchedCards: cards.length, uniqueSeen: seen.size, scrollAttempts });
        }
        if (cards.length >= limit) {
          stopReason = "requested_limit";
          break;
        }
        operations.progress?.({ matchedCards: cards.length, uniqueSeen: seen.size, scrollAttempts });
        const interruptedAfterScan = operations.stopReason?.();
        if (interruptedAfterScan) { stopReason = interruptedAfterScan; break; }
        if (scrollAttempts >= maxScrollAttempts) break;
        const step = operations.scroll(entries);
        scrollAttempts += 1;
        if (newlySeen.length || step.moved) {
          endChecks = 0;
          endQuietMs = 0;
          lastEndSignature = null;
          stalledChecks = 0;
        }
        if (step.atEnd && !step.moved) {
          const signature = String(step.signature ?? "");
          if (!newlySeen.length && lastEndSignature === signature) {
            endChecks += 1;
            endQuietMs += lastWaitMs;
          } else {
            endChecks = 0;
            endQuietMs = 0;
          }
          lastEndSignature = signature;
          if (step.endReached === true && endChecks >= 2) {
            stopReason = "end_reached";
            break;
          }
          if (endQuietMs >= END_QUIET_MS) {
            stopReason = "loading_timeout";
            break;
          }
        } else if (!step.moved) {
          stalledChecks += 1;
          if (stalledChecks >= 3) {
            stopReason = "stalled";
            break;
          }
        }
        const beforeWait = Date.now();
        const waitResult = await operations.wait(step);
        lastWaitMs = Number.isFinite(waitResult?.elapsedMs)
          ? Math.max(0, waitResult.elapsedMs) : Math.max(0, Date.now() - beforeWait);
      }
    } finally {
      operations.restore();
    }
    return { cards, discovery: { stopReason, uniqueSeen: seen.size, scrollAttempts } };
  }

  function createScrollController(doc, browserWindow) {
    const saved = new Map();
    const root = doc.scrollingElement || doc.documentElement;
    function remember(target) {
      if (!target || saved.has(target)) return;
      saved.set(target, { top: target.scrollTop || 0, left: target.scrollLeft || 0 });
    }
    function targets(element) {
      const found = [];
      const hub = element ? null : doc.querySelector("#recommendations_column, [data-testid*='recommend']");
      for (let parent = element?.parentElement || hub; parent && parent !== doc.documentElement; parent = parent.parentElement) {
        const style = browserWindow.getComputedStyle(parent);
        if (parent.scrollHeight > parent.clientHeight + 2 && /auto|scroll|overlay|hidden/i.test(style.overflowY)) found.push(parent);
      }
      if (root && !found.includes(root)) found.push(root);
      return found;
    }
    function move(target, top) {
      remember(target);
      if (target === root) browserWindow.scrollTo(target.scrollLeft || 0, top);
      else target.scrollTop = top;
    }
    return {
      async prepare(entries) {
        const relevant = targets(entries[0]?.element);
        for (const target of relevant.slice().reverse()) move(target, 0);
        await sleep(250);
      },
      scroll(entries) {
        const relevant = targets(entries.at(-1)?.element);
        for (const target of relevant) {
          const before = target.scrollTop || 0;
          const max = Math.max(0, target.scrollHeight - target.clientHeight);
          const step = Math.max(500, Math.floor(target.clientHeight * 0.85));
          const next = Math.min(max, before + step);
          if (next > before + 1) {
            move(target, next);
            return { moved: true, atEnd: false };
          }
        }
        const hub = doc.querySelector("#recommendations_column");
        const signature = JSON.stringify({
          scroll: relevant.map(target => [target.scrollTop, target.scrollHeight, target.clientHeight]),
          cards: doc.querySelectorAll("li.poly-card").length,
          children: hub?.childElementCount ?? null,
          busy: hub?.getAttribute("aria-busy") ?? null
        });
        const busy = hub?.getAttribute("aria-busy") === "true";
        const endReached = !busy && Array.from(doc.querySelectorAll(
          '[data-testid="end-of-results"], [data-testid="no-more-results"]')).some(marker => {
          if (!marker.getClientRects().length) return false;
          for (let node = marker; node; node = node.parentElement) {
            const style = browserWindow.getComputedStyle(node);
            if (style.display === "none" || /hidden|collapse/i.test(style.visibility) ||
                Number(style.opacity) === 0 || node.hasAttribute?.("hidden") ||
                node.getAttribute?.("aria-hidden") === "true" ||
                node.getAttribute?.("aria-busy") === "true") return false;
          }
          return true;
        });
        return { moved: false, atEnd: true, signature, endReached };
      },
      restore() {
        for (const [target, offset] of Array.from(saved).reverse()) {
          if (target === root) browserWindow.scrollTo(offset.left, offset.top);
          else {
            target.scrollLeft = offset.left;
            target.scrollTop = offset.top;
          }
        }
      }
    };
  }

  async function readClipboard() {
    try { return clean(await navigator.clipboard.readText()); }
    catch (_) { return null; }
  }

  function modalForShare(doc) {
    return visibleDialogs(doc).find(dialog => /Compartilhe para ganhar dinheiro|Copiar link/i.test(elementText(dialog))) || null;
  }

  function closeShareModal(modal) {
    const close = Array.from(modal.querySelectorAll("button, [role='button']"))
      .find(button => /^(?:fechar|close|×|✕)$/i.test(labelOf(button)) ||
        /close|fechar/i.test(`${button.getAttribute("aria-label") || ""} ${button.className || ""}`));
    if (close) close.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  async function resolveShareLinkOnce(entry, card, base) {
    const existing = attributedCandidate(entry.element, base, card.productId);
    if (existing) return { status: "present_on_card", ...existing };

    const control = shareControl(entry.element);
    if (!control) return { status: "share_control_missing", url: null, evidence: null };
    let sawUnverifiedLink = candidatesFrom(entry.element, base).length > 0;
    const clipboardBefore = await readClipboard();
    const captureReady = await beginPageShareCapture(card.productId, card.productUrl);
    control.click();
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const roots = visibleDialogs(document);
      for (const dialog of roots) {
        const found = attributedCandidate(dialog, base, card.productId);
        if (found) {
          closeShareModal(dialog);
          return { status: "generated", ...found };
        }
        if (candidatesFrom(dialog, base).length) sawUnverifiedLink = true;
      }
      const cardCandidate = attributedCandidate(entry.element, base, card.productId);
      if (cardCandidate) {
        const modal = modalForShare(document);
        if (modal) closeShareModal(modal);
        return { status: "generated", ...cardCandidate };
      }
      const modal = modalForShare(document);
      if (modal) {
        const copy = Array.from(modal.querySelectorAll("button, [role='button']"))
          .find(button => /copiar link/i.test(labelOf(button)));
        if (copy) {
          const pageState = findShareInPageState(copy, card.productId, card.productUrl) ||
            await requestPageShareState(card.productId, card.productUrl);
          if (pageState) {
            closeShareModal(modal);
            return { status: "generated_from_page_state", ...pageState };
          }
          let copyEventValue = null;
          const onCopy = event => { copyEventValue = event.clipboardData?.getData("text/plain") || null; };
          document.addEventListener("copy", onCopy);
          try {
            copy.click();
            for (let attempt = 0; attempt < 8; attempt += 1) {
              await sleep(150);
              const afterClickCandidate = attributedCandidate(modal, base, card.productId);
              if (afterClickCandidate) {
                closeShareModal(modal);
                return { status: "generated", ...afterClickCandidate };
              }
              const refreshedPageState = await requestPageShareState(card.productId, card.productUrl);
              if (refreshedPageState) {
                closeShareModal(modal);
                return { status: "generated_from_page_state", ...refreshedPageState };
              }
              if (copyEventValue && isAttributedAffiliateUrl(copyEventValue, base, card.productId)) {
                closeShareModal(modal);
                return { status: "generated_from_copy_event", url: copyEventValue, evidence: "Copiar link" };
              }
              const clipboardAfter = await readClipboard();
              if (clipboardAfter && clipboardAfter !== clipboardBefore && isAttributedAffiliateUrl(clipboardAfter, base, card.productId)) {
                closeShareModal(modal);
                return { status: "generated_from_clipboard", url: clipboardAfter, evidence: "Copiar link" };
              }
              if (candidatesFrom(modal, base).length || isAffiliateUrl(copyEventValue, base) ||
                  (clipboardAfter !== clipboardBefore && isAffiliateUrl(clipboardAfter, base))) sawUnverifiedLink = true;
            }
          } finally {
            document.removeEventListener("copy", onCopy);
          }
          closeShareModal(modal);
          return { status: sawUnverifiedLink ? "link_unverified" : !captureReady ? "capture_not_ready" :
            clipboardBefore === null ? "clipboard_read_denied" : "clipboard_unchanged", url: null, evidence: "Copiar link" };
        }
      }
      await sleep(150);
    }
    return { status: sawUnverifiedLink ? "link_unverified" : !captureReady ? "capture_not_ready" :
      "link_not_exposed", url: null, evidence: labelOf(control) };
  }

  async function withOneShareRetry(run, reset) {
    async function safeRun() {
      try { return await run(); }
      catch (error) { return { status: "share_error", url: null, evidence: clean(error?.message || error) }; }
    }
    const first = await safeRun();
    if (!["clipboard_unchanged", "capture_not_ready", "link_not_exposed", "share_error"].includes(first.status)) return first;
    if (!(await reset())) return { status: "retry_modal_timeout", url: null,
      evidence: first.evidence ? `${first.evidence}; modal permaneceu aberto após 2 s` :
        "Modal permaneceu aberto após 2 s" };
    const second = await safeRun();
    return { ...second, evidence: second.evidence ? `${second.evidence}; segunda tentativa` : "segunda tentativa" };
  }

  async function resolveShareLink(entry, card, base) {
    return withOneShareRetry(() => resolveShareLinkOnce(entry, card, base), async () => {
      const remainingModal = modalForShare(document);
      if (remainingModal) closeShareModal(remainingModal);
      for (let attempt = 0; attempt < 20 && modalForShare(document); attempt += 1) await sleep(100);
      if (modalForShare(document)) return false;
      await sleep(150);
      return true;
    });
  }

  function normalizeKeyword(value) {
    return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }

  function normalizeSearch(options = {}) {
    const input = options.keywords ?? options.keyword ?? "";
    const values = Array.isArray(input) ? input : [input];
    if (values.some(value => typeof value !== "string")) throw new Error("Informe palavras-chave como texto.");
    if (values.join(",").length > 4200) throw new Error("Use até 20 frases de até 200 caracteres cada.");
    const matchMode = options.matchMode ?? "any";
    if (!["any", "all"].includes(matchMode)) throw new Error("Escolha qualquer frase (ANY) ou todas as frases (ALL).");
    const matchStyle = options.matchStyle ?? "substring";
    if (!["substring", "word"].includes(matchStyle)) throw new Error("Escolha correspondência por trecho ou palavra inteira.");
    const keywords = [];
    const seen = new Set();
    for (const value of values.flatMap(value => value.split(/[,\r\n]+/))) {
      const keyword = clean(value);
      if (!keyword) continue;
      if (keyword.length > 200) throw new Error("Cada frase deve ter até 200 caracteres.");
      const normalized = normalizeKeyword(keyword);
      if (seen.has(normalized)) continue;
      seen.add(normalized); keywords.push(keyword);
      if (keywords.length > 20) throw new Error("Use até 20 frases diferentes.");
    }
    return { keyword: keywords.join(", "), keywords, matchMode, matchStyle, ...normalizeEligibility(options),
      comparisonMode: `accent_case_insensitive_visible_text_${matchStyle}`, targetScope: "combined_unique_products",
      keywordCountPopulation: "exported_unique_cards", keywordMatchedCounts: Object.fromEntries(keywords.map(keyword => [keyword, 0])) };
  }

  function normalizeCommissionFilters(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Filtro de comissão inválido.");
    const filters = {};
    for (const [name, maximum] of [["minPercent", 100], ["maxPercent", 100], ["minEstimatedBrl", Infinity]]) {
      filters[name] = optionalThreshold(input[name], maximum, name === "minEstimatedBrl" ? "comissão estimada (R$)" : "comissão percentual (%)");
    }
    if (filters.minPercent !== null && filters.maxPercent !== null && filters.minPercent > filters.maxPercent) throw new Error("A comissão mínima não pode superar a máxima.");
    return filters;
  }
  function parsePreset(input, fallbackLimit = 10) {
    if (typeof input === "string") {
      if (input.length > 32768) throw new Error("O preset deve ter até 32.768 caracteres.");
      try { input = JSON.parse(input); } catch (_) { throw new Error("JSON de preset inválido."); }
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Informe um objeto de preset v1.");
    if ((input.version ?? input.schemaVersion) !== 1 || (input.version != null && input.version !== 1) || (input.schemaVersion != null && input.schemaVersion !== 1)) throw new Error("Versão de preset não suportada. Use v1.");
    if (input.keywords == null && input.keyword == null) throw new Error("O preset precisa conter keywords ou keyword.");
    const limit = input.limit ?? fallbackLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Informe de 1 a 500 produtos no preset.");
    const allowed = new Set(["version", "schemaVersion", "schema", "type", "kind", "id", "name", "label", "title", "description", "source", "createdAt", "audience", "date", "keyword", "keywords", "matchMode", "matchStyle", "limit", "commission", "excludePolitical", "minPrice", "maxPrice", "minCommissionPercent", "minEstimatedCommission"]);
    for (const name of Object.keys(input)) if (!allowed.has(name)) throw new Error(`Campo de preset não suportado: ${name}.`);
    if (input.commission && Object.keys(input.commission).some(name => !["minPercent", "maxPercent", "minEstimatedBrl"].includes(name))) throw new Error("Campo de comissão do preset não suportado.");
    const search = normalizeSearch(input);
    return { version: 1, keyword: search.keyword, keywords: search.keywords, matchMode: search.matchMode, matchStyle: search.matchStyle, limit, ...normalizeEligibility(search) };
  }
  function optionalThreshold(raw, maximum, label) {
    const value = raw == null || (typeof raw === "string" && raw.trim() === "") ? null : (typeof raw === "number" || typeof raw === "string") ? Number(raw) : NaN;
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > maximum)) throw new Error(`Informe ${label} não negativa${maximum === 100 ? " e de até 100" : ""}.`);
    return value;
  }
  function normalizeEligibility(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Filtros de produto inválidos.");
    if (options.excludePolitical != null && typeof options.excludePolitical !== "boolean") throw new Error("excludePolitical deve ser booleano.");
    const commission = normalizeCommissionFilters(options.commission);
    const minPrice = optionalThreshold(options.minPrice, Infinity, "preço mínimo (R$)");
    const maxPrice = optionalThreshold(options.maxPrice, Infinity, "preço máximo (R$)");
    const strongestMinimum = (a, b) => a === null ? b : b === null ? a : Math.max(a, b);
    const minCommissionPercent = strongestMinimum(optionalThreshold(options.minCommissionPercent, 100, "comissão percentual (%)"), commission.minPercent);
    const minEstimatedCommission = strongestMinimum(optionalThreshold(options.minEstimatedCommission, Infinity, "comissão estimada (R$)"), commission.minEstimatedBrl);
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new Error("O preço mínimo não pode superar o máximo.");
    return { excludePolitical: options.excludePolitical ?? false, minPrice, maxPrice, minCommissionPercent, minEstimatedCommission,
      commission: normalizeCommissionFilters({ ...commission, minPercent: minCommissionPercent, minEstimatedBrl: minEstimatedCommission }) };
  }

  // A finite, explicit content vocabulary, never seller/buyer metadata or bare ambiguous names.
  const politicalTerms = ["luiz inacio lula da silva", "jair bolsonaro", "flavio bolsonaro", "eduardo bolsonaro", "dilma rousseff", "fernando haddad", "ciro gomes", "marina silva", "geraldo alckmin", "michel temer", "sergio moro", "guilherme boulos", "tabata amaral", "pablo marcal",
    "partido dos trabalhadores", "partido liberal", "partido socialista brasileiro", "partido da social democracia brasileira", "partido socialismo e liberdade", "movimento democratico brasileiro", "uniao brasil",
    "campanha eleitoral", "propaganda eleitoral", "candidato a presidente", "candidata a presidente", "bolsonarismo", "lulismo", "petismo", "bolsonarista", "lulista", "petista", "fora lula", "fora bolsonaro", "faz o l"];
  // This exported detector is also the backend's source of truth. Do not add a
  // second backend vocabulary: preserve field boundaries and ambiguous uses.
  const explicitPolitical = /(?<![\p{L}\p{N}])(?:politic[ao]s?|eleic(?:ao|oes)|eleitoral|bolsonaro|bolsonaristas?|lulistas?|petistas?|haddad|fernando henrique cardoso|alexandre de moraes|trump|milei|joe biden|impeachment|comunismo|comunistas?|fascismo|socialismo)(?![\p{L}\p{N}])/u;
  const lulaContext = /\blula(?:[\s,.:;!?-]+[\p{L}\p{N}]+){0,3}[\s,.:;!?-]+(?:presidente|presidencial|governo|pt|ladrao)\b|\b(?:presidente|presidencial|governo|voto|vote|fora|faz o l|pt)(?:[\s,.:;!?-]+[\p{L}\p{N}]+){0,3}[\s,.:;!?-]+lula\b/u;
  function politicalMention(card) {
    const fields = [["title", card.title], ["description", card.description], ["visible.description", card.visible?.description]];
    for (const [sourceField, value] of fields) {
      if (typeof value !== "string") continue;
      const text = normalizeKeyword(value).replace(/\bpolitica de (?:privacidade|trocas?|devoluc(?:ao|oes)|garantia|frete|reembolso)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const term = politicalTerms.find(term => (` ${text} `).includes(` ${term} `));
      const context = text.match(/\b(?:lula|bolsonaro|dilma|haddad|boulos|marcal) (?:para )?(?:presidente|governador|governadora|prefeito|prefeita|deputado|deputada|senador|senadora)\b|\b(?:presidente|governador|governadora|prefeito|prefeita|deputado|deputada|senador|senadora|vote em|voto em) (?:lula|bolsonaro|dilma|haddad|boulos|marcal)\b|\beleicoes (?:19|20)\d{2}\b/);
      const explicit = text.match(explicitPolitical) || text.match(lulaContext);
      const merchandise = /\b(?:camiseta|camisa|caneca|adesivo|bandeira|botton|bone)\b/u.test(text);
      const culinary = /\b(?:isca|pesca|receita|empanad[ao]s?|molho|congelad[ao]s?|frutos do mar|conservantes|unidades)\b/u.test(text);
      const slogan = text.match(/\blula (?:livre|13)\b/u);
      if (term || context || explicit || (slogan && !culinary && (merchandise || /^(?:lula livre|lula 13)$/u.test(text))))
        return { sourceField, term: term || context?.[0] || explicit?.[0] || slogan[0] };
      if (merchandise && /\bmst\b/u.test(text)) return { sourceField, term: "mst" };
    }
    return null;
  }
  function commissionEvidence(card) {
    const raw = card.visible?.commissionPercent;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+(?:[.,]\d+)?\s*%?\s*$/.test(raw) ? Number(raw.replace("%", "").trim().replace(",", ".")) : NaN;
    const percent = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
    const pricing = card.visible?.pricing;
    const current = pricing?.currentAmount;
    const priceBrl = typeof current === "number" && Number.isFinite(current) && current >= 0 && pricing.currency === "BRL" ? current : null;
    const estimate = percent !== null && priceBrl !== null ? Math.round(priceBrl * percent + Number.EPSILON) / 100 : null;
    return { percent, priceBrl, estimatedBrl: Number.isFinite(estimate) ? estimate : null,
      basis: "visible_current_price_times_displayed_percent", guaranteed: false };
  }
  function commissionQualification(card, filters = {}) {
    const evidence = commissionEvidence(card);
    const active = [filters.minPercent, filters.maxPercent, filters.minEstimatedBrl].some(value => value != null);
    if (!active) return { matches: true, reason: "unfiltered", evidence };
    if (evidence.percent === null) return { matches: false, reason: "missing_commission", evidence };
    if (filters.minEstimatedBrl != null && evidence.estimatedBrl === null) return { matches: false, reason: "missing_price", evidence };
    const matches = (filters.minPercent == null || evidence.percent >= filters.minPercent) && (filters.maxPercent == null || evidence.percent <= filters.maxPercent) && (filters.minEstimatedBrl == null || evidence.estimatedBrl >= filters.minEstimatedBrl);
    return { matches, reason: matches ? "qualified" : "outside_range", evidence };
  }
  function eligibilityQualification(card, filters = {}) {
    const evidence = commissionEvidence(card);
    const political = filters.excludePolitical ? politicalMention(card) : null;
    if (political) return { matches: false, reason: "political_content", evidence, political };
    if ((filters.minPrice != null || filters.maxPrice != null) && evidence.priceBrl === null) return { matches: false, reason: "missing_price", evidence };
    if ((filters.minPrice != null && evidence.priceBrl < filters.minPrice) || (filters.maxPrice != null && evidence.priceBrl > filters.maxPrice)) return { matches: false, reason: "outside_range", evidence };
    return commissionQualification(card, { ...filters.commission, minPercent: filters.minCommissionPercent ?? filters.commission?.minPercent, minEstimatedBrl: filters.minEstimatedCommission ?? filters.commission?.minEstimatedBrl });
  }

  function matchedKeywords(card, search) {
    return search.keywords.filter(keyword => matchesKeyword(card, keyword, search.matchStyle));
  }

  function matchesSearch(card, search) {
    const matched = matchedKeywords(card, search);
    return (!search.keywords.length || (search.matchMode === "all" ? matched.length === search.keywords.length : matched.length > 0)) && eligibilityQualification(card, search).matches;
  }

  function matchesKeyword(card, keyword, matchStyle = "substring") {
    // Preserve the original single-phrase helper, including literal commas.
    const text = normalizeKeyword(`${card.title || ""} ${card.visible?.text || ""}`);
    const phrase = normalizeKeyword(keyword);
    if (matchStyle === "substring") return text.includes(phrase);
    if (matchStyle !== "word") throw new Error("Estilo de correspondência inválido.");
    const words = value => value.match(/[\p{L}\p{N}]+/gu)?.join(" ") || "";
    const tokens = words(phrase);
    return !!tokens && (` ${words(text)} `).includes(` ${tokens} `);
  }

  async function resolveCard(entry, card, base) {
    try {
      const liveEntry = entry.element.isConnected === false
        ? findCards(document, base).find(candidate => entryKey(candidate) === entryKey(entry)) : entry;
      if (!liveEntry) { card.commissionedUrlStatus = "card_detached_before_share"; return card; }
      const result = await resolveShareLink(liveEntry, card, base);
      card.commissionedUrl = result.url || null;
      card.commissionedUrlStatus = result.status;
      card.commissionedUrlEvidence = result.evidence || null;
      if (result.share) card.raw.share = result.share;
    } catch (error) {
      card.commissionedUrlStatus = "share_error";
      card.commissionedUrlEvidence = clean(error?.message || error);
    }
    return card;
  }

  function marketplaceSignals(text) {
    if (!text) return undefined;
    const ratingMatch = text.match(/classifica[cç][aã]o\s*(\d(?:[.,]\d+)?)\s*de\s*5\s*estrelas/i)
      || text.match(/(?:^|\s)([0-4][.,]\d|5(?:[.,]0)?)\s*\|\s*\+?[\d.,]+\s*(?:milh(?:ão|ões|ao|oes)|mil|k)?\s+(?:produtos?\s+)?vendidos\b/i);
    const soldMatch = text.match(/(?:mais de\s*)?\+?([\d.,]+)\s*(milh(?:ão|ões|ao|oes)|mil|k)?\s+(?:produtos?\s+)?vendidos\b/i);
    const rating = ratingMatch ? Number(ratingMatch[1].replace(',', '.')) : undefined;
    const rawCount = soldMatch?.[1];
    const scaledCount = rawCount && soldMatch?.[2]
      ? Number((/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(rawCount) ? rawCount.replace(/\./g, '') : rawCount).replace(',', '.'))
      : rawCount ? Number(rawCount.replace(/\./g, '').replace(',', '.')) : undefined;
    const multiplier = !soldMatch?.[2] ? 1 : /^milh/i.test(soldMatch[2]) ? 1000000 : 1000;
    const soldCount = scaledCount === undefined ? undefined : scaledCount * multiplier;
    const bestSeller = /\bmais vendidos?\b/i.test(text);
    const timeLimited = /oferta rel[aâ]mpago|termina em\s+\d{1,2}:\d{2}|restam\s+\d+\s*(?:minutos?|horas?)/i.test(text);
    if (rating === undefined && soldCount === undefined && !bestSeller && !timeLimited) return undefined;
    return {
      ...(bestSeller ? { bestSeller: true } : {}), ...(timeLimited ? { timeLimited: true } : {}),
      ...(rating !== undefined && Number.isFinite(rating) && rating <= 5 ? { rating } : {}),
      ...(soldCount !== undefined && Number.isSafeInteger(soldCount) ? { soldCount, soldCountIsLowerBound: /mais de|\+|mil|k/i.test(soldMatch?.[0] || '') } : {})
    };
  }

  function normalizeDailyQuality(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" || Array.isArray(value) || !Number.isFinite(value.minRating) || value.minRating < 0 || value.minRating > 5 || !Number.isSafeInteger(value.minSoldCount) || value.minSoldCount < 1 || value.minSoldCount > 1000000) {
      throw new Error("A qualidade diária exige nota entre 0 e 5 e vendas mínimas entre 1 e 1000000.");
    }
    return { minRating: value.minRating, minSoldCount: value.minSoldCount };
  }

  function normalizeExcludedProductIds(values = []) {
    if (!Array.isArray(values) || values.length > 50000 || values.some(value => typeof value !== "string" || !/^(?:MLBU|MLB)\d{6,}$/i.test(value.replace(/[-\s]/g, "")))) {
      throw new Error("As exclusões devem conter até 50000 IDs de produtos Mercado Livre válidos.");
    }
    return new Set(values.map(value => value.replace(/[-\s]/g, "").toUpperCase()));
  }

  async function collect(options = {}) {
    const base = document.baseURI;
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("O limite deve ser um inteiro entre 1 e 500.");
    if (!/(?:^|\.)(?:mercadolivre\.com\.br|mercadolibre\.com(?:\.[a-z]{2})?)$/i.test(location.hostname)) {
      throw new Error("Abra o hub de afiliados do Mercado Livre nesta aba.");
    }
    const search = normalizeSearch(options);
    const excludedProductIds = normalizeExcludedProductIds(options.excludeProductIds);
    const quality = normalizeDailyQuality(options.quality);
    let qualityRejected = 0;
    let excludedPreviouslyUsed = 0;
    const counts = { ...search.keywordMatchedCounts };
    const commissionCounts = { population: "examined_unique_snapshots_matching_keywords", examined: 0, qualified: 0, missing_commission: 0, missing_price: 0, outside_range: 0 };
    const eligibilityCounts = { ...commissionCounts, political_content: 0 };
    const deadline = Date.now() + 10 * 60 * 1000;
    const scroller = createScrollController(document, window);
    const discovered = await discoverCards(limit, {
      prepare: () => scroller.prepare(findCards(document, base)),
      find: () => findCards(document, base),
      key: entryKey,
      snapshot: (entry, position) => extractCard(entry, position, base),
      resolve: (entry, key, card) => resolveCard(entry, card, base),
      matches(card) {
        if (excludedProductIds.has(String(card.productId || "").replace(/[-\s]/g, "").toUpperCase())) {
          excludedPreviouslyUsed += 1;
          return false;
        }
        const matched = matchedKeywords(card, search);
        if (search.keywords.length && (search.matchMode === "all" ? matched.length !== search.keywords.length : !matched.length)) return false;
        if (quality) {
          const signals = marketplaceSignals(card.visible?.text);
          if (signals?.rating === undefined || signals.rating < quality.minRating || signals.soldCount === undefined || signals.soldCount < quality.minSoldCount || signals.timeLimited) {
            qualityRejected += 1;
            return false;
          }
        }
        const commission = commissionQualification(card, search.commission);
        commissionCounts.examined += 1;
        commissionCounts[commission.matches ? "qualified" : commission.reason] += 1;
        const qualification = eligibilityQualification(card, search);
        eligibilityCounts.examined += 1;
        eligibilityCounts[qualification.matches ? "qualified" : qualification.reason] += 1;
        if (!qualification.matches) return false;
        card.commission = qualification.evidence;
        card.searchMatch = { keywords: matched, matchMode: search.matchMode, matchStyle: search.matchStyle, ...normalizeEligibility(search) };
        for (const keyword of matched) counts[keyword] += 1;
        return true;
      },
      progress: progress => options.onProgress?.({ ...progress, requestedLimit: limit,
        search: { ...search, keywordMatchedCounts: { ...counts }, commissionCounts: { ...commissionCounts }, eligibilityCounts: { ...eligibilityCounts } } }),
      stopReason: () => options.shouldCancel?.() ? "cancelled" : Date.now() >= deadline ? "time_limit" : null,
      scroll: entries => scroller.scroll(entries),
      wait: scroll => sleep(scroll.atEnd ? 1700 : 850),
      restore: () => scroller.restore()
    });
    const cards = discovered.cards;
    return {
      schemaVersion: 1,
      extractorVersion: "dom-v1",
      extractedAt: new Date().toISOString(),
      sourceUrl: location.href,
      requestedLimit: limit,
      search: { ...search, keywordMatchedCounts: { ...counts }, commissionCounts: { ...commissionCounts }, eligibilityCounts: { ...eligibilityCounts }, timeLimitMs: 600000 },
      discoveredCards: discovered.discovery.uniqueSeen,
      exportedCards: cards.length,
      excludedPreviouslyUsed,
      ...(quality ? { quality, qualityRejected } : {}),
      discovery: discovered.discovery,
      cards
    };
  }

  const api = { clean, absoluteUrl, isProductUrl, productId, productIdFromUrl, isAffiliateUrl, isAttributedAffiliateUrl,
    extractPricing, verifiedShareResponse, requestPageShareState, beginPageShareCapture, findCards, extractCard,
    discoverCards, createScrollController, withOneShareRetry, findShareInFiber, normalizeKeyword, normalizeSearch, normalizeCommissionFilters, normalizeEligibility, parsePreset, politicalMention, eligibilityQualification, commissionEvidence, commissionQualification, matchedKeywords, matchesSearch, matchesKeyword, resolveCard, marketplaceSignals, normalizeDailyQuality, normalizeExcludedProductIds, collect };
  root.AffiliateExtractor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
