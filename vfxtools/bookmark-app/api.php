<?php
// Harden the session cookie: HttpOnly (no JS access), Secure (HTTPS only),
// SameSite=Strict (a forged cross-site POST can't send the cookie — this is the
// CSRF control for the owner-only save action).
if (PHP_VERSION_ID >= 70300) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'secure'   => true,
        'samesite' => 'Strict',
    ]);
} else {
    session_set_cookie_params(0, '/; samesite=Strict', '', true, true);
}
session_start();
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/config.php';

// --- Login throttle (file-based, keyed by IP) -------------------------------
// Bounds brute-force against the single shared password. Stored outside the
// web-servable path (system temp) so the file itself is never fetchable.
define('THROTTLE_MAX_FAILS', 5);      // fails allowed within the window
define('THROTTLE_WINDOW',   600);     // 10 min rolling window
define('THROTTLE_LOCKOUT',  600);     // 10 min lockout once tripped

function throttle_file() {
    return sys_get_temp_dir() . '/bmark_throttle_' . md5(__DIR__) . '.json';
}
function throttle_read() {
    $f = throttle_file();
    if (!is_file($f)) return [];
    $d = json_decode(@file_get_contents($f), true);
    return is_array($d) ? $d : [];
}
function throttle_write($data) {
    @file_put_contents(throttle_file(), json_encode($data), LOCK_EX);
}
function client_ip() {
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
}
// Returns seconds remaining if locked, else 0.
function throttle_locked_for($ip) {
    $data = throttle_read();
    if (isset($data[$ip]['locked_until']) && $data[$ip]['locked_until'] > time()) {
        return $data[$ip]['locked_until'] - time();
    }
    return 0;
}
function throttle_register_fail($ip) {
    $data = throttle_read();
    $now  = time();
    $e = isset($data[$ip]) ? $data[$ip] : ['fails' => 0, 'first' => $now, 'locked_until' => 0];
    if ($now - $e['first'] > THROTTLE_WINDOW) { $e = ['fails' => 0, 'first' => $now, 'locked_until' => 0]; }
    $e['fails']++;
    if ($e['fails'] >= THROTTLE_MAX_FAILS) { $e['locked_until'] = $now + THROTTLE_LOCKOUT; }
    $data[$ip] = $e;
    throttle_write($data);
}
function throttle_clear($ip) {
    $data = throttle_read();
    unset($data[$ip]);
    throttle_write($data);
}

function json_response($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function require_owner() {
    if (empty($_SESSION['is_owner'])) {
        json_response(['error' => 'Owner authentication required.'], 403);
    }
}

$action = isset($_GET['action']) ? $_GET['action'] : '';
$input = json_decode(file_get_contents('php://input'), true) ?: [];

// --- Status ---
if ($action === 'status') {
    json_response(['is_owner' => !empty($_SESSION['is_owner'])]);
}

// --- Login ---
if ($action === 'login') {
    $ip = client_ip();
    $locked = throttle_locked_for($ip);
    if ($locked > 0) {
        json_response(['error' => 'Too many attempts. Try again in ' . ceil($locked / 60) . ' min.'], 429);
    }
    $password = isset($input['password']) ? (string)$input['password'] : '';
    if ($password !== '' && hash_equals(OWNER_PASSWORD, $password)) {
        throttle_clear($ip);
        session_regenerate_id(true); // prevent session fixation
        $_SESSION['is_owner'] = true;
        json_response(['ok' => true, 'is_owner' => true]);
    }
    throttle_register_fail($ip);
    json_response(['error' => 'Invalid password.'], 401);
}

// --- Logout ---
if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    json_response(['ok' => true, 'is_owner' => false]);
}

// --- Load (public) ---
if ($action === 'load') {
    $file = __DIR__ . '/articles.json';
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true);
        json_response($data ?: []);
    }
    json_response([]);
}

// --- Save (owner only) ---
if ($action === 'save') {
    require_owner();
    $articles = isset($input['articles']) ? $input['articles'] : null;
    if (!is_array($articles)) {
        json_response(['error' => 'Invalid articles data.'], 400);
    }
    $file = __DIR__ . '/articles.json';
    // Create backup, then keep only the most recent 10 to stop them piling up
    // in the web root.
    if (file_exists($file)) {
        copy($file, __DIR__ . '/articles_backup_' . date('Y-m-d_His') . '.json');
        $backups = glob(__DIR__ . '/articles_backup_*.json');
        if ($backups && count($backups) > 10) {
            sort($backups); // oldest first (timestamped names sort chronologically)
            foreach (array_slice($backups, 0, count($backups) - 10) as $old) {
                @unlink($old);
            }
        }
    }
    $written = file_put_contents($file, json_encode($articles, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    if ($written === false) {
        json_response(['error' => 'Failed to write articles.json.'], 500);
    }
    json_response(['ok' => true, 'count' => count($articles)]);
}

json_response(['error' => 'Unknown action.'], 400);
