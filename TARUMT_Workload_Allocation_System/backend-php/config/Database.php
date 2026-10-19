<?php

declare(strict_types=1);

/**
 * PDO connection factory (raw SQL, no ORM).
 *
 * Reads DB_* + CORS_ORIGIN + APP_* values from the environment. When
 * vlucas/phpdotenv is installed (composer install) index.php loads .env
 * already; otherwise the fallback loader below parses .env directly so
 * the service also runs on a bare PHP install (e.g. XAMPP).
 */

if (!function_exists('tarumt_load_env')) {
    function tarumt_load_env(string $root): void
    {
        $file = $root . '/.env';
        if (!is_file($file)) {
            return;
        }
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
            $key   = trim($key);
            $value = trim($value, " \t\"'");
            if ($key !== '' && getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }
}

final class Database
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dsn = sprintf(
            'pgsql:host=%s;port=%s;dbname=%s',
            getenv('DB_HOST') ?: '127.0.0.1',
            getenv('DB_PORT') ?: '5432',
            getenv('DB_NAME') ?: 'teaching_workload_db'
        );

        self::$pdo = new PDO(
            $dsn,
            getenv('DB_USER') ?: 'postgres',
            getenv('DB_PASS') !== false ? getenv('DB_PASS') : '',
            [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]
        );

        return self::$pdo;
    }
}
