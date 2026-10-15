/* El Nino Watch: share a city ranking or an alert on X (Twitter) or Facebook, through the phone's
   share menu (TikTok, WhatsApp and other installed apps), or copy its text.
   Visitors post from their own accounts; the site holds no social media accounts or keys.
   A share row carries its text as lines of parts: a plain string is used as written (city names,
   numbers), and {t: 'English text'} is translated when the button is pressed, so the post is in
   the language the page is showing. Facebook takes only the link; its text cannot be prefilled,
   which is what "Copy text" is for. Loaded before alerts.js and rankings.js, which call row(). */
(function (global) {
  'use strict';
  const SITE = 'https://elninowatch.so/';
  // X counts any link as 23 characters; one more for the space before it.
  const X_TEXT_LIMIT = 280 - 24;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const translate = text => { try { return global.SiteLanguage?.translateText?.(text) ?? text; } catch { return text; } };
  const language = () => global.SiteLanguage?.getLanguage?.() === 'so' ? 'so' : 'en';

  function row(lines, tab) {
    return `<div class="share-row" role="group" aria-label="Share" data-share-lines="${esc(JSON.stringify(Array.isArray(lines) ? lines : []))}" data-share-tab="${esc(tab || '')}"><span class="share-label">Share</span><a class="share-button" data-share="x" href="https://twitter.com/intent/tweet" target="_blank" rel="noopener"><span data-i18n-skip>X (Twitter)</span></a><a class="share-button" data-share="facebook" href="https://www.facebook.com/sharer/sharer.php" target="_blank" rel="noopener"><span data-i18n-skip>Facebook</span></a><button type="button" class="share-button" data-share="copy">Copy text</button>${deviceShare() ? '<button type="button" class="share-button" data-share="device">TikTok, WhatsApp &amp; more</button>' : ''}</div>`;
  }
  // TikTok takes no text or link post from a web page, so it is reached through the phone's own
  // share menu, which lists the apps installed (TikTok, WhatsApp, Telegram...). Offered only where
  // the browser has that menu.
  const deviceShare = () => typeof global.navigator?.share === 'function';
  function textOf(lines) {
    return (Array.isArray(lines) ? lines : []).map(line => (Array.isArray(line) ? line : [line])
      .map(part => typeof part === 'string' ? part : translate(String(part?.t ?? ''))).join('').trim())
      .filter(Boolean).join('\n');
  }
  function linkFor(tab) {
    const url = new URL(SITE);
    if (language() === 'so') url.searchParams.set('lang', 'so');
    if (/^[a-z]+$/.test(String(tab || ''))) url.hash = 'tab=' + tab;
    return url.href;
  }
  // Too long for X: first shorten the closing disclaimer to "Not an official warning.", then drop
  // lines from just above it (the lowest-ranked cities first), so the title and a disclaimer always
  // survive; cut the text only as a last resort.
  function fit(text) {
    const lines = String(text).split('\n');
    const short = translate('Not an official warning.');
    if (lines.join('\n').length > X_TEXT_LIMIT && lines.length > 1) lines[lines.length - 1] = short;
    while (lines.join('\n').length > X_TEXT_LIMIT && lines.length > 2) lines.splice(lines.length - 2, 1);
    const kept = lines.join('\n');
    return kept.length <= X_TEXT_LIMIT ? kept : kept.slice(0, X_TEXT_LIMIT - 1).trimEnd() + '…';
  }
  function read(rowElement) {
    let lines = [];
    try { lines = JSON.parse(rowElement.getAttribute('data-share-lines') || '[]'); } catch {}
    return {text: textOf(lines), url: linkFor(rowElement.getAttribute('data-share-tab') || '')};
  }
  // Messages are written in English, like the rest of the page, and translated on screen.
  function say(button, message) {
    button.textContent = message;
    global.setTimeout(() => { button.textContent = 'Copy text'; }, 2500);
  }
  async function copy(text, button) {
    try {
      if (!global.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await global.navigator.clipboard.writeText(text);
      say(button, 'Copied');
    } catch {
      // Older browsers: copy through a hidden text box.
      try {
        const box = global.document.createElement('textarea');
        box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0';
        global.document.body.append(box); box.select();
        const done = global.document.execCommand?.('copy'); box.remove();
        say(button, done ? 'Copied' : 'Copy not available');
      } catch { say(button, 'Copy not available'); }
    }
  }
  // The text is built at the moment of the click, in the page's current language; the link's
  // address is set before the browser follows it.
  function onClick(event) {
    const button = event.target?.closest?.('[data-share]'); if (!button) return;
    const rowElement = button.closest('.share-row'); if (!rowElement) return;
    const {text, url} = read(rowElement), kind = button.getAttribute('data-share');
    if (kind === 'x') button.setAttribute('href', 'https://twitter.com/intent/tweet?' + new URLSearchParams({text: fit(text), url}));
    else if (kind === 'facebook') button.setAttribute('href', 'https://www.facebook.com/sharer/sharer.php?' + new URLSearchParams({u: url}));
    else if (kind === 'copy') copy(text + '\n' + url, button);
    else if (kind === 'device' && deviceShare()) global.navigator.share({title: 'El Nino Watch', text, url}).catch(() => {});
  }
  global.document?.addEventListener?.('click', onClick);
  global.SiteShare = {row, textOf, linkFor, fit, onClick};
})(window);
