<?php
declare(strict_types=1);

namespace Sitehulpje\Koppeling\Model;

use Magento\Framework\App\Area;
use Magento\Framework\App\Cache\Manager as CacheManager;
use Magento\Framework\App\Cache\TypeListInterface;
use Magento\Framework\App\Config\ReinitableConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\App\Filesystem\DirectoryList;
use Magento\Framework\App\ResourceConnection;
use Magento\Framework\Exception\LocalizedException;
use Magento\Framework\Filesystem;
use Magento\Indexer\Model\Indexer\CollectionFactory as IndexerCollectionFactory;
use Magento\Sitemap\Model\ResourceModel\Sitemap\CollectionFactory as SitemapCollectionFactory;
use Magento\Sitemap\Model\SitemapFactory;
use Magento\Store\Model\App\Emulation;
use Magento\Store\Model\StoreManagerInterface;
use Magento\UrlRewrite\Model\ResourceModel\UrlRewrite as UrlRewriteResource;
use Magento\UrlRewrite\Model\UrlRewriteFactory;
use Sitehulpje\Koppeling\Api\BeheerInterface;

class Beheer implements BeheerInterface
{
    public const VERSIE = '1.0.0';
    private const ROBOTS = 'design/search_engine_robots/custom_instructions';

    public function __construct(
        private readonly ResourceConnection $db,
        private readonly StoreManagerInterface $stores,
        private readonly UrlRewriteFactory $rewriteFactory,
        private readonly UrlRewriteResource $rewriteResource,
        private readonly SitemapCollectionFactory $sitemaps,
        private readonly SitemapFactory $sitemapFactory,
        private readonly Emulation $emulatie,
        private readonly WriterInterface $configWriter,
        private readonly ReinitableConfigInterface $config,
        private readonly TypeListInterface $cacheTypes,
        private readonly CacheManager $cache,
        private readonly IndexerCollectionFactory $indexers,
        private readonly Filesystem $filesystem
    ) {
    }

    public function status(): string
    {
        $c = $this->db->getConnection();
        $t = fn (string $n) => $this->db->getTableName($n);
        $cron = $c->fetchOne($c->select()->from($t('cron_schedule'), ['MAX(executed_at)'])->where('status = ?', 'success'));
        $sitemapCron = $c->fetchOne($c->select()->from($t('cron_schedule'), ['MAX(executed_at)'])
            ->where('job_code = ?', 'sitemap_generate')->where('status = ?', 'success'));
        $sitemaps = $c->fetchAll($c->select()->from($t('sitemap'), ['sitemap_id', 'sitemap_filename', 'sitemap_path', 'sitemap_time', 'store_id']));
        $ongeldig = [];
        foreach ($this->indexers->create()->getItems() as $i) {
            if ($i->isInvalid()) {
                $ongeldig[] = $i->getId();
            }
        }
        $cacheUit = [];
        foreach ($this->cacheTypes->getTypes() as $code => $type) {
            if (!(int) $type->getStatus()) {
                $cacheUit[] = $code;
            }
        }
        return $this->json([
            'module' => self::VERSIE,
            'cron_laatst' => $cron ?: null,
            'sitemap_cron_laatst' => $sitemapCron ?: null,
            'sitemap_automatisch' => (bool) $this->config->getValue('sitemap/generate/enabled'),
            'sitemaps' => $sitemaps,
            'indexen_ongeldig' => $ongeldig,
            'cache_uit' => $cacheUit,
            'cache_ongeldig' => array_keys($this->cacheTypes->getInvalidated()),
            'canonical' => [
                'product' => (bool) $this->config->getValue('catalog/seo/product_canonical_tag'),
                'categorie' => (bool) $this->config->getValue('catalog/seo/category_canonical_tag'),
            ],
            'recente_fouten' => $this->recenteFouten(),
        ]);
    }

