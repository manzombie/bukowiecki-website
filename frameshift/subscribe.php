<?php
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || empty($input['email'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Email is required']);
    exit;
}

$email = filter_var(trim($input['email']), FILTER_VALIDATE_EMAIL);

if (!$email) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid email address']);
    exit;
}

$file = __DIR__ . '/subscribers.json';

$subscribers = [];
if (file_exists($file)) {
    $data = file_get_contents($file);
    $subscribers = json_decode($data, true) ?: [];
}

// Check for duplicates
foreach ($subscribers as $sub) {
    if ($sub['email'] === $email) {
        echo json_encode(['success' => true, 'message' => 'Already subscribed']);
        exit;
    }
}

$subscribers[] = [
    'email' => $email,
    'date' => date('c'),
    'ip' => $_SERVER['REMOTE_ADDR'] ?? ''
];

file_put_contents($file, json_encode($subscribers, JSON_PRETTY_PRINT));

echo json_encode(['success' => true]);
