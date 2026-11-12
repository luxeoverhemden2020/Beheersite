<?php
declare(strict_types=1);

namespace Sitehulpje\Koppeling\Api;

/**
 * Vaste, veilige acties voor Sitehulpje (SEO en onderhoud). Elke methode geeft JSON terug als tekst.
 * @api
 */
interface BeheerInterface
{
    /**
     * Gezondheid: cron, sitemaps, indexen, cache en recente fouten.
     * @return string
     */
    public function status(): string;

    /**
     * Wat zit er achter een adres (url-rewrite, doel bestaat nog?).
     * @param string $pad bijv. "venti-ivoor" of de volledige URL
     * @return string
     */
    public function controleerAdres(string $pad): string;

    /**
     * Doorverwijzingen zoeken op (een deel van) het adres.
     * @param string $zoek
     * @return string
     */
    public function zoekDoorverwijzingen(string $zoek): string;

    /**
     * Permanente doorverwijzing (301) maken of een bestaande (kapotte) rewrite op dit adres vervangen.
     * @param string $van oud adres (pad of URL)
     * @param string $naar nieuw adres (pad of URL)
     * @param int $storeId 0 = alle winkelweergaven
     * @return string
     */
    public function maakDoorverwijzing(string $van, string $naar, int $storeId = 0): string;

    /**
     * Een eigen doorverwijzing (custom) verwijderen.
     * @param int $id
     * @return string
     */
    public function verwijderDoorverwijzing(int $id): string;

    /**
     * Alle sitemaps opnieuw maken (en een sitemap.xml aanmaken als er nog geen is).
     * @return string
     */
    public function genereerSitemap(): string;

    /**
     * Sitemap automatisch dagelijks laten bijwerken (via cron).
     * @param bool $aan
     * @return string
     */
    public function sitemapAutomatisch(bool $aan): string;

    /**
     * @return string
     */
    public function leesRobots(): string;

    /**
     * robots.txt-tekst instellen (standaard-niveau). Vorige versie wordt in het logboek bewaard.
     * @param string $tekst
     * @return string
     */
    public function zetRobots(string $tekst): string;

    /**
     * Canonieke links voor producten en categorieën aan- of uitzetten.
     * @param bool $aan
     * @return string
     */
    public function canonical(bool $aan): string;

    /**
     * Cache legen (alle ingeschakelde cachetypes).
     * @return string
     */
    public function legenCache(): string;

    /**
     * Indexen die "opnieuw indexeren nodig" hebben bijwerken.
     * @return string
     */
    public function bijwerkenIndexen(): string;
}
