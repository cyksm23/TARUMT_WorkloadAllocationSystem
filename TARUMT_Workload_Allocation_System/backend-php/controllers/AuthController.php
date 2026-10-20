<?php

declare(strict_types=1);

/**
 * Auth controller — POST /api/auth/login
 *
 * Verifies a 4-digit lecturer code + password.
 *  * lecturer code = the 4 digits of lecturers.staff_id, e.g. code 1001 -> 'L1001'
 *  * code 0000     = the admin account (users.username = 'admin')
 * Passwords are bcrypt hashes in users.password_hash (seeded via pgcrypto).
 */

require_once __DIR__ . '/../config/Database.php';

final class AuthController
{
    /** @var string HS256 signing key (dev default; override via APP_SECRET env) */
    private const APP_SECRET_DEFAULT = 'dev-secret-change-me';

    public function login(): void
    {
        $input  = json_decode(file_get_contents('php://input') ?: '{}', true) ?? [];
        $code   = trim((string)($input['code'] ?? ''));
        $password = (string)($input['password'] ?? '');

        if (! preg_match('/^\d{4}$/', $code)) {
            $this->json(400, ['ok' => false, 'message' => 'Staff ID must be exactly 4 digits.']);
            return;
        }
        if ($password === '') {
            $this->json(400, ['ok' => false, 'message' => 'Password is required.']);
            return;
        }

        $lookup = 'L' . $code;
        $isAdmin = $code === '0000';

        try {
            $sql = 'SELECT u.id AS user_id, u.username, u.email, u.role, u.password_hash, u.is_active,
                           l.id AS lecturer_id, l.staff_id, l.full_name, l.position,
                           l.employment_type, l.max_workload_hours,
                           d.department_code, d.department_name
                    FROM users u
                    LEFT JOIN lecturers l ON l.user_id = u.id
                    LEFT JOIN departments d ON d.id = l.department_id
                    WHERE (l.staff_id = :lookup OR (:lookup = :admin_lookup AND u.username = :admin_username))
                    LIMIT 1';
            $stmt = Database::pdo()->prepare($sql);
            $stmt->execute([
                ':lookup'        => $isAdmin ? '__none__' : $lookup,
                ':admin_lookup'  => '0000',
                ':admin_username'=> 'admin',
            ]);
            $user = $stmt->fetch();
        } catch (Throwable $e) {
            $this->json(503, ['ok' => false, 'message' => 'Database not reachable: ' . $e->getMessage()]);
            return;
        }

        if (! $user || ! password_verify($password, (string)$user['password_hash'])) {
            $this->json(401, ['ok' => false, 'message' => 'Invalid Staff ID or password.']);
            return;
        }
        if ($user['is_active'] === false) {
            $this->json(403, ['ok' => false, 'message' => 'This account is deactivated.']);
            return;
        }

        // Update last_login (best effort; schema guarantees the column exists).
        try {
            $upd = Database::pdo()->prepare('UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = :id');
            $upd->execute([':id' => $user['user_id']]);
        } catch (Throwable $e) {
            // non-fatal
        }

        $now  = time();
        $ttl  = 12 * 3600;
        $payload = [
            'sub'   => (int)$user['user_id'],
            'role'  => $user['role'],
            'staff' => $user['staff_id'],
            'iat'   => $now,
            'exp'   => $now + $ttl,
        ];
        $token = self::signJwt($payload, (string)(getenv('APP_SECRET') ?: self::APP_SECRET_DEFAULT), $ttl);

        $this->json(200, [
            'ok'      => true,
            'token'   => $token,
            'expires' => $now + $ttl,
            'user'    => [
                'id'         => (int)$user['user_id'],
                'username'   => $user['username'],
                'email'      => $user['email'],
                'role'       => $user['role'],
                'staffId'    => $user['staff_id'],
                'code'       => $code,
                'fullName'   => $user['full_name'],
                'position'   => $user['position'],
                'employmentType' => $user['employment_type'],
                'department' => $user['department_code'],
                'departmentName' => $user['department_name'],
            ],
        ]);
    }

    /** Minimal HS256 JWT signer (no external dependency). */
    private static function signJwt(array $payload, string $secret, int $ttl): string
    {
        $b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $segments = [
            $b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT'])),
            $b64(json_encode($payload)),
        ];
        $sig = hash_hmac('sha256', implode('.', $segments), $secret, true);
        return implode('.', $segments) . '.' . $b64($sig);
    }

    private function json(int $status, array $payload): void
    {
        http_response_code($status);
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }
}
