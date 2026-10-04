import pg from 'pg';
const { Client } = pg;

async function testAllTenants() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'metaorder',
    password: process.env.PGPASSWORD || 'metaorder',
    database: process.env.PGDATABASE || 'metaorder',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get all tenant Shopware settings
    const result = await client.query(
      `SELECT t.name, s.value FROM settings s 
       JOIN tenants t ON s.tenant_id = t.id 
       WHERE s.key = 'shopware'
       ORDER BY t.name`
    );

    for (const row of result.rows) {
      const tenantName = row.name;
      const settings = row.value;
      
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📋 Tenant: ${tenantName}`);
      console.log(`URL: ${settings.shopwareUrl}`);
      console.log(`API Key: ${settings.apiKey?.substring(0, 20)}... (${settings.apiKey?.length} chars)`);

      // Test authentication
      const authUrl = `${settings.shopwareUrl}/api/oauth/token`;

      try {
        const authResponse = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: settings.apiKey,
            client_secret: settings.apiSecret,
          }),
        });

        if (authResponse.ok) {
          console.log(`✅ Authentication: SUCCESS`);
        } else {
          const errorText = await authResponse.text();
          console.log(`❌ Authentication: FAILED (${authResponse.status})`);
          console.log(`   Error: ${errorText.substring(0, 100)}...`);
        }
      } catch (error) {
        console.log(`❌ Connection: FAILED`);
        console.log(`   Error: ${error.message}`);
      }
      
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testAllTenants().catch(console.error);
