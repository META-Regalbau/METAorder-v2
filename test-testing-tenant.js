import pg from 'pg';
const { Client } = pg;

async function testTestingTenant() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'metaorder',
    password: process.env.PGPASSWORD || 'metaorder',
    database: process.env.PGDATABASE || 'metaorder',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Get Testing tenant Shopware settings
    const result = await client.query(
      `SELECT s.value FROM settings s 
       JOIN tenants t ON s.tenant_id = t.id 
       WHERE s.key = 'shopware' AND t.name = 'Testing'`
    );

    if (result.rows.length === 0) {
      console.log('❌ No Shopware settings found for Testing tenant');
      return;
    }

    const settings = result.rows[0].value;
    console.log('\n📋 Testing Tenant - Shopware Settings:');
    console.log('URL:', settings.shopwareUrl);
    console.log('API Key length:', settings.apiKey?.length || 0, 'characters');
    console.log('API Secret length:', settings.apiSecret?.length || 0, 'characters');

    // Test authentication
    console.log('\n🔐 Testing authentication...');
    const authUrl = `${settings.shopwareUrl}/api/oauth/token`;
    console.log('Auth URL:', authUrl);

    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: settings.apiKey,
        client_secret: settings.apiSecret,
      }),
    });

    console.log('Response Status:', authResponse.status, authResponse.statusText);

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.log('❌ Authentication failed!');
      console.log('Error:', errorText);
      return;
    }

    const authData = await authResponse.json();
    console.log('✅ Authentication successful!');
    console.log('Token type:', authData.token_type);
    console.log('Expires in:', authData.expires_in, 'seconds');

    // Test fetching offers with different entity names
    console.log('\n📦 Testing offers endpoint...');
    const entityCandidates = [
      'b2b-sellers-offer',
      'b2b_sellers_offer',
      'quote',
      'b2b-offer',
      'prems-individual-offer'
    ];

    for (const entity of entityCandidates) {
      console.log(`\n  Trying entity: ${entity}`);
      const offersResponse = await fetch(`${settings.shopwareUrl}/api/search/${entity}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authData.access_token}`,
        },
        body: JSON.stringify({
          limit: 5,
          page: 1,
          totalCountMode: 1,
        }),
      });

      console.log(`  Response Status: ${offersResponse.status} ${offersResponse.statusText}`);

      if (offersResponse.ok) {
        const offersData = await offersResponse.json();
        console.log(`  ✅ Success! Total offers: ${offersData.total || 0}`);
        if (offersData.data && offersData.data.length > 0) {
          console.log(`  📋 Sample offer:`, JSON.stringify(offersData.data[0], null, 2).substring(0, 500) + '...');
        }
        break;
      } else {
        const errorText = await offersResponse.text();
        if (offersResponse.status === 404) {
          console.log(`  ⚠️  Entity not found, trying next...`);
        } else {
          console.log(`  ❌ Error:`, errorText.substring(0, 200));
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testTestingTenant().catch(console.error);
