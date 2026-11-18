(function initSheetCanvasSupportAnalytics() {
  var measurementId = 'G-FDXZ468S02';
  var appOrigin = 'https://sheetcanvas.com';
  // GA4 event names follow the portfolio telemetry standard (memory/Projects/telemetry-flywheel): funnel steps are
  // uf_<Funnel>_<NN>_<Step>. Renamed 2026-11-18: support_open_app_click -> uf_Acquire_02_OpenAppClick.
  var LANDING_VIEW_EVENT = 'uf_Acquire_01_LandingView';
  var OPEN_APP_EVENT = 'uf_Acquire_02_OpenAppClick';
  var standardParams = { app: 'sheetcanvas', platform: 'web' };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  var supportPagePath = window.location.pathname;
  var supportPageTitle = document.title;
  var searchParams = new URLSearchParams(window.location.search);
  var isDebugMode = searchParams.get('debug_ga') === '1';
  var supportEntryStorageKey = 'sheetcanvas:support-entry';

  function withDebugMode(parameters) {
    if (!isDebugMode) {
      return parameters;
    }
    return Object.assign({}, parameters, {
      debug_mode: true
    });
  }

  if (!document.querySelector('script[src*="googletagmanager.com/gtag/js?id=' + measurementId + '"]')) {
    var gtagScript = document.createElement('script');
    gtagScript.async = true;
    gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(gtagScript);
  }

  window.gtag('js', new Date());
  window.gtag('config', measurementId, withDebugMode({
    page_location: window.location.href,
    page_path: supportPagePath,
    page_title: supportPageTitle,
    support_page_path: supportPagePath,
    support_page_title: supportPageTitle,
    send_page_view: true
  }));

  // Funnel step 01: a support page (every one carries an "Open SheetCanvas" CTA, enforced by seo-support-analytics-audit).
  window.gtag('event', LANDING_VIEW_EVENT, withDebugMode(Object.assign({}, standardParams, {
    support_page_path: supportPagePath
  })));

  function isRootAppLink(anchor) {
    var href = anchor.getAttribute('href') || '';
    if (href === '/') {
      return true;
    }
    try {
      var url = new URL(href, window.location.href);
      return url.origin === appOrigin && url.pathname === '/';
    } catch (error) {
      return false;
    }
  }

  function isAppCta(anchor) {
    var textLabel = (anchor.textContent || '').trim();
    var ariaLabel = (anchor.getAttribute('aria-label') || '').trim();
    return /open (sheetcanvas|app)/i.test(textLabel) || /open (sheetcanvas|app)/i.test(ariaLabel);
  }

  function rememberSupportEntry() {
    try {
      window.sessionStorage.setItem(supportEntryStorageKey, JSON.stringify({
        path: supportPagePath,
        title: supportPageTitle,
        timestamp: Date.now()
      }));
    } catch (error) {
      // Analytics context is best-effort; private browsing/storage failures should not block app navigation.
    }
  }

  document.addEventListener('click', function trackSupportAppCta(event) {
    var anchor = event.target.closest && event.target.closest('a');
    if (!anchor || !isRootAppLink(anchor) || !isAppCta(anchor) || typeof window.gtag !== 'function') {
      return;
    }

    rememberSupportEntry();

    window.gtag('event', OPEN_APP_EVENT, withDebugMode(Object.assign({}, standardParams, {
      event_category: 'SEO support page',
      event_label: supportPagePath,
      link_text: (anchor.textContent || '').trim(),
      link_url: anchor.href,
      support_page_path: supportPagePath,
      support_page_title: supportPageTitle,
      transport_type: 'beacon'
    })));
  }, true);
}());