    public function controleerAdres(string $pad): string
    {
        $p = $this->pad($pad);
        $c = $this->db->getConnection();
        $kandidaten = array_values(array_unique([$p, rtrim($p, '/'), rtrim($p, '/') . '/', $p . '.html']));
        $rijen = $c->fetchAll($c->select()->from($this->db->getTableName('url_rewrite'))->where('request_path IN (?)', $kandidaten));
        foreach ($rijen as &$r) {
            $r['doel_bestaat'] = $this->doelBestaat($r);
        }
        unset($r);
        return $this->json([
            'pad' => $p,
            'gevonden' => count($rijen),
            'rewrites' => $rijen,
            'advies' => !$rijen ? 'Geen rewrite op dit adres: Magento geeft hier een 404.'
                : (in_array(false, array_column($rijen, 'doel_bestaat'), true)
                    ? 'Er staat een rewrite naar iets dat niet meer bestaat. Maak er een 301-doorverwijzing van.'
                    : 'De rewrite en het doel bestaan.'),
        ]);
    }

    public function zoekDoorverwijzingen(string $zoek): string
    {
        $c = $this->db->getConnection();
        $rijen = $c->fetchAll($c->select()->from($this->db->getTableName('url_rewrite'),
            ['url_rewrite_id', 'entity_type', 'entity_id', 'request_path', 'target_path', 'redirect_type', 'store_id'])
            ->where('request_path LIKE ?', '%' . $this->pad($zoek) . '%')->limit(50));
        return $this->json(['aantal' => count($rijen), 'rewrites' => $rijen]);
    }

    public function maakDoorverwijzing(string $van, string $naar, int $storeId = 0): string
    {
        $vanPad = $this->pad($van);
        $naarDoel = preg_match('#^https?://#i', $naar) && !$this->isEigenDomein($naar) ? trim($naar) : $this->pad($naar);
        if ($vanPad === '' || $naarDoel === '') {
            throw new LocalizedException(__('Vul een oud en een nieuw adres in.'));
        }
        if ($vanPad === $naarDoel) {
            throw new LocalizedException(__('Het oude en het nieuwe adres zijn hetzelfde.'));
        }
        $storeIds = $storeId > 0 ? [$storeId] : array_map(fn ($s) => (int) $s->getId(), $this->stores->getStores());
        $c = $this->db->getConnection();
        $tabel = $this->db->getTableName('url_rewrite');
        $waarschuwing = null;
        if (!preg_match('#^https?://#i', $naarDoel)
            && !$c->fetchOne($c->select()->from($tabel, ['url_rewrite_id'])->where('request_path = ?', $naarDoel)->where('redirect_type = 0'))) {
            $waarschuwing = 'Het nieuwe adres staat niet als pagina in de winkel. Controleer of het klopt.';
        }
        $resultaat = [];
        foreach ($storeIds as $sid) {
            $id = $c->fetchOne($c->select()->from($tabel, ['url_rewrite_id'])->where('request_path = ?', $vanPad)->where('store_id = ?', $sid));
            $rw = $this->rewriteFactory->create();
            if ($id) {
                $this->rewriteResource->load($rw, (int) $id);
            }
            $rw->setEntityType('custom')->setEntityId(0)->setRequestPath($vanPad)->setTargetPath($naarDoel)
                ->setRedirectType(301)->setStoreId($sid)->setIsAutogenerated(0)->setMetadata(null)
                ->setDescription('Sitehulpje ' . date('Y-m-d H:i'));
            $this->rewriteResource->save($rw);
            $resultaat[] = ['store_id' => $sid, 'id' => (int) $rw->getId(), 'was_er_al' => (bool) $id];
        }
        $this->cache->clean(['full_page']);
        $this->log("301 {$vanPad} -> {$naarDoel} (stores " . implode(',', $storeIds) . ')');
        return $this->json(['ok' => true, 'van' => $vanPad, 'naar' => $naarDoel, 'stores' => $resultaat, 'waarschuwing' => $waarschuwing]);
    }

