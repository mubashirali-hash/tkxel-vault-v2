#!/usr/bin/env node
/**
 * tkxel Vault - Infrastructure Verification Script
 * Validates connectivity to PostgreSQL (verifying pgvector and uuid-ossp extensions) and Redis.
 */

const { Client } = require('pg');
const net = require('net');

async function checkPostgres() {
  const client = new Client({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgrespassword',
    database: process.env.PG_DATABASE || 'tkxel_vault',
  });

  try {
    await client.connect();
    console.log('✅ PostgreSQL: Connected successfully.');

    const res = await client.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('vector', 'uuid-ossp');
    `);

    const extensions = res.rows.map(r => `${r.extname} (v${r.extversion})`);
    console.log('✅ PostgreSQL Extensions Active:', extensions.join(', '));

    const vectorFound = res.rows.some(r => r.extname === 'vector');
    const uuidFound = res.rows.some(r => r.extname === 'uuid-ossp');

    if (!vectorFound || !uuidFound) {
      throw new Error(`Missing required extensions! Found: ${JSON.stringify(extensions)}`);
    }

    // Test a vector operation
    const vectorTest = await client.query(`SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector AS distance;`);
    console.log(`✅ Vector math test passed. Distance: ${vectorTest.rows[0].distance}`);

    await client.end();
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL Error:', err.message);
    try { await client.end(); } catch (e) {}
    return false;
  }
}

function checkTcpPort(host, port, serviceName) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);

    socket.on('connect', () => {
      console.log(`✅ ${serviceName}: Port ${port} is open and reachable.`);
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      console.error(`❌ ${serviceName}: Port ${port} connection timed out.`);
      socket.destroy();
      resolve(false);
    });

    socket.on('error', (err) => {
      console.error(`❌ ${serviceName}: Port ${port} connection failed: ${err.message}`);
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function main() {
  console.log('====================================================');
  console.log('  tkxel Vault - Local Infrastructure Verification');
  console.log('====================================================\n');

  const redisOk = await checkTcpPort(process.env.REDIS_HOST || 'localhost', 6379, 'Redis');
  const pgPortOk = await checkTcpPort(process.env.PG_HOST || 'localhost', 5432, 'PostgreSQL Port');

  let pgOk = false;
  if (pgPortOk) {
    pgOk = await checkPostgres();
  }

  console.log('\n----------------------------------------------------');
  if (redisOk && pgOk) {
    console.log('🎉 ALL INFRASTRUCTURE CHECKS PASSED!');
    process.exit(0);
  } else {
    console.error('⚠️ Some infrastructure checks failed. Ensure "docker compose up -d" is running.');
    process.exit(1);
  }
}

main();
