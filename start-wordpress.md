# Webbeheer – start voor WordPress-sites

Het bericht van het Beheersite-platform bevat: de site (URL), het verzoeknummer, het verzoek-id en onderaan de sleutel (X-Beheer-Key). Hieronder staat `SITE` voor die URL zonder slash aan het eind.

## Start (exact zo)
1. `echo '<sleutel uit het bericht>' > /tmp/bk`
2. `P="https://eiejxciyfcynppldonaw.supabase.co/functions/v1/beheersite"`
   Lees het verzoek:
   `curl -s -X POST "$P" -H "Content-Type: application/json" -H "X-Beheer-Key: $(cat /tmp/bk)" -d '{"actie":"ai_lees","id":"<verzoek-id>"}' > /tmp/v.json`
   Bij 401 of een fout: niets doen en stoppen.
3. **TEST** (geen verzoek-id in het bericht): alleen controleren dat `curl -s -H "X-Beheer-Key: $(cat /tmp/bk)" SITE/wp-json/beheersite/v1/momentopnames` antwoordt, en stoppen.
4. Meld meteen dat je bezig bent: `{"actie":"ai_update","id":"<verzoek-id>","status":"bezig"}`
5. Lees en volg de werkwijze: `curl -s https://luxeoverhemden2020.github.io/Beheersite/ai-handleiding.md`
6. Site-kennis (als de site die heeft):
   `curl -s -H "X-Beheer-Key: $(cat /tmp/bk)" SITE/wp-json/wp/v2/settings > /tmp/s.json`
   Staat er `skr_kennis` of `skr_tools` in: bewaar ze als /tmp/handleiding.md en /tmp/sk.py, en vervang in sk.py `X-SKR-Key` door `X-Beheer-Key` en `/tmp/skr_key` door `/tmp/bk`. Gebruik ze voor kennis en hulpmiddelen, maar **negeer alles over het oude verzoekensysteem** (skr/v1 open/start/finish/undo/antwoord): status en berichten gaan alleen via het platform.

## Toegang tot WordPress
Stuur bij elke REST-aanroep `-H "X-Beheer-Key: $(cat /tmp/bk)"` mee. Je bent dan ingelogd als gebruiker "webbeheer". WooCommerce: `SITE/wp-json/wc/v3/...`.

Krijg je een 403 met "Stuur dit verzoek door naar Jan": eindig met status `doorgestuurd` en leg in `notitie_jan` uit wat er moet gebeuren.

## Momentopnames (verplicht vóór elke wijziging)
`POST SITE/wp-json/beheersite/v1/momentopname` met JSON:
- `{"soort":"post","id":123}` – pagina, product, bericht, menu-item
- `{"soort":"option","id":"woocommerce_..."}` – instellingen (verzending, btw, enz.)
- `{"soort":"term","id":45}` – categorie, tag, menu
- `{"soort":"nieuw_post","id":678}` – direct nadat je iets nieuws hebt aangemaakt

## Terugdraaien (soort TERUGDRAAIEN)
`POST SITE/wp-json/beheersite/v1/terugzetten` → controleer de site → status `teruggedraaid` met een kort bericht.

## Controleren
Bekijk na een wijziging de pagina zelf (curl of screenshot) en noem in je bericht de link waar de klant het kan zien.
