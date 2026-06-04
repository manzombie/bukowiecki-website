<?php
session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/config.php';

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
    $password = isset($input['password']) ? (string)$input['password'] : '';
    if ($password !== '' && hash_equals(OWNER_PASSWORD, $password)) {
        $_SESSION['is_owner'] = true;
        json_response(['ok' => true, 'is_owner' => true]);
    }
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
    // Create backup
    if (file_exists($file)) {
        copy($file, __DIR__ . '/articles_backup_' . date('Y-m-d_His') . '.json');
    }
    $written = file_put_contents($file, json_encode($articles, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    if ($written === false) {
        json_response(['error' => 'Failed to write articles.json.'], 500);
    }
    json_response(['ok' => true, 'count' => count($articles)]);
}

json_response(['error' => 'Unknown action.'], 400);
