require('dotenv').config({ path: 'config.env' });

const sdk = require('node-appwrite');
const csv = require('csv-parser');
const fs = require('fs');
const crypto = require('crypto');

// ---------------- Appwrite Client ----------------
const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT) // ex: https://[HOSTNAME]/v1
  .setProject(process.env.APPWRITE_PROJECT_ID) // seu Project ID
  .setKey(process.env.APPWRITE_API_KEY); // sua API Key

const database = new sdk.Databases(client, process.env.APPWRITE_DATABASE_ID);

// ---------------- Utility Functions ----------------

// Gera username e senha únicos
function generateCredentials() {
  return {
    username: 'VIP' + crypto.randomBytes(3).toString('hex'), // VIP + 6 chars
    password: crypto.randomBytes(6).toString('hex') // 12 chars hex
  };
}

// Lê produtos do CSV
function readProducts(csvFile) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

// ---------------- Fraud Detection ----------------
async function checkFraud(user) {
  // Exemplo básico de antifraude
  if (!user.email || user.email.endsWith('@tempmail.com')) return true;

  const blocked = await database.listDocuments('blocked_entities', [`user_id=${user.$id}`]);
  if (blocked.total > 0) return true;

  return false;
}

// ---------------- VIP Access ----------------
async function createVIPAccess(user, product) {
  try {
    // 1️⃣ Checa antifraude
    if (await checkFraud(user)) {
      await database.createDocument('fraud_logs', {
        user_id: user.$id,
        product_id: product.$id,
        reason: 'Fraud detected',
        created_at: new Date().toISOString()
      });
      return { status: 'fraud', message: 'Access blocked' };
    }

    // 2️⃣ Cria credenciais únicas
    const { username, password } = generateCredentials();
    await database.createDocument('vip_credentials', {
      user_id: user.$id,
      product_id: product.$id,
      username,
      password,
      created_at: new Date().toISOString()
    });

    // 3️⃣ Cria subscription
    await database.createDocument('subscriptions', {
      user_id: user.$id,
      product_id: product.$id,
      price: parseFloat(product.price || 0),
      billing_interval: product.billing_interval || 'one-time',
      status: 'active',
      created_at: new Date().toISOString()
    });

    // 4️⃣ Cria order
    await database.createDocument('orders', {
      user_id: user.$id,
      product_id: product.$id,
      price: parseFloat(product.price || 0),
      billing_interval: product.billing_interval || 'one-time',
      status: 'paid',
      created_at: new Date().toISOString()
    });

    // 5️⃣ Log de acesso VIP
    await database.createDocument('vip_access_logs', {
      user_id: user.$id,
      product_id: product.$id,
      username,
      access_time: new Date().toISOString()
    });

    // 6️⃣ Log de atividade do usuário
    await database.createDocument('user_activity', {
      user_id: user.$id,
      activity: `Accessed product ${product.name}`,
      timestamp: new Date().toISOString()
    });

    return { status: 'success', username, password };
  } catch (err) {
    console.error(err);
    return { status: 'error', message: err.message };
  }
}

// ---------------- Authentication ----------------
async function validateCredentials(username, password) {
  const result = await database.listDocuments('vip_credentials', [
    `username=${username}`,
    `password=${password}`
  ]);
  return result.total > 0;
}

// ---------------- Main Function ----------------
async function main() {
  try {
    const products = await readProducts('products.csv');
    const usersList = await database.listDocuments('users');

    for (const user of usersList.documents) {
      for (const product of products) {
        const result = await createVIPAccess(user, product);
        console.log(`User ${user.name} access to ${product.name}:`, result);
      }
    }

    console.log('VIP access process completed successfully!');
  } catch (err) {
    console.error('Error in main:', err);
  }
}

// Executa a função
main();