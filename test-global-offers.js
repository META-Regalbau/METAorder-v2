import pg from 'pg';
const { Client } = pg;

async function testGlobalOffers() {
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

    // Get GLOBAL (no tenant) settings
    const result = await client.query(
      `SELECT value FROM settings 
       WHERE key = 'shopware' AND tenant_id IS NULL 
       ORDER BY updated_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      console.log('❌ No global Shopware settings found');
      return;
    }

    const settings = result.rows[0].value;
    console.log('📋 Global Shopware Settings:');
    console.log('   URL:', settings.shopwareUrl);
    console.log('   API Key:', settings.apiKey?.substring(0, 30) + '...\n');

    // Authenticate
    console.log('🔐 Authenticating...');
    const authResponse = await fetch(`${settings.shopwareUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: settings.apiKey,
        client_secret: settings.apiSecret,
      }),
    });

    console.log(`   Response: ${authResponse.status} ${authResponse.statusText}`);

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.log('❌ Auth failed:', errorText.substring(0, 200));
      return;
    }

    const authData = await authResponse.json();
    const token = authData.access_token;
    console.log('✅ Authentication successful!\n');

    // Test orders endpoint
    console.log('🔍 Testing orders endpoint...');
    const ordersTest = await fetch(`${settings.shopwareUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ limit: 1, totalCountMode: 1 }),
    });
    
    if (ordersTest.ok) {
      const ordersData = await ordersTest.json();
      console.log(`   ✅ Orders work! Total: ${ordersData.total || 0}\n`);
    } else {
      console.log(`   ❌ Orders failed: ${ordersTest.status}\n`);
    }

    // Try common offer entity names
    console.log('🧪 Testing offer entity names...\n');
    const commonEntities = [
      'b2b-sellers-offer',
      'b2b_sellers_offer',
      'b2bsellers-offer',
      'b2b-offer',
      'quote',
      'offer',
      'prems-individual-offer',
      'quotation'
    ];

    let successCount = 0;

    for (const entityName of commonEntities) {
      const testResponse = await fetch(`${settings.shopwareUrl}/api/search/${entityName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 5, totalCountMode: 1 }),
      });

      if (testResponse.status === 404) {
        console.log(`   ⚠️  ${entityName}: Not found (404)`);
      } else if (testResponse.ok) {
        const data = await testResponse.json();
        successCount++;
        console.log(`   ✅ ${entityName}:`);
        console.log(`      Status: ${testResponse.status}`);
        console.log(`      Total: ${data.total || 0} offers`);
        
        if (data.total > 0 && data.data && data.data.length > 0) {
          const sampleOffer = data.data[0];
          console.log(`      Sample offer ID: ${sampleOffer.id}`);
          console.log(`      Available fields: ${Object.keys(sampleOffer).join(', ')}`);
          console.log('');
        }
      } else {
        console.log(`   ❌ ${entityName}: ${testResponse.status} ${testResponse.statusText}`);
      }
    }

    if (successCount === 0) {
      console.log('\n❌ Keine Angebots-Entität gefunden!');
      console.log('\n💡 Mögliche Lösungen:');
      console.log('   1. B2B Sellers Suite Plugin installieren');
      console.log('   2. Angebots-Plugin aktivieren');
      console.log('   3. API-Berechtigung für Angebote prüfen');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testGlobalOffers().catch(console.error);
