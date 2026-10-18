<?php

declare(strict_types=1);

// Unit-Tests ohne Shopware: Autoloader mit phpunit, symfony/http-client und psr/log (vendor/ des Plugins oder
// META_TEST_AUTOLOAD), dazu die Plugin-Klassen selbst.
$autoload = getenv('META_TEST_AUTOLOAD') ?: __DIR__ . '/../vendor/autoload.php';
require $autoload;

spl_autoload_register(static function (string $class): void {
    $map = ['Meta\\CartSignal\\Tests\\' => __DIR__ . '/', 'Meta\\CartSignal\\' => __DIR__ . '/../src/'];
    foreach ($map as $prefix => $dir) {
        if (str_starts_with($class, $prefix)) {
            $file = $dir . str_replace('\\', '/', substr($class, \strlen($prefix))) . '.php';
            if (is_file($file)) {
                require $file;
            }

            return;
        }
    }
});
