# Okta Bulk User Activation Script

This Node.js script activates all **STAGED users** in an Okta tenant, assigns a randomly generated password, and logs the results for migration tracking.

It is designed for controlled migration scenarios such as onboarding users from legacy systems into Okta.

---

## ⚠️ Important Warning

This script performs bulk updates on user accounts.

It will:

* Activate users in Okta
* Set passwords programmatically
* Write credentials to a local CSV file

Use only in:

* Development or UAT environments first
* Controlled migration windows

Do not run in production without validation and approval.

---

## 🚀 Features

* Fetch all STAGED users from Okta
* Generate secure random passwords per user
* Set password via Okta API
* Activate users without sending email
* Verify final user status
* Concurrency control for safe execution
* CSV export of credentials
* Dry-run mode for testing

---

## 📦 Prerequisites

* Node.js 18+
* Okta API Token with `okta.users.manage`
* Access to Okta Admin API

---

## 🔧 Setup

### 1. Install dependencies

```bash
npm install i
```
---

### 2. Create `.env` file

```env
OKTA_API_TOKEN=your_api_token_here
OKTA_DOMAIN=your_okta_domain_here
CONCURRENCY=5 //default to 5
DRY_RUN= true // default to true
```

---

## ▶️ Usage

### Dry Run (Recommended First)

```javascript
const DRY_RUN = true;
```

```bash
node main.js
```

No changes will be made.

---

### Full Execution

```javascript
const DRY_RUN = false;
```

```bash
node index.js
```

---

## ⚙️ Workflow

### 1. Fetch STAGED users

Users are retrieved using:

```
GET /api/v1/users?filter=status eq "STAGED"
```

---

### 2. Generate password

Each user gets a unique secure password containing:

* Uppercase letters
* Lowercase letters
* Numbers
* Special characters

---

### 3. Set password

```
POST /api/v1/users/{id}
```

Password is assigned directly to the user's credentials.

---

### 4. Activate user

```
POST /api/v1/users/{id}/lifecycle/activate?sendEmail=false
```

* No email is sent
* User becomes ACTIVE

---

### 5. Export credentials

Saved to:

```
okta-users-passwords.csv
```

Format:

```
email,password
user@example.com,Ab12!xYz9...
```

---

## ⚙️ Concurrency Control

Default:

```javascript
const CONCURRENCY = 5;
```

Recommended values:

* 5 → safest
* 10 → balanced
* 15+ → risky (rate limits may occur)

---

## 🔐 Security Notes

* CSV file contains plain-text passwords
* Store securely (encrypted storage recommended)
* Delete file after migration completion
* Never commit `.env` or CSV files

Add to `.gitignore`:

```
.env
okta-users-passwords.csv
```

---

## 🧪 Recommended Testing Flow

1. Enable `DRY_RUN = true`
2. Test with 1–5 users
3. Validate activation status
4. Run full migration
5. Secure generated password file
6. Clean up logs

---

## 📊 Expected Result

After execution:

* Users move from STAGED → ACTIVE
* Each user has a unique password
* No activation emails are sent
* Credentials are exported for reference

---

## 🛠 Troubleshooting

### 401 Unauthorized

* Invalid API token
* Token created in wrong Okta org

### Password policy error

* Password generator not meeting policy

### 429 Too Many Requests

* Reduce concurrency

---

## 📌 Notes

This script is intended for migration scenarios where:

* Password hashes are not migrated
* Users must be onboarded into Okta
* Silent activation is required
