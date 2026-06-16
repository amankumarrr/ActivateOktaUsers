require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");

const OKTA_DOMAIN = process.env.OKTA_DOMAIN;
const API_TOKEN = process.env.OKTA_API_TOKEN;

const DRY_RUN = process.env.DRY_RUN === "true";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "5", 10);
const ACTION = (process.env.ACTION || "activate").toLowerCase();

if (!OKTA_DOMAIN || !API_TOKEN) {
  console.error("Missing OKTA_DOMAIN or OKTA_API_TOKEN");
  process.exit(1);
}

if (!["activate", "delete"].includes(ACTION)) {
  console.error(
    'Invalid ACTION. Supported values are "activate" or "delete".'
  );
  process.exit(1);
}

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

  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// ===============================
// GLOBAL THROTTLE
// ===============================
const REQUEST_DELAY_MS = 500;

// ===============================
// GLOBAL RETRY WRAPPER (429 SAFE)
// ===============================
async function requestWithRetry(fn, retries = 10) {
  let attempt = 0;

  while (attempt < retries) {
    // throttle every request
    await new Promise((resolve) =>
      setTimeout(resolve, REQUEST_DELAY_MS)
    );

    const res = await fn();

    if (res.status !== 429) {
      return res;
    }

    const retryAfter = res.headers.get("retry-after");

    const waitTime = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : 60 * 1000;

    console.warn(
      `⚠️ Rate limited (429). Waiting ${
        waitTime / 1000
      } seconds before retry ${attempt + 1}/${retries}`
    );

    await new Promise((resolve) =>
      setTimeout(resolve, waitTime)
    );

    attempt++;
  }

  throw new Error(
    `Too many retries. Hit Okta rate limits ${retries} times.`
  );
}
// ===============================
// FETCH STAGED USERS
// ===============================
async function getStagedUsers() {
  let users = [];

  let url =
    `${OKTA_DOMAIN}/api/v1/users` +
    `?filter=status eq "STAGED"&limit=200`;

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

    const next = link?.match(
      /<([^>]+)>;\s*rel="next"/
    );

    url = next ? next[1] : null;
  }

  return users;
}

// ===============================
// SET PASSWORD
// ===============================
async function setPassword(userId, password) {
  const res = await requestWithRetry(() =>
    fetch(`${OKTA_DOMAIN}/api/v1/users/${userId}`, {
      method: "POST",
      headers: {
        Authorization: `SSWS ${API_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credentials: {
          password: {
            value: password,
          },
        },
      }),
    })
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

// ===============================
// ACTIVATE USER
// ===============================
async function activateUser(userId) {
  const res = await requestWithRetry(() =>
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

  if (!res.ok) {
    throw new Error(await res.text());
  }
}

// ===============================
// DELETE USER
// ===============================
async function deleteUser(userId) {
  const res = await requestWithRetry(() =>
    fetch(`${OKTA_DOMAIN}/api/v1/users/${userId}`, {
      method: "DELETE",
      headers: {
        Authorization: `SSWS ${API_TOKEN}`,
        Accept: "application/json",
      },
    })
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }
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
// ACTIVATE FLOW
// ===============================
async function activateStagedUser(user) {
  const email = user.profile.email;

  const password = generatePassword();

  await setPassword(user.id, password);

  await new Promise((resolve) => setTimeout(resolve, 300));

  await activateUser(user.id);

  fs.appendFileSync(
    "okta-users-passwords.csv",
    `${email},${password}\n`
  );

  console.log(`✓ Activated: ${email}`);
}

// ===============================
// DELETE FLOW
// ===============================
async function deleteStagedUser(user) {
  const email = user.profile.email;

  await deleteUser(user.id);

  console.log(`✓ Deleted: ${email}`);
}

// ===============================
// PROCESS USER
// ===============================
async function processUser(user) {
  try {
    if (ACTION === "activate") {
      await activateStagedUser(user);
      return;
    }

    if (ACTION === "delete") {
      await deleteStagedUser(user);
      return;
    }
  } catch (err) {
    console.error(`✗ Failed: ${user.profile.email}`);
    console.error(err.message);
  }
}

// ===============================
// MAIN
// ===============================
async function main() {
  console.log(`Mode: ${ACTION}`);

  const users = await getStagedUsers();

  console.log(`Found ${users.length} STAGED users`);

  if (DRY_RUN) {
    console.log(
      `DRY RUN enabled. No users will be ${ACTION}d.`
    );
    return;
  }

  if (users.length === 0) {
    console.log("No staged users found.");
    return;
  }

  if (ACTION === "activate") {
    fs.writeFileSync(
      "okta-users-passwords.csv",
      "email,password\n"
    );
  }

  await runPool(users, CONCURRENCY, processUser);

  console.log(`Completed ${ACTION} operation`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
