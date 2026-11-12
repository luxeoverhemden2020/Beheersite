# Sitehulpje-module voor Magento 2 (Sitehulpje_Koppeling)

Geeft Sitehulpje een vaste, veilige lijst acties via de Magento REST API, die standaard niet bestaan:
doorverwijzingen (301), sitemap opnieuw maken en automatisch bijhouden, robots.txt, canonieke links,
cache legen, indexen bijwerken en een gezondheidsoverzicht (cron, sitemaps, indexen, recente fouten).

Geen vrije servertoegang, geen eigen code uitvoeren, geen klant- of betaalgegevens. Elke actie komt in `var/log/sitehulpje.log`.
Getest op Mage-OS 3.6 / Magento 2.4.9, PHP 8.4.

## Installeren (eenmalig, door de webbouwer of via SSH)
1. Pak `sitehulpje-koppeling-1.0.0.zip` uit in de Magento-map, zodat je `app/code/Sitehulpje/Koppeling/` krijgt.
2. Voer uit (als de gebruiker die de shop draait):
   ```
   bin/magento module:enable Sitehulpje_Koppeling
   bin/magento setup:upgrade
   bin/magento setup:di:compile        # alleen in productiemodus
   bin/magento cache:flush
   ```
   In productiemodus is de winkel tijdens `setup:upgrade` + `di:compile` een paar minuten trager of in onderhoud. Doe het op een rustig moment.
3. Rechten: heeft de Sitehulpje-integratie in Magento (Systeem → Integraties) toegang tot "Alles", dan werkt het meteen.
   Anders: integratie openen, bij API-rechten **Sitehulpje: SEO en onderhoud** aanvinken, opslaan en opnieuw activeren.

## Controleren
`GET /rest/V1/sitehulpje/status` met de Sitehulpje-sleutel geeft `{"module":"1.0.0",...}`.
Sitehulpje herkent de module vanzelf bij het volgende verzoek.