    public function verwijderDoorverwijzing(int $id): string
    {
        $rw = $this->rewriteFactory->create();
        $this->rewriteResource->load($rw, $id);
        if (!$rw->getId()) {
            throw new LocalizedException(__('Doorverwijzing niet gevonden.'));
        }
        if ($rw->getEntityType() !== 'custom') {
            throw new LocalizedException(__('Alleen eigen doorverwijzingen kunnen worden verwijderd, geen product- of categorie-adressen.'));
        }
        $this->log('verwijderd: ' . $rw->getRequestPath() . ' -> ' . $rw->getTargetPath());
        $this->rewriteResource->delete($rw);
        $this->cache->clean(['full_page']);
        return $this->json(['ok' => true]);
    }

    public function genereerSitemap(): string
    {
        $lijst = $this->sitemaps->create()->getItems();
        if (!$lijst) {
            $nieuw = $this->sitemapFactory->create();
            $nieuw->setData([
                'sitemap_filename' => 'sitemap.xml',
                'sitemap_path' => '/',
                'store_id' => (int) $this->stores->getDefaultStoreView()->getId(),
            ]);
            $nieuw->save();
            $lijst = [$nieuw];
        }
        $uit = [];
        foreach ($lijst as $s) {
            $this->emulatie->startEnvironmentEmulation((int) $s->getStoreId(), Area::AREA_FRONTEND, true);
            try {
                $s->generateXml();
                $uit[] = ['bestand' => $s->getSitemapPath() . $s->getSitemapFilename(), 'store_id' => (int) $s->getStoreId(), 'ok' => true];
            } catch (\Throwable $e) {
                $uit[] = ['bestand' => $s->getSitemapFilename(), 'ok' => false, 'fout' => mb_substr($e->getMessage(), 0, 300)];
            } finally {
                $this->emulatie->stopEnvironmentEmulation();
            }
        }
        $this->log('sitemap gegenereerd: ' . json_encode($uit));
        return $this->json(['ok' => !in_array(false, array_column($uit, 'ok'), true), 'sitemaps' => $uit]);
    }

    public function sitemapAutomatisch(bool $aan): string
    {
        $this->zetConfig('sitemap/generate/enabled', $aan ? '1' : '0');
        if ($aan) {
            $this->zetConfig('sitemap/generate/frequency', 'D');
            $this->zetConfig('sitemap/generate/time', '03,15,00');
        }
        $this->log('sitemap automatisch: ' . ($aan ? 'aan' : 'uit'));
        return $this->json(['ok' => true, 'aan' => $aan, 'let_op' => 'Dit werkt alleen als de cron van de winkel draait (zie status: cron_laatst).']);
    }

    public function leesRobots(): string
    {
        $c = $this->db->getConnection();
        $rijen = $c->fetchAll($c->select()->from($this->db->getTableName('core_config_data'), ['scope', 'scope_id', 'value'])
            ->where('path = ?', self::ROBOTS));
        return $this->json(['robots' => $rijen]);
    }

    public function zetRobots(string $tekst): string
    {
        if (mb_strlen($tekst) > 20000) {
            throw new LocalizedException(__('De robots-tekst is te lang.'));
        }
        $oud = $this->leesRobots();
        $this->log('robots oud: ' . $oud);
        $this->zetConfig(self::ROBOTS, $tekst);
        // overschrijvingen per website/winkel weghalen, anders telt de nieuwe tekst daar niet
        $c = $this->db->getConnection();
        $c->delete($this->db->getTableName('core_config_data'), ['path = ?' => self::ROBOTS, 'scope <> ?' => 'default']);
        $this->config->reinit();
        $this->cache->clean(['config', 'full_page']);
        return $this->json(['ok' => true, 'vorige' => json_decode($oud, true)]);
    }

    public function canonical(bool $aan): string
    {
        $this->zetConfig('catalog/seo/product_canonical_tag', $aan ? '1' : '0');
        $this->zetConfig('catalog/seo/category_canonical_tag', $aan ? '1' : '0');
        $this->cache->clean(['full_page']);
        $this->log('canonical: ' . ($aan ? 'aan' : 'uit'));
        return $this->json(['ok' => true, 'aan' => $aan]);
    }

