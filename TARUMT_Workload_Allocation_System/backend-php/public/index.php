<?php

declare(strict_types=1);

/**
 * TARUMT Teaching Workload Allocation System
 * Minimal front controller.
 *
 * Future: dispatch to controllers via a router
 * (routes/ + controllers/ + middleware/).
 */

$root = dirname(__DIR__);

// Load .env when composer dependencies are installed (vlucas/phpdotenv).
if (file_exists($root . '/vendor/autoload.php')) {
    require_once $root . '/vendor/autoload.php';
    \Dotenv\Dotenv::createImmutable($root)->safeLoad();
}

// ── CORS ─────────────────────────────────────────────────────────
$origin = getenv('CORS_ORIGIN') ?: 'http://localhost:3000';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Routing (minimal) ────────────────────────────────────────────
$path = rtrim(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH), '/');

$send = function (int $code, array $payload): void {
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
};

match (true) {
    $path === '/api/health' => $send(200, ['status' => 'ok', 'service' => 'php-api']),

    // Auth — verifies 4-digit lecturer code (staff_id 'L1001' -> '1001',
    // '0000' -> admin) + bcrypt password against the users/lecturers tables.
    $path === '/api/auth/login' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' => (function () use ($send) {
        require_once dirname(__DIR__) . '/controllers/AuthController.php';
        (new AuthController())->login();
    })(),

    default                 => $send(404, ['status' => 'error', 'message' => 'Route not found']),
};
