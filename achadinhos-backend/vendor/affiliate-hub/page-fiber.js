/* Runs in the page's MAIN world to read the share response attached to React fibers. */
(function () {
  "use strict";
  if (window.__affiliateHubPageFiberBridge) return;
  window.__affiliateHubPageFiberBridge = true;

  const REQUEST_SOURCE = "affiliate-hub-exporter";
  const RESPONSE_SOURCE = "affiliate-hub-exporter-page";
  const PRODUCT_ID = /\b(?:MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}\b/i;
  const EXACT_PRODUCT_ID = /^(?:MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}$/i;
  const EXACT_REQUEST_ITEM_ID = /^(?:MLBU|MLB|MLA|MLM|MLU|MCO|MPE|MEC|MLC)[- ]?\d{6,}$/i;
  const SHARE_FIELDS = ["short_url", "long_url", "text", "type_url", "generated_date", "origin_url"];
  let activeCapture = null;
  let captureGeneration = 0;

  function productId(value) {
    const match = String(value ?? "").match(PRODUCT_ID);
    return match ? match[0].replace(/[- ]/, "").toUpperCase() : null;
  }

  function productIdFromUrl(value) {
    try {
      const url = new URL(value);
      const queryIds = [];
      for (const wid of url.searchParams.getAll("wid")) {
        if (!EXACT_PRODUCT_ID.test(wid)) return null;
        queryIds.push(productId(wid));
      }
      for (const filter of url.searchParams.getAll("pdp_filters")) {
        const itemFields = [...filter.matchAll(/(?:^|[|,;])item_id:([^|,;]*)/gi)];
        if (/item_id/i.test(filter) && !itemFields.length) return null;
        for (const [, itemId] of itemFields) {
          if (!EXACT_PRODUCT_ID.test(itemId)) return null;
          queryIds.push(productId(itemId));
        }
      }
      if (queryIds.length) return queryIds.every(id => id === queryIds[0]) ? queryIds[0] : null;
      return productId(url.pathname);
    } catch (_) {
      return null;
    }
  }

  function eligibleProductUrl(value, expectedId) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !/(?:^|\.)mercadolivre\.com\.br$/i.test(url.hostname) ||
          !/(?:MLB|MLBU)[- ]?\d{6,}/i.test(url.pathname)) return false;
      const hasItemId = url.searchParams.has("wid") ||
        url.searchParams.getAll("pdp_filters").some(filter => /item_id/i.test(filter));
      return !hasItemId || productIdFromUrl(value) === expectedId;
    } catch (_) {
      return false;
    }
  }

  function validShortUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        (url.hostname === "meli.la" ||
          ((url.hostname === "mercadolivre.com" || url.hostname === "www.mercadolivre.com") && url.pathname.startsWith("/sec/")));
    } catch (_) {
      return false;
    }
  }

  function allowlistedShare(value) {
    const share = {};
    for (const field of SHARE_FIELDS) {
      const item = value?.[field];
      if (typeof item === "string") share[field] = item.slice(0, 10000);
      else if (typeof item === "number" && Number.isFinite(item)) share[field] = item;
    }
    return share;
  }

  function isCreateLinkCall(url, body) {
    return /create[-_\s]*link/i.test(String(url || "")) || /create[-_\s]*link/i.test(String(body || ""));
  }

  function normalizedCatalogUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const raw = value.trim();
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.protocol !== "https:" || !/(?:^|\.)mercadolivre\.com\.br$/i.test(url.hostname)) return null;
      url.hash = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function sameProductPath(left, right) {
    const first = normalizedCatalogUrl(left);
    const second = normalizedCatalogUrl(right);
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

  function hasItemIdQuery(url) {
    return url.searchParams.has("wid") ||
      url.searchParams.getAll("pdp_filters").some(filter => /item_id/i.test(filter));
  }

  function hookOriginMatchesCard(origin, productUrl, expectedId) {
    if (!sameProductPath(origin, productUrl)) return false;
    const card = new URL(normalizedCatalogUrl(productUrl));
    const response = new URL(normalizedCatalogUrl(origin));
    return (!hasItemIdQuery(card) || productIdFromUrl(card.href) === expectedId) &&
      (!hasItemIdQuery(response) || productIdFromUrl(response.href) === expectedId);
  }

  function mlbuCatalogPath(value) {
    const normalized = normalizedCatalogUrl(value);
    if (!normalized) return null;
    const url = new URL(normalized);
    return /\/up\/MLBU\d{6,}$/i.test(url.pathname) ? `${url.origin}${url.pathname}` : null;
  }

  function requestAttribution(body, expectedId, expectedProductUrl) {
    let data = body;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) { return null; }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (!EXACT_REQUEST_ITEM_ID.test(String(data.itemId ?? ""))) return null;
    const requestItemId = String(data.itemId).replace(/[- ]/, "").toUpperCase();
    const itemAddToList = data.itemAddToList == null ? null : productId(data.itemAddToList);
    const buyBoxWinner = data.buyBoxWinner == null ? null : productId(data.buyBoxWinner);
    if (data.itemAddToList != null && (!EXACT_PRODUCT_ID.test(data.itemAddToList) || itemAddToList !== expectedId)) return null;
    if (data.buyBoxWinner != null && (!EXACT_PRODUCT_ID.test(data.buyBoxWinner) ||
        (buyBoxWinner !== expectedId && buyBoxWinner !== requestItemId))) return null;
    // The hub shares one card at a time. A batch cannot prove which URL belongs to itemId.
    if (!Array.isArray(data.urls) || data.urls.length !== 1) return null;
    const urls = data.urls.map(normalizedCatalogUrl);
    if (urls.some(url => !url)) return null;
    if (!sameProductPath(urls[0], expectedProductUrl)) return null;
    const submitted = new URL(urls[0]);
    const hasSubmittedItemId = submitted.searchParams.has("wid") ||
      submitted.searchParams.getAll("pdp_filters").some(filter => /item_id/i.test(filter));
    if (requestItemId === expectedId && hasSubmittedItemId && productIdFromUrl(urls[0]) !== expectedId) return null;
    if (requestItemId !== expectedId) {
      const urlItemId = productIdFromUrl(urls[0]);
      const catalogPath = mlbuCatalogPath(urls[0]);
      const cardCatalogPath = mlbuCatalogPath(expectedProductUrl);
      if (itemAddToList !== expectedId ||
          !(urlItemId === requestItemId ||
            (!urlItemId && catalogPath && catalogPath === cardCatalogPath))) return null;
    }
    return { ownerItemId: expectedId, requestItemId, requestItemAddToList: itemAddToList,
      requestBuyBoxWinner: buyBoxWinner, requestUrls: urls };
  }

  function responseShare(payload, requestUrls) {
    const pending = [{ value: payload, depth: 0 }];
    const seen = new Set();
    for (let inspected = 0; pending.length && inspected < 200; inspected += 1) {
      const { value, depth } = pending.shift();
      if (typeof value === "string" && value.startsWith("{")) {
        try { pending.push({ value: JSON.parse(value), depth: depth + 1 }); } catch (_) { /* Not JSON. */ }
      }
      if (!value || typeof value !== "object" || seen.has(value) || depth > 8) continue;
      seen.add(value);
      if (validShortUrl(value.short_url) && requestUrls.includes(normalizedCatalogUrl(value.origin_url))) return value;
      for (const nested of Object.values(value)) {
        if (nested && (typeof nested === "object" || typeof nested === "string")) pending.push({ value: nested, depth: depth + 1 });
      }
    }
    return null;
  }

  function recordResponse(payload, generation, requestMeta) {
    const capture = activeCapture;
    if (!capture || capture.generation !== generation || capture.share) return;
    if (!requestMeta || requestMeta.ownerItemId !== capture.itemId) return;
    if (payload?.status != null && payload.status !== 200) return;
    const response = responseShare(payload, requestMeta.requestUrls);
    if (!response) return;
    capture.share = allowlistedShare(response);
    capture.attribution = {
      requestItemId: requestMeta.requestItemId,
      requestItemAddToList: requestMeta.requestItemAddToList,
      requestBuyBoxWinner: requestMeta.requestBuyBoxWinner,
      requestUrls: requestMeta.requestUrls,
      matchedOriginUrl: normalizedCatalogUrl(response.origin_url)
    };
  }

  function installResponseCapture() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (...args) {
        const request = args[0];
        const options = args[1];
        const url = typeof request === "string" ? request : request?.url;
        const body = options?.body;
        const generation = activeCapture?.generation;
        const requestMeta = generation ? requestAttribution(body, activeCapture.itemId, activeCapture.productUrl) : null;
        const result = originalFetch.apply(this, args);
        if (generation && requestMeta && isCreateLinkCall(url, body)) {
          Promise.resolve(result).then(response => response.ok ? response.clone().json() : null)
            .then(payload => recordResponse(payload, generation, requestMeta))
            .catch(() => {});
        }
        return result;
      };
    }

    const xhrProto = window.XMLHttpRequest?.prototype;
    if (xhrProto?.open && xhrProto?.send) {
      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;
      const requestUrls = new WeakMap();
      xhrProto.open = function (method, url, ...rest) {
        requestUrls.set(this, String(url || ""));
        return originalOpen.call(this, method, url, ...rest);
      };
      xhrProto.send = function (body) {
        const generation = activeCapture?.generation;
        const requestMeta = generation ? requestAttribution(body, activeCapture.itemId, activeCapture.productUrl) : null;
        if (generation && requestMeta && isCreateLinkCall(requestUrls.get(this), body)) {
          this.addEventListener("loadend", () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
              recordResponse(payload, generation, requestMeta);
            } catch (_) { /* Non-JSON or unreadable response. */ }
          }, { once: true });
        }
        return originalSend.call(this, body);
      };
    }
  }

  installResponseCapture();

  function readShare(itemId, productUrl) {
    const expectedId = productId(itemId);
    if (!expectedId || !eligibleProductUrl(productUrl, expectedId)) return { share: null, reason: "product_mismatch" };
    if (activeCapture?.itemId === expectedId && activeCapture?.share) {
      return { share: activeCapture.share, reason: null, provenance: "createLink_response",
        attribution: activeCapture.attribution };
    }
    const copyButton = document.getElementById("copy_link");
    if (!copyButton) return { share: null, reason: "copy_button_missing" };
    const fiberKey = Object.keys(copyButton).find(key => key.startsWith("__reactFiber$"));
    if (!fiberKey) return { share: null, reason: "fiber_missing" };

    let fiber = copyButton[fiberKey];
    const seenFibers = new Set();
    for (let depth = 0; fiber && depth < 100 && !seenFibers.has(fiber); depth += 1, fiber = fiber.return) {
      seenFibers.add(fiber);
      if (productId(fiber.memoizedProps?.dataToLink?.itemId) !== expectedId) continue;
      let hook = fiber.memoizedState;
      const seenHooks = new Set();
      for (let index = 0; hook && index < 100 && !seenHooks.has(hook); index += 1, hook = hook.next) {
        seenHooks.add(hook);
        const response = hook.memoizedState;
        if (!response || typeof response !== "object") continue;
        if (!validShortUrl(response.short_url)) continue;
        if (!hookOriginMatchesCard(response.origin_url, productUrl, expectedId)) continue;
        return { share: allowlistedShare(response), reason: null, provenance: "react_hook",
          ownerItemId: expectedId };
      }
    }
    return { share: null, reason: "matching_share_state_missing" };
  }

  window.addEventListener("message", event => {
    const message = event.data;
    if (event.source !== window || message?.source !== REQUEST_SOURCE ||
      !["begin-share-capture", "read-share-state"].includes(message.type)) return;
    if (typeof message.requestId !== "string" || message.requestId.length > 100) return;
    if (message.type === "begin-share-capture") {
      const expectedId = productId(message.itemId);
      const valid = Boolean(expectedId && eligibleProductUrl(message.productUrl, expectedId));
      activeCapture = valid ? { itemId: expectedId, productUrl: message.productUrl,
        generation: ++captureGeneration, share: null } : null;
      window.postMessage({ source: RESPONSE_SOURCE, type: "share-capture-ready",
        requestId: message.requestId, itemId: message.itemId, ready: valid }, window.location.origin);
      return;
    }
    let result;
    try { result = readShare(message.itemId, message.productUrl); }
    catch (_) { result = { share: null, reason: "page_state_read_failed" }; }
    window.postMessage({
      source: RESPONSE_SOURCE,
      type: "share-state",
      requestId: message.requestId,
      itemId: message.itemId,
      share: result.share,
      reason: result.reason,
      provenance: result.provenance || null,
      ownerItemId: result.ownerItemId || null,
      attribution: result.attribution || null
    }, window.location.origin);
  });
})();
