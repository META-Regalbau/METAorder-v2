import pg from 'pg';
const { Client } = pg;

async function testShopwareEntities() {
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

    // Get Testing tenant settings (since user is using Testing tenant)
    const result = await client.query(
      `SELECT s.value FROM settings s 
       JOIN tenants t ON s.tenant_id = t.id 
       WHERE s.key = 'shopware' AND t.name = 'Testing'`
    );

    if (result.rows.length === 0) {
      console.log('❌ No settings found for Testing tenant');
      return;
    }

    const settings = result.rows[0].value;
    console.log('📋 Testing Tenant - Shopware:', settings.shopwareUrl);

    // Authenticate
    const authResponse = await fetch(`${settings.shopwareUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: settings.apiKey,
        client_secret: settings.apiSecret,
      }),
    });

    if (!authResponse.ok) {
      console.log('❌ Auth failed:', authResponse.status);
      return;
    }

    const authData = await authResponse.json();
    const token = authData.access_token;
    console.log('✅ Authentication successful\n');

    // Test orders endpoint (to confirm API works)
    console.log('🔍 Testing orders endpoint...');
    const ordersTest = await fetch(`${settings.shopwareUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ limit: 1 }),
    });
    console.log(`   Orders: ${ordersTest.status} ${ordersTest.statusText}`);
    if (ordersTest.ok) {
      const ordersData = await ordersTest.json();
      console.log(`   ✅ Orders work! Total: ${ordersData.total || 0}\n`);
    }

    // Try to get entity schema
    console.log('🔍 Fetching entity schema...');
    const schemaResponse = await fetch(`${settings.shopwareUrl}/api/_info/entity-schema`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (schemaResponse.ok) {
      const schema = await schemaResponse.json();
      let entities = [];

      if (schema?.entities) {
        entities = Object.keys(schema.entities);
      } else if (schema?.definitions) {
        entities = Object.keys(schema.definitions);
      }

      console.log(`   Found ${entities.length} entities\n`);

      // Filter for offer-related entities
      const offerEntities = entities.filter(e => 
        e.toLowerCase().includes('offer') || 
        e.toLowerCase().includes('quote') ||
        e.toLowerCase().includes('b2b')
      );

      if (offerEntities.length > 0) {
        console.log('📦 Offer-related entities found:');
        offerEntities.forEach(e => console.log(`   - ${e}`));
        console.log('');
      } else {
        console.log('⚠️  No offer-related entities found in schema\n');
      }

      // Test each found offer entity
      if (offerEntities.length > 0) {
        console.log('🧪 Testing offer entities...\n');
        for (const entity of offerEntities.slice(0, 5)) { // Test first 5
          const entityName = entity.replace(/_/g, '-');
          const testResponse = await fetch(`${settings.shopwareUrl}/api/search/${entityName}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ limit: 1, totalCountMode: 1 }),
          });

          console.log(`   ${entity}:`);
          console.log(`      → ${testResponse.status} ${testResponse.statusText}`);
          
          if (testResponse.ok) {
            const data = await testResponse.json();
            console.log(`      ✅ SUCCESS! Total: ${data.total || 0}`);
            if (data.data && data.data.length > 0) {
              console.log(`      Sample keys: ${Object.keys(data.data[0]).slice(0, 10).join(', ')}`);
            }
          }
        }
      }
    } else {
      console.log('   ⚠️  Schema endpoint not accessible\n');
      
      // Try common offer entity names
      console.log('🧪 Testing common offer entity names...\n');
      const commonEntities = [
        'b2b-sellers-offer',
        'b2b_sellers_offer',
        'b2bsellers-offer',
        'quote',
        'b2b-offer',
        'offer',
        'prems-individual-offer'
      ];

      for (const entityName of commonEntities) {
        const testResponse = await fetch(`${settings.shopwareUrl}/api/search/${entityName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ limit: 1, totalCountMode: 1 }),
        });

        console.log(`   ${entityName}:`);
        console.log(`      → ${testResponse.status} ${testResponse.statusText}`);
        
        if (testResponse.ok) {
          const data = await testResponse.json();
          console.log(`      ✅ SUCCESS! Total: ${data.total || 0}`);
          if (data.total > 0 && data.data && data.data.length > 0) {
            console.log(`      Sample keys: ${Object.keys(data.data[0]).slice(0, 10).join(', ')}`);
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testShopwareEntities().catch(console.error);
