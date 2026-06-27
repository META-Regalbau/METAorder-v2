import pg from 'pg';
const { Client } = pg;

async function testLiveOffers() {
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

    // Get LIVE tenant settings
    const result = await client.query(
      `SELECT s.value FROM settings s 
       JOIN tenants t ON s.tenant_id = t.id 
       WHERE s.key = 'shopware' AND t.name = 'Live'`
    );

    if (result.rows.length === 0) {
      console.log('❌ No settings found for Live tenant');
      return;
    }

    const settings = result.rows[0].value;
    console.log('📋 Live Tenant - Shopware:', settings.shopwareUrl);
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
      console.log('❌ Auth failed:', errorText);
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
      body: JSON.stringify({ limit: 1 }),
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
      'quote',
      'b2b-offer',
      'offer',
      'prems-individual-offer',
      'b2b-quotation',
      'quotation'
    ];

    let foundEntity = null;

    for (const entityName of commonEntities) {
      const testResponse = await fetch(`${settings.shopwareUrl}/api/search/${entityName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ limit: 1, totalCountMode: 1 }),
      });

      const statusIcon = testResponse.status === 404 ? '⚠️' : testResponse.ok ? '✅' : '❌';
      console.log(`   ${statusIcon} ${entityName}: ${testResponse.status} ${testResponse.statusText}`);
      
      if (testResponse.ok) {
        const data = await testResponse.json();
        console.log(`      📊 Total: ${data.total || 0} offers`);
        
        if (data.total > 0) {
          foundEntity = entityName;
          if (data.data && data.data.length > 0) {
            const sampleOffer = data.data[0];
            console.log(`      📋 Sample offer structure:`);
            console.log(`         ID: ${sampleOffer.id}`);
            console.log(`         Keys: ${Object.keys(sampleOffer).slice(0, 15).join(', ')}`);
            
            // Try to find status-like fields
            const statusFields = Object.keys(sampleOffer).filter(k => 
              k.toLowerCase().includes('status') || 
              k.toLowerCase().includes('state')
            );
            if (statusFields.length > 0) {
              console.log(`         Status fields: ${statusFields.join(', ')}`);
            }
          }
          break;
        }
      }
    }

    if (!foundEntity) {
      console.log('\n⚠️  Keine Angebots-Entität gefunden!');
      console.log('   Mögliche Ursachen:');
      console.log('   - B2B Sellers Suite ist nicht installiert');
      console.log('   - Angebots-Plugin hat einen anderen Namen');
      console.log('   - Keine Berechtigung für Angebote');
    } else {
      console.log(`\n✅ Angebots-Entität gefunden: ${foundEntity}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

testLiveOffers().catch(console.error);