    public function legenCache(): string
    {
        $types = $this->cache->getAvailableTypes();
        $this->cache->clean($types);
        $this->log('cache geleegd');
        return $this->json(['ok' => true, 'types' => $types]);
    }

    public function bijwerkenIndexen(): string
    {
        @set_time_limit(900);
        $uit = [];
        foreach ($this->indexers->create()->getItems() as $i) {
            if (!$i->isInvalid()) {
                continue;
            }
            $start = microtime(true);
            try {
                $i->reindexAll();
                $uit[] = ['index' => $i->getId(), 'ok' => true, 'seconden' => round(microtime(true) - $start, 1)];
            } catch (\Throwable $e) {
                $uit[] = ['index' => $i->getId(), 'ok' => false, 'fout' => mb_substr($e->getMessage(), 0, 300)];
            }
        }
        $this->log('indexen: ' . json_encode($uit));
        return $this->json(['ok' => true, 'bijgewerkt' => $uit, 'niets_te_doen' => !$uit]);
    }

    // ---------- hulpjes ----------
    private function pad(string $adres): string
    {
        $a = trim($adres);
        $a = preg_replace('#^https?://[^/]+#i', '', $a) ?? $a;
        $a = preg_replace('#[?\#].*$#', '', $a) ?? $a;
        return ltrim($a, '/');
    }

    private function isEigenDomein(string $url): bool
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        foreach ($this->stores->getStores() as $s) {
            $eigen = strtolower((string) parse_url((string) $s->getBaseUrl(), PHP_URL_HOST));
            if ($host === $eigen || $host === 'www.' . $eigen || 'www.' . $host === $eigen) {
                return true;
            }
        }
        return false;
    }

    private function doelBestaat(array $r): bool
    {
        $c = $this->db->getConnection();
        $id = (int) $r['entity_id'];
        return match ($r['entity_type']) {
            'product' => (bool) $c->fetchOne($c->select()->from($this->db->getTableName('catalog_product_entity'), ['entity_id'])->where('entity_id = ?', $id)),
            'category' => (bool) $c->fetchOne($c->select()->from($this->db->getTableName('catalog_category_entity'), ['entity_id'])->where('entity_id = ?', $id)),
            'cms-page' => (bool) $c->fetchOne($c->select()->from($this->db->getTableName('cms_page'), ['page_id'])->where('page_id = ?', $id)->where('is_active = 1')),
            default => true,
        };
    }

    private function zetConfig(string $pad, string $waarde): void
    {
        $this->configWriter->save($pad, $waarde);
        $this->config->reinit();
        $this->cacheTypes->cleanType('config');
    }

    private function recenteFouten(): array
    {
        try {
            $map = $this->filesystem->getDirectoryRead(DirectoryList::LOG);
            if (!$map->isFile('exception.log')) {
                return [];
            }
            $pad = $map->getAbsolutePath('exception.log');
            $grootte = filesize($pad);
            $f = fopen($pad, 'rb');
            fseek($f, max(0, $grootte - 60000));
            $staart = (string) fread($f, 60000);
            fclose($f);
            preg_match_all('/^\[(\d{4}-\d\d-\d\d[T ][\d:]+)[^\]]*\]\s+\S+\.(?:CRITICAL|ERROR):\s*(.{0,200})/m', $staart, $m, PREG_SET_ORDER);
            return array_map(fn ($x) => ['tijd' => $x[1], 'melding' => $x[2]], array_slice($m, -5));
        } catch (\Throwable) {
            return [];
        }
    }

    private function log(string $tekst): void
    {
        try {
            $map = $this->filesystem->getDirectoryWrite(DirectoryList::LOG);
            $map->writeFile('sitehulpje.log', '[' . date('c') . '] ' . $tekst . PHP_EOL, 'a');
        } catch (\Throwable) {
        }
    }

    private function json(array $d): string
    {
        return (string) json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
}
