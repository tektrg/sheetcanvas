import https from 'node:https';

const MAX_REDIRECTS = 5;

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function fetchText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 20000 }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const redirectUrl = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && redirectUrl) {
        if (redirectCount >= MAX_REDIRECTS) {
          response.resume();
          reject(new Error(`too many redirects while fetching ${url}`));
          return;
        }
        response.resume();
        resolve(fetchText(new URL(redirectUrl, url).href, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`expected HTTP 2xx from ${url}, got ${statusCode}`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    }).on('timeout', function handleTimeout() {
      this.destroy(new Error(`request timed out for ${url}`));
    }).on('error', reject);
  });
}
