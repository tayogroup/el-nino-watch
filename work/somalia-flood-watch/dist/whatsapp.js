/* "Get alerts on WhatsApp" on the Alerts tab (server: whatsapp.mjs). Shown only while the server has
   WhatsApp alerts switched on. The button opens WhatsApp with "JOIN <city>" (Somali "KU BIIR <city>")
   ready to send to the El Nino Watch number; the person sends it to sign up.
   The audio bulletin is opt-in too (owner, 2026-10-17): its buttons, beside the alerts button and in the
   bulletin panel on the home page, open WhatsApp with "AUDIO" (Somali "CODKA") ready to send. */
(function (root) {
  'use strict';
  let number = '', city = '';
  const language = () => root.SiteLanguage?.getLanguage?.() === 'so' ? 'so' : 'en';
  function link(lang, cityName) {
    return `https://wa.me/${number}?text=${encodeURIComponent((lang === 'so' ? 'KU BIIR ' : 'JOIN ') + cityName)}`;
  }
  function audioLink(lang) {
    return `https://wa.me/${number}?text=${encodeURIComponent(lang === 'so' ? 'CODKA' : 'AUDIO')}`;
  }
  function paint() {
    const doc = root.document, button = doc?.getElementById?.('alerts-whatsapp'), note = doc?.getElementById?.('alerts-whatsapp-note');
    if (button) {
      const on = !!number && !!city;
      button.hidden = !on;
      if (note) note.hidden = !on;
      if (on) {
        button.href = link(language(), city);
        // The reader may switch language after the page drew the button: build the message on the tap.
        button.onclick = () => { button.href = link(language(), city); };
      }
    }
    // The audio bulletin needs no city.
    for (const id of ['alerts-whatsapp-audio', 'podcast-whatsapp']) {
      const audio = doc?.getElementById?.(id);
      if (!audio) continue;
      audio.hidden = !number;
      if (!number) continue;
      audio.href = audioLink(language());
      audio.onclick = () => { audio.href = audioLink(language()); };
    }
  }
  function update(cityName) { city = String(cityName || ''); paint(); }
  root.fetch?.('/api/whatsapp', {cache: 'no-store'})
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (data?.enabled && /^\d{8,15}$/.test(String(data.number))) { number = String(data.number); paint(); } })
    .catch(() => {});
  root.WhatsAppAlerts = {update, link: (lang, cityName) => number ? link(lang, cityName) : '', audioLink: lang => number ? audioLink(lang) : ''};
})(typeof window === 'object' ? window : globalThis);
