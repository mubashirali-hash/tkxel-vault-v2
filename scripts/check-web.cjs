const http = require('http');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const htmlRes = await fetchUrl('http://localhost:3000');
    console.log('HTML Status:', htmlRes.status);
    console.log('HTML Length:', htmlRes.data.length);
    console.log('HTML:', htmlRes.data);

    // Extract script src
    const matches = [...htmlRes.data.matchAll(/src="([^"]+)"/g)];
    for (const match of matches) {
      const scriptUrl = match[1].startsWith('http') ? match[1] : `http://localhost:3000${match[1]}`;
      console.log('\n--- Fetching script:', scriptUrl);
      try {
        const scriptRes = await fetchUrl(scriptUrl);
        console.log('Script Status:', scriptRes.status, 'Length:', scriptRes.data.length);
        if (scriptRes.status !== 200) {
          console.error('ERROR fetching script:', scriptRes.data.slice(0, 500));
        } else {
          console.log('Script Preview:', scriptRes.data.slice(0, 200));
        }
      } catch (err) {
        console.error('Error fetching script:', err.message);
      }
    }
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

main();
