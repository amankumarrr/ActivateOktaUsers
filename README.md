# Okta Bulk User Processing Script (Activate / Delete)

This Node.js script performs bulk operations on **STAGED users** in an Okta tenant.

It supports two modes:

- Activate users (migration onboarding)
- Delete users (cleanup / purge staged accounts)

It includes safety features like dry-run mode, concurrency control, and rate-limit handling.

---

## ⚠️ Important Warning

This script performs bulk and potentially irreversible operations depending on configuration.

It may:

- Activate users in Okta
- Set passwords programmatically
- Delete Okta users (including permanent removal depending on tenant lifecycle state)
- Write sensitive credentials to a local CSV file (activate mode)

Use only in:

- Development or UAT environments first
- Controlled migration or cleanup windows
- Approved production change windows

---

## 🚀 Features

- Fetch all STAGED users from Okta
- Two execution modes: activate or delete
- Secure random password generation (activate mode)
- Bulk activation without email notifications
- Bulk deletion with lifecycle-safe handling
- Rate-limit aware retry mechanism (429 handling)
- Configurable concurrency control
- Configurable request delay (throttling)
- Dry-run mode (report-only execution)
- Progress tracking
- CSV export for credentials (activate mode)

---

## 📦 Prerequisites

- Node.js 18+
- Okta API Token with okta.users.manage
- Access to Okta Admin API

---

## 🔧 Setup

### Install dependencies

```bash
npm install
````

---

### Create .env file

```env
OKTA_API_TOKEN=your_api_token_here
OKTA_DOMAIN=your_okta_domain_here

ACTION=activate
CONCURRENCY=2
REQUEST_DELAY_MS=500
DRY_RUN=true
```

---

## ▶️ Usage

### Dry Run (Recommended First)

Dry run only shows user count and exits.

```bash
node main.js
```

Example output:

```text
Mode: activate
Found 9000 STAGED users
DRY RUN enabled. No users will be processed.
```

---

### Activate Users

```env
ACTION=activate
DRY_RUN=false
```

```bash
node main.js
```

---

### Delete Users

```env
ACTION=delete
DRY_RUN=false
```

```bash
node index.js
```

---

## ⚙️ Workflow

### Fetch STAGED users

```http
GET /api/v1/users?filter=status eq "STAGED"
```

---

### Activate mode

For each user:

* Generate secure password
* Set password in Okta
* Activate user without email
* Save credentials to CSV

---

### Delete mode

For each user:

* Delete user via Okta API
* Handle lifecycle transitions safely
* Retry on rate limits

---

## 🔁 Rate Limit Handling

* Automatic retry on 429 errors
* Fixed delay between requests (REQUEST_DELAY_MS)
* Respects Retry-After header
* Safe retry limit (default 10 attempts)

Recommended settings:

```env
CONCURRENCY=2
REQUEST_DELAY_MS=500
```

For large tenants:

```env
CONCURRENCY=1
REQUEST_DELAY_MS=1000
```

---

## ⚙️ Concurrency Control

* 1–2 → safe for large migrations
* 3–5 → balanced
* 5+ → risky (rate limits likely)

---

## 🔐 Security Notes

* CSV contains plain-text passwords (activate mode only)
* Delete after migration
* Never commit .env or CSV files

Add to .gitignore:

```text
.env
okta-users-passwords.csv
```

---

## 🧪 Testing Flow

1. Set DRY_RUN=true
2. Run script
3. Validate user count
4. Test with small batch (1–5 users)
5. Run in test tenant
6. Execute production run

---

## 📊 Expected Results

### Activate mode

* STAGED → ACTIVE
* Password generated
* CSV created

### Delete mode

* STAGED → DEPROVISIONED or REMOVED (depends on Okta lifecycle rules)

---

## 🛠 Troubleshooting

### 401 Unauthorized

* Invalid API token

### 429 Too Many Requests

* Reduce concurrency
* Increase request delay

### Users not fully deleted

* Okta lifecycle transitions may require multiple steps

---

## 📌 Notes

Designed for:

* Bulk migrations
* Bulk onboarding
* Bulk cleanup of Okta staged users

Optimized for reliability over speed, especially for large datasets (9000+ users).
