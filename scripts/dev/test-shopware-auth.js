import pg from 'pg';
const { Client } = pg;

async function testShopwareAuth() {
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

    // Get Shopware settings
    const result = await client.query(
      "SELECT value FROM settings WHERE key = 'shopware' ORDER BY updated_at DESC LIMIT 1"
    );

    if (result.rows.length === 0) {
      console.log('❌ No Shopware settings found in database');
      return;
    }

    const settings = result.rows[0].value;
    console.log('\n📋 Shopware Settings:');
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

    // Test fetching offers
    console.log('\n📦 Testing offers endpoint...');
    const offersResponse = await fetch(`${settings.shopwareUrl}/api/search/b2b-sellers-offer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.access_token}`,
      },
      body: JSON.stringify({
        limit: 1,
        page: 1,
      }),
    });

    console.log('Offers Response Status:', offersResponse.status, offersResponse.statusText);

    if (!offersResponse.ok) {
      const errorText = await offersResponse.text();
      console.log('Response:', errorText);
    } else {
      const offersData = await offersResponse.json();
      console.log('✅ Offers endpoint accessible!');
      console.log('Total offers:', offersData.total || 0);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

testShopwareAuth().catch(console.error);
