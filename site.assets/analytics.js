/**
 * iceboks.site → Umami (tracker only — no UI/layout).
 * - Skip localhost / LAN previews
 * - Domain lock to iceboks.site
 * - Capture UTMs in sessionStorage
 * - Auto events: demo_open, portal_click, post_open, cta via data-umami-event
 * - iceboksTrack() / iceboksShareUrl() helpers for console/share links
 */
(function () {
  var WEBSITE_ID = 'e830235f-bbbc-45c1-a315-f09074e9a93b';
  var SCRIPT_SRC = 'https://umami.americannex.com/script.js';
  var host = (location.hostname || '').toLowerCase();
  var skip = !(host === 'iceboks.site' || host === 'www.iceboks.site');

  // Persist UTMs if present (Umami pageview still reads query string on first hit)
  try {
    var params = new URLSearchParams(location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var bag = {};
    var found = false;
    keys.forEach(function (k) {
      var v = params.get(k);
      if (v) {
        bag[k] = v;
        found = true;
      }
    });
    if (found) sessionStorage.setItem('iceboks_utm', JSON.stringify(bag));
  } catch (e) {}

  function track(name, data) {
    try {
      if (skip) return;
      if (window.umami && typeof window.umami.track === 'function') {
        if (data) window.umami.track(name, data);
        else window.umami.track(name);
      }
    } catch (e) {}
  }

  window.iceboksTrack = track;

  /** Build tagged share URLs without editing pages:
   *  iceboksShareUrl('/demo/ai.html','discord','social','lab-drop')
   */
  window.iceboksShareUrl = function (path, source, medium, campaign) {
    var p = path || '/';
    if (p.charAt(0) !== '/') p = '/' + p;
    var u = new URL('https://iceboks.site' + p);
    if (source) u.searchParams.set('utm_source', source);
    if (medium) u.searchParams.set('utm_medium', medium || 'social');
    if (campaign) u.searchParams.set('utm_campaign', campaign || 'share');
    return u.toString();
  };

  if (skip) return;

  var s = document.createElement('script');
  s.defer = true;
  s.src = SCRIPT_SRC;
  s.dataset.websiteId = WEBSITE_ID;
  s.dataset.domains = 'iceboks.site,www.iceboks.site';
  document.head.appendChild(s);

  function bindClicks() {
    document.addEventListener(
      'click',
      function (ev) {
        var el =
          ev.target && ev.target.closest
            ? ev.target.closest('a,button,[data-umami-event]')
            : null;
        if (!el) return;

        var name = el.getAttribute('data-umami-event');
        var href = el.getAttribute('href') || '';

        if (name) {
          var payload = {};
          Array.prototype.forEach.call(el.attributes, function (attr) {
            if (attr.name.indexOf('data-umami-event-') === 0) {
              payload[attr.name.slice('data-umami-event-'.length)] = attr.value;
            }
          });
          track(name, Object.keys(payload).length ? payload : undefined);
          return;
        }

        if (/demo\/ai\.html|(^|\/)ai\.html/.test(href)) {
          track('demo_open', { demo: 'ai' });
        } else if (href.indexOf('demo/') !== -1 || href.indexOf('/demo') !== -1) {
          track('demo_open', { demo: href.split('?')[0] });
        } else if (el.classList && el.classList.contains('portal')) {
          var lab = el.querySelector('.portal-label');
          track('portal_click', {
            label: lab ? lab.textContent.replace(/\s+/g, ' ').trim() : href,
          });
        } else if (href.indexOf('posts/') !== -1) {
          track('post_open', { href: href.split('?')[0] });
        }
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindClicks);
  } else {
    bindClicks();
  }
})();
