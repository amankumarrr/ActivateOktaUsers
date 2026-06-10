require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");

const OKTA_DOMAIN = process.env.OKTA_DOMAIN;
const API_TOKEN = process.env.OKTA_API_TOKEN;

const DRY_RUN = process.env.DRY_RUN;
const CONCURRENCY = process.env.CONCURRENCY;

// ===============================
// PASSWORD GENERATOR
// ===============================
function generatePassword(length = 16) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nums = "0123456789";
  const special = "!@#$%^&*()_+-=[]{}";

  const all = lower + upper + nums + special;

  let pwd = "";

  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += nums[Math.floor(Math.random() * nums.length)];
  pwd += special[Math.floor(Math.random() * special.length)];

  const bytes = crypto.randomBytes(length);

  for (let i = pwd.length; i < length; i++) {
    pwd += all[bytes[i] % all.length];
  }

  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

// ===============================
// GLOBAL RETRY WRAPPER (429 SAFE)
// ===============================
async function requestWithRetry(fn, retries = 5) {
  let attempt = 0;

  while (attempt < retries) {
    const res = await fn();

    if (res.status !== 429) return res;

    const retryAfter = res.headers.get("retry-after");
    const waitTime = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.pow(2, attempt) * 1000;

    console.warn(
      `⚠️ Rate limited. Retry in ${waitTime}ms (attempt ${attempt + 1})`
    );

    await new Promise((r) => setTimeout(r, waitTime));

    attempt++;
  }

  throw new Error("Too many retries (429 persistent)");
}

// ===============================
// FETCH STAGED USERS
// ===============================
async function getStagedUsers() {
  let users = [];
  let url = `${OKTA_DOMAIN}/api/v1/users?filter=status eq "STAGED"&limit=200`;

  while (url) {
    const res = await requestWithRetry(() =>
      fetch(url, {
        headers: {
          Authorization: `SSWS ${API_TOKEN}`,
          Accept: "application/json",
        },
      })
    );

    if (!res.ok) {
      throw new Error(await res.text());
    }

    const data = await res.json();
    users = users.concat(data);

    const link = res.headers.get("link");
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  return users;
}

// ===============================
// SET PASSWORD
// ===============================
async function setPassword(userId, password) {
  return requestWithRetry(() =>
    fetch(`${OKTA_DOMAIN}/api/v1/users/${userId}`, {
      method: "POST",
      headers: {
        Authorization: `SSWS ${API_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credentials: {
          password: { value: password },
        },
      }),
    })
  );
}

// ===============================
// ACTIVATE USER
// ===============================
async function activateUser(userId) {
  return requestWithRetry(() =>
    fetch(
      `${OKTA_DOMAIN}/api/v1/users/${userId}/lifecycle/activate?sendEmail=false`,
      {
        method: "POST",
        headers: {
          Authorization: `SSWS ${API_TOKEN}`,
          Accept: "application/json",
        },
      }
    )
  );
}

// ===============================
// CONCURRENCY POOL
// ===============================
async function runPool(items, limit, fn) {
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);

    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

// ===============================
// PROCESS USER
// ===============================
async function processUser(user) {
  const email = user.profile.email;

  if (DRY_RUN) {
    console.log(`[DRY RUN] ${email}`);
    return;
  }

  try {
    const password = generatePassword();

    await setPassword(user.id, password);
    await new Promise((r) => setTimeout(r, 300)); // small throttle

    await activateUser(user.id);

    console.log(`✓ Activated: ${email}`);

    fs.appendFileSync(
      "okta-users-passwords.csv",
      `${email},${password}\n`
    );
  } catch (err) {
    console.error(`✗ Failed: ${email}`);
    console.error(err.message);
  }
}

// ===============================
// MAIN
// ===============================
async function main() {
  const users = await getStagedUsers();

  console.log(`Found ${users.length} STAGED users`);

  await runPool(users, CONCURRENCY, processUser);

  console.log("Completed migration");
}

main().catch(console.error);